import { NextResponse } from 'next/server';
import { AuthError } from './auth';

/** Maps thrown route errors to a response, so an unauthenticated call returns 401 rather than 500. */
export function errorResponse(scope: string, error: unknown, fallbackMessage: string) {
  const status = error instanceof AuthError ? 401 : 500;
  const message = error instanceof Error ? error.message : fallbackMessage;
  console.error(`[${scope}]`, message);
  return NextResponse.json({ error: message }, { status });
}
