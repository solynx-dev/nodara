import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Cryptographically random URL-safe token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes so a DB leak cannot be replayed. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** A fixed hash used to equalise timing when the user does not exist. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('nodara-timing-equaliser');
  return dummyHash;
}
