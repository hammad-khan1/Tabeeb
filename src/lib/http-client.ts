/**
 * Client-side JSON requests for the app's own API routes. Errors carry the server's
 * user-facing message, which every route returns as `{ error }`.
 */

/** An API error carrying the server's user-facing message. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RequestError(response.status, body?.error ?? "Something went wrong. Please try again.");
  }
  return body as T;
}

export function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  return request<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const fetcher = <T,>(url: string) => request<T>(url);
