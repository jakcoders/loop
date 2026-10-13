import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { messages, reactions } from "@/db/schema";
import { apiError, forbidden, newId, notFound, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { requireScopeAccess, serializeMessages } from "@/lib/chat";

/** Toggle an emoji reaction on a message. */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: messageId } = await ctx.params;

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  const message = rows[0];
  if (!message || message.deletedAt) return notFound("Message not found");

  const access = message.channelId
    ? await requireScopeAccess(user.id, "channel", message.channelId)
    : message.conversationId
      ? await requireScopeAccess(user.id, "conversation", message.conversationId)
      : null;
  if (!access) return forbidden("Not a member of this scope");

  let body: { emoji?: string };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const emoji = body.emoji?.trim() ?? "";
  if (!emoji || emoji.length > 16) {
    return apiError(400, "INVALID_EMOJI", "A valid emoji is required");
  }

  const existing = await db
    .select()
    .from(reactions)
    .where(
      and(
        eq(reactions.messageId, messageId),
        eq(reactions.userId, user.id),
        eq(reactions.emoji, emoji)
      )
    )
    .limit(1);

  await db.transaction(async (tx) => {
    if (existing.length > 0) {
      await tx.delete(reactions).where(eq(reactions.id, existing[0].id));
    } else {
      await tx
        .insert(reactions)
        .values({ id: newId(), messageId, userId: user.id, emoji })
        .onConflictDoNothing();
    }
    // Bump the message so pollers pick up the reaction change.
    await tx
      .update(messages)
      .set({ updatedAt: sql`now()` })
      .where(eq(messages.id, messageId));
  });

  const updated = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  const [serialized] = await serializeMessages(updated);
  return NextResponse.json(serialized);
}
