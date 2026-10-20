/** Database tests may only target an explicitly opted-in, isolated local test database. */
export function isolatedTestDatabaseUrl(env: Record<string, string | undefined>): string | null {
  if (env.TABEEB_RUN_DB_TESTS !== '1') return null;
  const value = env.TABEEB_TEST_DATABASE_URL;
  if (!value) throw new Error('TABEEB_TEST_DATABASE_URL is required for database tests.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid isolated test database configuration.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/^\/tabeeb_test_[a-z0-9_]+$/.test(url.pathname) ||
    url.search || url.hash
  ) {
    throw new Error('Database tests require a local database named tabeeb_test_* without URL overrides.');
  }
  return value;
}
