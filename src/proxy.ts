import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Next 16 names the middleware file `proxy.ts`.
 *
 * Everything except the explicitly public routes requires a session. /share/<token>
 * is public on purpose — it is the link a patient hands to a doctor, and requiring a
 * login there would mean the recipient signing in as the patient. Its own token is
 * the credential, and it is checked in `getSharedHistory`.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/share/(.*)",
]);

/**
 * API routes are deliberately NOT protected here. `auth.protect()` answers an
 * unauthenticated API request with a 307 redirect to the sign-in page, which a
 * browser `fetch` follows — the caller then gets HTML where it expected JSON and
 * fails to parse it. Every route handler calls `getCurrentUserId()` itself, which
 * throws AuthError and returns a clean 401 JSON body, so nothing is left unguarded.
 */
const isApiRoute = createRouteMatcher(['/api/(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isApiRoute(req) || isPublicRoute(req)) return;
  await auth.protect();
});

export const config = {
  // Static assets are excluded; every other path, including all API routes, passes
  // through so a new route is protected by default rather than by remembering to
  // add it to a list.
  matcher: ["/((?!_next|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)"],
};
