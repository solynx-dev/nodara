import type { Me, UserPreferences } from '@nodara/shared';
import type { Sql } from '../db/index.js';

export const DEFAULT_PREFERENCES: UserPreferences = {
  units: 'metric',
  theme: 'system',
  mapStyle: null,
  updateIntervalSec: 30,
  adaptiveInterval: true,
  highAccuracy: true,
  retentionDays: null,
  notifyLowBattery: true,
  lowBatteryThreshold: 15,
};

/** A small, pleasant palette used for member avatars and map markers. */
export const AVATAR_COLORS = ['#FF7A45', '#4C9AFF', '#36B37E', '#B37FEB', '#F5A524', '#13C2C2', '#F56A9A', '#7A8CFF'];

export function pickAvatarColor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export async function loadMe(sql: Sql, userId: string): Promise<Me | null> {
  const [u] = await sql<
    {
      id: string;
      email: string;
      display_name: string;
      avatar_color: string;
      avatar_url: string | null;
      email_verified_at: Date | null;
      is_admin: boolean;
      is_demo: boolean;
      sharing_paused: boolean;
      totp_enabled_at: Date | null;
      passkeys: number;
      created_at: Date;
      preferences: Partial<UserPreferences> & Record<string, unknown>;
    }[]
  >`
    SELECT u.id, u.email, u.display_name, u.avatar_color, u.avatar_url, u.email_verified_at, u.is_admin, u.is_demo,
           u.sharing_paused, u.totp_enabled_at, u.created_at, u.preferences,
           (SELECT count(*)::int FROM passkeys p WHERE p.user_id = u.id) AS passkeys
    FROM users u WHERE u.id = ${userId}`;
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    avatarColor: u.avatar_color,
    avatarUrl: u.avatar_url,
    emailVerified: Boolean(u.email_verified_at),
    isAdmin: u.is_admin,
    isDemo: u.is_demo,
    sharingPaused: u.sharing_paused,
    totpEnabled: Boolean(u.totp_enabled_at),
    passkeyCount: u.passkeys,
    createdAt: u.created_at.toISOString(),
    preferences: { ...DEFAULT_PREFERENCES, ...u.preferences },
  };
}

/**
 * Delete a user. Circles they own pass to the longest-standing admin (or
 * member); circles left empty are removed. Their location history, trips,
 * devices and private places are deleted with the account (FK cascades).
 */
export async function deleteUser(sql: Sql, userId: string) {
  await sql.begin(async (tx) => {
    const owned = await tx<{ circle_id: string }[]>`
      SELECT circle_id FROM circle_members WHERE user_id = ${userId} AND role = 'owner'`;
    for (const { circle_id } of owned) {
      await tx`
        UPDATE circle_members SET role = 'owner'
        WHERE (circle_id, user_id) = (
          SELECT circle_id, user_id FROM circle_members WHERE circle_id = ${circle_id} AND user_id <> ${userId}
          ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at LIMIT 1)`;
    }
    await tx`DELETE FROM users WHERE id = ${userId}`;
    await tx`DELETE FROM circles c WHERE NOT EXISTS (SELECT 1 FROM circle_members m WHERE m.circle_id = c.id)`;
  });
}
