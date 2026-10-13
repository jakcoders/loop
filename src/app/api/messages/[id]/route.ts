import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { apiError, forbidden, notFound, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import {
  MessageRow,
  requireScopeAccess,
  serializeMessages,
} from "@/lib/chat";

async function loadMessage(id: string) {
  const rows = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  return rows[0] ?? null;
}

async function checkScope(userId: string, message: MessageRow) {
  if (message.channelId) {
    return requireScopeAccess(userId, "channel", message.channelId);
  }
  if (message.conversationId) {
    return requireScopeAccess(userId, "conversation", message.conversationId);
  }
  return null;
}

/** Edit own message. Server wins on conflicts; clients reconcile via sync. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const message = await loadMessage(id);
  if (!message || message.deletedAt) return notFound("Message not found");
  if (message.authorId !== user.id)
    return forbidden("You can only edit your own messages");

  const scope = await checkScope(user.id, message);
  if (!scope) return forbidden("Not a member of this scope");

  let body: { body?: string };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const content = body.body?.trim() ?? "";
  if (!content) return apiError(400, "EMPTY_BODY", "Message body cannot be empty");
  if (content.length > 4000)
    return apiError(400, "BODY_TOO_LONG", "Message exceeds 4000 characters");

  const updated = await db
    .update(messages)
    .set({ body: content, editedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(messages.id, id))
    .returning();

  const [serialized] = await serializeMessages(updated);
  return NextResponse.json(serialized);
}

/** Soft delete own message (tombstone so clients prune local caches). */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const message = await loadMessage(id);
  if (!message || message.deletedAt) return notFound("Message not found");
  if (message.authorId !== user.id)
    return forbidden("You can only delete your own messages");

  const scope = await checkScope(user.id, message);
  if (!scope) return forbidden("Not a member of this scope");

  const updated = await db
    .update(messages)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(messages.id, id))
    .returning();

  const [serialized] = await serializeMessages(updated);
  return NextResponse.json(serialized);
}
