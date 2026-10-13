import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { userSettings, users, customEmojis } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let settings = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .then((r) => r[0]);

  if (!settings) {
    await db
      .insert(userSettings)
      .values({ userId: user.id })
      .catch(() => {});
    settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .then((r) => r[0]);
  }

  const fullUser = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .then((r) => r[0]);

  const emojis = await db
    .select()
    .from(customEmojis)
    .orderBy(desc(customEmojis.createdAt));

  return NextResponse.json({
    theme: settings?.theme ?? "system",
    notifyDm: settings?.notifyDm ?? true,
    notifyMention: settings?.notifyMention ?? true,
    notifyAllThreads: settings?.notifyAllThreads ?? false,
    pushAllThreads: settings?.pushAllThreads ?? false,
    statusText: fullUser?.statusText ?? null,
    timezone: fullUser?.timezone ?? "UTC",
    customEmoji: emojis.map((e) => ({ name: e.name, code: e.code })),
  });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { theme, notifyDm, notifyMention, notifyAllThreads, pushAllThreads, statusText } = body;

  if (theme !== undefined) {
    await db
      .insert(userSettings)
      .values({ userId: user.id, theme })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { theme },
      });
  }

  if (
    notifyDm !== undefined ||
    notifyMention !== undefined ||
    notifyAllThreads !== undefined ||
    pushAllThreads !== undefined ||
    theme !== undefined
  ) {
    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (theme !== undefined) updates.theme = theme;
    if (notifyDm !== undefined) updates.notifyDm = notifyDm;
    if (notifyMention !== undefined) updates.notifyMention = notifyMention;
    if (notifyAllThreads !== undefined) updates.notifyAllThreads = notifyAllThreads;
    if (pushAllThreads !== undefined) updates.pushAllThreads = pushAllThreads;
    await db
      .update(userSettings)
      .set(updates)
      .where(eq(userSettings.userId, user.id))
      .catch(() => {});
  }

  if (statusText !== undefined) {
    await db.update(users).set({ statusText }).where(eq(users.id, user.id));
  }

  return NextResponse.json({ ok: true });
}
