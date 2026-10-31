import { loadConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';

const config = loadConfig();
const sql = createDb(config.DATABASE_URL, 1);
try {
  const applied = await migrate(sql, (m) => console.log(m));
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
} finally {
  await sql.end();
}
