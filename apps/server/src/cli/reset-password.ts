import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { createDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { hashPassword, randomToken } from '../lib/crypto.js';
import { recoverAccount } from '../services/users.js';

/**
 * Locked out? Set a new password from the server:
 *   docker compose exec nodara node dist/cli/reset-password.js --email you@example.com
 *
 *   --generate      print a random new password instead of asking for one
 *   --disable-2fa   also turn off two-factor (if you lost your authenticator and recovery codes)
 *   --enable        also re-enable the account if it was disabled
 *
 * The password can also come from NODARA_NEW_PASSWORD. Every session is signed
 * out (sign in again on your phone); location sharing keeps working because it
 * uses a separate device token.
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    email: { type: 'string' },
    generate: { type: 'boolean', default: false },
    'disable-2fa': { type: 'boolean', default: false },
    enable: { type: 'boolean', default: false },
  },
});
if (!values.email) {
  console.error('Usage: reset-password --email <email> [--generate] [--disable-2fa] [--enable]');
  process.exit(1);
}

let password = values.generate ? randomToken(12) : process.env.NODARA_NEW_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('New password (min 10 characters): ');
  rl.close();
}
if (!password || password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}

const config = loadConfig();
const sql = createDb(config.DATABASE_URL, 1);
try {
  await migrate(sql);
  const r = await recoverAccount(sql, values.email, await hashPassword(password), { disable2fa: values['disable-2fa'], enable: values.enable });
  if (!r) {
    console.error(`No account with the email ${values.email}.`);
    process.exitCode = 1;
  } else {
    console.log(`Password changed for ${values.email}. All sessions were signed out.`);
    if (values.generate) console.log(`New password: ${password}`);
    if (r.was2fa && !values['disable-2fa']) console.log('Two-factor is still on. Add --disable-2fa if you lost your authenticator and recovery codes.');
    if (values['disable-2fa'] && r.was2fa) console.log('Two-factor was turned off. Turn it back on in Settings → Security.');
    if (r.wasDisabled && !values.enable) console.log('This account is disabled. Add --enable to re-enable it.');
    if (values.enable && r.wasDisabled) console.log('The account was re-enabled.');
  }
} finally {
  await sql.end();
}
