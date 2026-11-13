import type { ApiEnvelope, FieldError, ListParams, Paginated } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: FieldError[] = [],
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function qs(query?: Query) {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** All calls go through the same-origin BFF (/api/*), which holds the session in HttpOnly cookies. */
export async function request<T>(
  path: string,
  { method = "GET", body, query }: { method?: string; body?: unknown; query?: Query } = {},
): Promise<ApiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}${qs(query)}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Network error. Check your connection.", 0);
  }
  const json = (await res.json().catch(() => null)) as (ApiEnvelope<T> & { errors?: FieldError[] }) | null;
  if (!res.ok || !json?.success) {
    if (res.status === 401 && !path.startsWith("auth/") && typeof window !== "undefined") {
      // Outside React: a hard navigation also drops all cached data from the expired session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    }
    throw new ApiError(json?.message ?? `Request failed (${res.status})`, res.status, json?.errors ?? []);
  }
  return json;
}

export const api = {
  get: async <T>(path: string, query?: Query) => (await request<T>(path, { query })).data,
  list: async <T>(path: string, params: ListParams | (ListParams & Query) = {}): Promise<Paginated<T>> => {
    const r = await request<T[]>(path, { query: { ...params } });
    return { items: r.data, meta: r.meta! };
  },
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body }),
};

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx,.txt,.csv";

/** Uploads raw bytes to private storage via the BFF; the server validates type and size again. */
export async function uploadFile(file: File, purpose: string, employeeId?: string): Promise<UploadedFile> {
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("Files must be 10 MB or smaller", 413);
  const query = qs({ filename: file.name, purpose, employeeId });
  let res: Response;
  try {
    res = await fetch(`/api/files${query}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("Network error. Check your connection.", 0);
  }
  const json = (await res.json().catch(() => null)) as ApiEnvelope<UploadedFile> | null;
  if (!res.ok || !json?.success) throw new ApiError(json?.message ?? `Upload failed (${res.status})`, res.status);
  return json.data;
}

/** Same-origin URL for an authorized download (cookies are sent; nothing is public). */
export const fileUrl = (id: string, inline = false) => `/api/files/${id}/content${inline ? "?inline=true" : ""}`;
export const apiUrl = (path: string, query?: Query) => `/api/${path}${qs(query)}`;

/** Maps backend validation errors ("body.email") onto form fields ("email"). */
export function applyFieldErrors(err: unknown, setError: (field: never, e: { message: string }) => void) {
  if (!(err instanceof ApiError)) return false;
  for (const e of err.errors) {
    const field = e.field.replace(/^(body|querystring|params)\./, "");
    setError(field as never, { message: e.message });
  }
  return err.errors.length > 0;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");
