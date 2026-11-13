import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/session";

/**
 * Backend-for-frontend proxy. The browser calls /api/<path>; we forward to the Fastify API,
 * attach the access token from an HttpOnly cookie, transparently rotate it on 401, and strip
 * tokens out of auth responses so they only ever live in HttpOnly cookies.
 */
const API_URL = (process.env.API_URL ?? "http://localhost:5050/api/v1").replace(/\/$/, "");
const REFRESH_MAX_AGE = Number(process.env.REFRESH_COOKIE_MAX_AGE ?? 60 * 60 * 24 * 7);
const TOKEN_ISSUING = new Set(["auth/login", "auth/register", "auth/switch-tenant", "auth/passkeys/login/verify", "auth/mfa/verify"]);
const BLOCKED = new Set(["auth/refresh"]); // rotation is handled here, never by the client

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Concurrent requests with the same expired session must share one rotation; a second rotation
// with the old refresh token would trip the backend's reuse detection and revoke the session.
// ponytail: in-process dedupe, fine for one Next instance; use sticky sessions or a shared store if scaled out.
const inflight = new Map<string, Promise<Tokens | null>>();

function rotate(refreshToken: string, headers: Headers): Promise<Tokens | null> {
  let p = inflight.get(refreshToken);
  if (!p) {
    p = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    })
      .then(async (r) => (r.ok ? ((await r.json()).data as Tokens) : null))
      .catch(() => null);
    inflight.set(refreshToken, p);
    setTimeout(() => inflight.delete(refreshToken), 15_000);
  }
  return p;
}

function setTokens(res: NextResponse, t: Tokens) {
  const base = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" } as const;
  res.cookies.set(ACCESS_COOKIE, t.accessToken, { ...base, maxAge: Math.max(t.expiresIn - 30, 30) });
  res.cookies.set(REFRESH_COOKIE, t.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE });
}

function clearTokens(res: NextResponse) {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
}

async function handler(req: NextRequest, ctx: RouteContext<"/api/[...path]">) {
  const path = (await ctx.params).path.join("/");
  if (BLOCKED.has(path)) {
    return NextResponse.json({ success: false, message: "Not found", errors: [], meta: null }, { status: 404 });
  }

  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  const forward = new Headers();
  for (const h of ["user-agent", "x-request-id", "accept-language"]) {
    const v = req.headers.get(h);
    if (v) forward.set(h, v);
  }
  // Real client IP for the backend's per-IP rate limits (honoured when backend TRUST_PROXY=true).
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (ip) forward.set("x-forwarded-for", ip);

  if (path === "auth/logout") {
    if (refreshToken) {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { ...Object.fromEntries(forward), "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store",
      }).catch(() => undefined);
    }
    const res = NextResponse.json({ success: true, message: "Logged out", data: null, meta: null });
    clearTokens(res);
    return res;
  }

  // File uploads are forwarded as raw bytes; everything else is JSON.
  const binary = req.headers.get("content-type")?.startsWith("application/octet-stream") ?? false;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : binary ? await req.arrayBuffer() : await req.text();
  const send = (token?: string) => {
    const headers = new Headers(forward);
    if (body) headers.set("content-type", binary ? "application/octet-stream" : "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(`${API_URL}/${path}${req.nextUrl.search}`, { method: req.method, headers, body, cache: "no-store" });
  };

  const isPublicAuth =
    path.startsWith("auth/passkeys/login/") ||
    path === "auth/mfa/verify" ||
    path.startsWith("auth/mfa/challenge/") ||
    (path.startsWith("auth/") &&
      !path.startsWith("auth/passkeys") &&
      !path.startsWith("auth/mfa") &&
      !["auth/me", "auth/switch-tenant", "auth/change-password", "auth/logout-all"].includes(path));
  let rotated: Tokens | null = null;
  let accessToken = jar.get(ACCESS_COOKIE)?.value;
  if (!accessToken && refreshToken && !isPublicAuth) {
    rotated = await rotate(refreshToken, forward);
    accessToken = rotated?.accessToken;
  }

  let upstream: Response;
  try {
    upstream = await send(accessToken);
    if (upstream.status === 401 && refreshToken && !rotated && !isPublicAuth) {
      rotated = await rotate(refreshToken, forward);
      if (rotated) upstream = await send(rotated.accessToken);
    }
  } catch {
    return NextResponse.json(
      { success: false, message: "The service is unreachable. Please try again shortly.", errors: [], meta: null },
      { status: 502 },
    );
  }

  // Downloads (files, payslip PDFs, CSV/Excel exports) stream through unchanged; tokens never involved.
  const type = upstream.headers.get("content-type") ?? "";
  if (upstream.ok && !type.includes("application/json")) {
    const res = new NextResponse(upstream.body, { status: upstream.status });
    for (const h of ["content-type", "content-disposition", "content-length", "cache-control", "x-content-type-options"]) {
      const v = upstream.headers.get(h);
      if (v) res.headers.set(h, v);
    }
    if (rotated) setTokens(res, rotated);
    return res;
  }

  const json = await upstream.json().catch(() => null);
  if (TOKEN_ISSUING.has(path) && upstream.ok && json?.data?.accessToken) {
    const { accessToken: a, refreshToken: r, expiresIn, tokenType: _t, ...rest } = json.data;
    rotated = { accessToken: a, refreshToken: r, expiresIn };
    json.data = rest;
  }

  const res = NextResponse.json(json, { status: upstream.status });
  const requestId = upstream.headers.get("x-request-id");
  if (requestId) res.headers.set("x-request-id", requestId);

  if ((path === "auth/change-password" || path === "auth/logout-all") && upstream.ok) clearTokens(res); // backend revoked all sessions
  else if (rotated) setTokens(res, rotated);
  else if (upstream.status === 401 && !isPublicAuth) clearTokens(res);
  return res;
}

export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE };
