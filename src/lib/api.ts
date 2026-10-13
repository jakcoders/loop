import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/**
 * Uniform error envelope: { code, message, fieldErrors?, requestId }
 */
export function apiError(
  status: number,
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>
) {
  return NextResponse.json(
    { code, message, fieldErrors, requestId: randomUUID() },
    { status }
  );
}

export const unauthorized = () =>
  apiError(401, "UNAUTHORIZED", "Authentication required");

export const forbidden = (message = "You do not have access to this resource") =>
  apiError(403, "FORBIDDEN", message);

export const notFound = (message = "Resource not found") =>
  apiError(404, "NOT_FOUND", message);

export function newId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 24);
}

/** Opaque cursor: base64("createdAtMs:id") */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.getTime()}:${id}`).toString("base64url");
}

export function decodeCursor(
  cursor: string
): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = raw.indexOf(":");
    if (sep < 0) return null;
    const ms = Number(raw.slice(0, sep));
    const id = raw.slice(sep + 1);
    if (!Number.isFinite(ms) || !id) return null;
    return { createdAt: new Date(ms), id };
  } catch {
    return null;
  }
}

const AVATAR_COLORS = [
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#22C55E",
  "#06B6D4",
  "#EF4444",
  "#10B981",
];

export function pickAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
