import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { unauthorized } from "@/lib/api";
import { db } from "@/db";
import { users, userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const full = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .then((r) => r[0]);

  const settings = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .then((r) => r[0]);

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarColor: user.avatarColor,
      statusText: full?.statusText ?? null,
      timezone: full?.timezone ?? "UTC",
    },
    settings: settings
      ? {
          theme: settings.theme,
          notifyDm: settings.notifyDm,
          notifyMention: settings.notifyMention,
          notifyAllThreads: settings.notifyAllThreads,
          pushAllThreads: settings.pushAllThreads,
        }
      : null,
  });
}
