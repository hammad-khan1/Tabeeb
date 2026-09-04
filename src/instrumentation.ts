/**
 * Runs once when the server starts. Configuration problems surface here with a
 * readable message instead of as an opaque 401 from an upstream API partway through
 * processing somebody's document.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertServerConfig } = await import('./lib/env');

  try {
    assertServerConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n${message}\n`);

    // Failing the boot in production beats serving an app that breaks on first use.
    if (process.env.NODE_ENV === 'production') throw error;
  }
}
