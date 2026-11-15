import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/session";

/**
 * Landing point for InvoHub launches: /auth/hub?token=<one-time token>. The token is redeemed
 * server-side, so session tokens only ever reach the browser as HttpOnly cookies.
 */
const API_URL = (process.env.API_URL ?? "http://localhost:5050/api/v1").replace(/\/$/, "");
const HUB_URL = process.env.HUB_URL ?? "https://invohub.kwingsmedia.com";
const REFRESH_MAX_AGE = Number(process.env.REFRESH_COOKIE_MAX_AGE ?? 60 * 60 * 24 * 7);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function failure(message: string, status: number) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in failed</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100dvh;margin:0;padding:16px;background:#fafafa;color:#111}main{max-width:420px;text-align:center}a{color:#1D4ED8}</style></head>
<body><main><h1>Can't open this app</h1><p>${esc(message)}</p><p><a href="${esc(HUB_URL)}">Back to InvoHub</a> · <a href="/login">Sign in here</a></p></main></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return failure("This sign-in link is incomplete.", 400);

  const headers = new Headers({ "content-type": "application/json" });
  const ua = req.headers.get("user-agent");
  if (ua) headers.set("user-agent", ua);
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip");
  if (ip) headers.set("x-forwarded-for", ip);

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/auth/hub`, { method: "POST", headers, body: JSON.stringify({ token }), cache: "no-store" });
  } catch {
    return failure("The service is unreachable. Please try again shortly.", 502);
  }
  const json = await upstream.json().catch(() => null);
  const data = json?.data as { accessToken?: string; refreshToken?: string; expiresIn?: number } | undefined;
  if (!upstream.ok || !data?.accessToken || !data.refreshToken) {
    return failure(json?.message ?? "Sign-in failed.", upstream.status === 404 ? 404 : upstream.status || 500);
  }

  // Relative redirect keeps the public host behind the reverse proxy.
  const res = new NextResponse(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
  const base = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" } as const;
  res.cookies.set(ACCESS_COOKIE, data.accessToken, { ...base, maxAge: Math.max((data.expiresIn ?? 900) - 30, 30) });
  res.cookies.set(REFRESH_COOKIE, data.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE });
  return res;
}
