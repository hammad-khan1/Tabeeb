import { NextResponse } from 'next/server';

/**
 * Liveness probe for the hosting platform.
 *
 * Deliberately does nothing: no authentication, no database, no model call. A health
 * check that touches the database turns a brief database blip into the platform
 * killing and restarting a perfectly healthy container, which is how a small outage
 * becomes a restart loop.
 *
 * It answers "is this process serving HTTP", which is the only question a liveness
 * probe should ask.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
