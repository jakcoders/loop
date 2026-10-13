import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { newId } from "@/lib/api";

export const SESSION_COOKIE = "loop_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derived] = stored.split(":");
  if (!salt || !derived) return false;
  const check = scryptSync(password, salt, 64);
  const expected = Buffer.from(derived, "hex");
  return check.length === expected.length && timingSafeEqual(check, expected);
}

// ---------------------------------------------------------------------------
// Opaque session tokens (hashed server-side)
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  statusText?: string | null;
  timezone: string;
};

/**
 * Resolve the current user from the session cookie.
 * Also acts as a presence heartbeat (`lastSeenAt`).
 */
export async function getCurrentUser(options?: {
  heartbeat?: boolean;
}): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarColor: users.avatarColor,
      statusText: users.statusText,
      timezone: users.timezone,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  const user = rows[0] ?? null;
  if (user && options?.heartbeat !== false) {
    // Presence derived from heartbeat, throttling is unnecessary at this scale.
    await db
      .update(users)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(users.id, user.id));
  }
  return user;
}
