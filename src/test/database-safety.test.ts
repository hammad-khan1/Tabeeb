import { describe, expect, it } from 'vitest';
import { isolatedTestDatabaseUrl } from './database-safety';

describe('database test isolation', () => {
  it('never uses the application database or implicitly opts in', () => {
    expect(isolatedTestDatabaseUrl({ DATABASE_URL: 'postgres://example.invalid/production' })).toBeNull();
    expect(isolatedTestDatabaseUrl({ TABEEB_TEST_DATABASE_URL: 'postgres://localhost/tabeeb_test_unit' })).toBeNull();
  });
  it('requires an explicit isolated local URL', () => {
    expect(() => isolatedTestDatabaseUrl({ TABEEB_RUN_DB_TESTS: '1' })).toThrow();
    const env = { TABEEB_RUN_DB_TESTS: '1', TABEEB_TEST_DATABASE_URL: 'postgres://localhost:55439/tabeeb_test_medications' };
    expect(isolatedTestDatabaseUrl(env)).toBe(env.TABEEB_TEST_DATABASE_URL);
  });
  it.each([
    'postgres://example.neon.tech/tabeeb_test_medications',
    'postgres://localhost/production',
    'postgres://localhost/tabeeb_test_medications?host=remote.example',
    'https://localhost/tabeeb_test_medications',
    'postgres://localhost/tabeeb_test_medications#override',
  ])('rejects unsafe test target %s', (url) => {
    expect(() => isolatedTestDatabaseUrl({ TABEEB_RUN_DB_TESTS: '1', TABEEB_TEST_DATABASE_URL: url })).toThrow();
  });
});
