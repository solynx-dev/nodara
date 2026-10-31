import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { hashPassword } from '../lib/crypto.js';
import { pickAvatarColor } from '../services/users.js';

/**
 * Create (or promote) an administrator from the command line:
 *   docker compose exec nodara node dist/cli/create-admin.js --email you@example.com --name "You"
 * The password is read from NODARA_ADMIN_PASSWORD or prompted for.
 */
const { values } = parseArgs({
  // Tolerate the `--` separator added by `pnpm <script> -- …`.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { email: { type: 'string' }, name: { type: 'string' }, promote: { type: 'boolean', default: false } },
});
if (!values.email) {
  console.error('Usage: create-admin --email <email> [--name <display name>] [--promote]');
  process.exit(1);
}
const config = loadConfig();
const sql = createDb(config.DATABASE_URL, 1);
try {
  await migrate(sql);
  const email = values.email.trim().toLowerCase();
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
  if (existing) {
    if (!values.promote) {
      console.error('A user with that email exists. Re-run with --promote to make them an administrator.');
      process.exit(1);
    }
    await sql`UPDATE users SET is_admin = true, disabled_at = NULL WHERE id = ${existing.id}`;
    await sql`INSERT INTO audit_log (action, target_type, target_id) VALUES ('cli.admin_promoted', 'user', ${existing.id})`;
    console.log(`${email} is now an administrator.`);
  } else {
    let password = process.env.NODARA_ADMIN_PASSWORD;
    if (!password) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      password = await rl.question('Password (min 10 characters): ');
      rl.close();
    }
    if (!password || password.length < 10) {
      console.error('Password must be at least 10 characters.');
      process.exit(1);
    }
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, password_hash, is_admin, email_verified_at, avatar_color)
      VALUES (${email}, ${values.name ?? email.split('@')[0]!}, ${await hashPassword(password)}, true, now(), ${pickAvatarColor(email)})
      RETURNING id`;
    await sql`INSERT INTO audit_log (action, target_type, target_id) VALUES ('cli.admin_created', 'user', ${u!.id})`;
    console.log(`Administrator ${email} created.`);
  }
} finally {
  await sql.end();
}
