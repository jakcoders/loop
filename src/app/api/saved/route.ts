import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages, savedMessages, channels, conversations } from "@/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { newId } from "@/lib/api";

/**
 * Toggle a message as "saved" by the current user (the "Later" / saved items list).
 * POST /api/saved
 * Body: { messageId: string, workspaceId: string }
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { messageId, workspaceId } = body;
  if (!messageId || !workspaceId) {
    return NextResponse.json({ error: "messageId and workspaceId required" }, { status: 400 });
  }

  // Verify workspace membership
  const { getMembership } = await import("@/lib/chat");
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Verify the message belongs to this workspace
  const msg = await db
    .select({
      channelId: messages.channelId,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .where(eq(messages.id, messageId))
    .then((r) => r[0]);

  if (!msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  let inWorkspace = false;
  if (msg.channelId) {
    const ch = await db.select().from(channels).where(eq(channels.id, msg.channelId)).then((r) => r[0]);
    inWorkspace = ch?.workspaceId === workspaceId;
  } else if (msg.conversationId) {
    const conv = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId)).then((r) => r[0]);
    inWorkspace = conv?.workspaceId === workspaceId;
  }

  if (!inWorkspace) return NextResponse.json({ error: "Message not in workspace" }, { status: 404 });

  const existing = await db
    .select()
    .from(savedMessages)
    .where(and(eq(savedMessages.messageId, messageId), eq(savedMessages.userId, user.id)));

  if (existing.length > 0) {
    await db
      .delete(savedMessages)
      .where(
        and(eq(savedMessages.messageId, messageId), eq(savedMessages.userId, user.id))
      );
    return NextResponse.json({ saved: false });
  }

  await db.insert(savedMessages).values({
    id: newId(),
    messageId,
    userId: user.id,
  });

  return NextResponse.json({ saved: true });
}

/**
 * List all messages saved by the current user across their workspaces.
 * GET /api/saved
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: messages.id,
      messageId: savedMessages.messageId,
      body: messages.body,
      createdAt: messages.createdAt,
      channelId: messages.channelId,
      conversationId: messages.conversationId,
      authorId: messages.authorId,
    })
    .from(savedMessages)
    .innerJoin(messages, eq(savedMessages.messageId, messages.id))
    .where(eq(savedMessages.userId, user.id))
    .orderBy(sql`${messages.createdAt} DESC`)
    .limit(100);

  return NextResponse.json({ items: rows });
}
