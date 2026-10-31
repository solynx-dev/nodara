import postgres from 'postgres';

/** Recreate the test database schema once per test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://nodara:nodara@localhost:5432/nodara_test';
  process.env.TEST_DATABASE_URL = url;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await sql.end();
}
