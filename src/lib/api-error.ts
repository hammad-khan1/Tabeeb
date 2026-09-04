import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { AuthError } from './auth';
import { RateLimitError } from './rate-limit';

/**
 * A request-shaped error whose message is safe to show the user. Anything else is
 * logged in full and reported generically, because raw error text from Postgres or an
 * upstream API leaks connection details and internal structure to the client.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}

export function notFound(message = 'Not found'): ApiError {
  return new ApiError(404, message);
}

/** Maps a thrown route error to a response without leaking internals. */
export function errorResponse(scope: string, error: unknown, fallbackMessage: string) {
  if (error instanceof RateLimitError) {
    console.warn(`[${scope}] rate limited`);
    return NextResponse.json(
      { error: error.message },
      { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } }
    );
  }

  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  // Unexpected: log everything, return nothing but a correlation id.
  const reference = randomUUID().slice(0, 8);
  console.error(`[${scope}] (ref ${reference})`, error);
  return NextResponse.json(
    { error: fallbackMessage, reference },
    { status: 500 }
  );
}
