import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages, pins, channels, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/chat";
import { newId } from "@/lib/api";

/**
 * Toggle a message pin in the current workspace.
 * POST /api/messages/{id}/pin
 * Body: { workspaceId: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: messageId } = await params;
  const { workspaceId } = await req.json();
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const msg = await db
    .select({
      id: messages.id,
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
    const conv = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, msg.conversationId))
      .then((r) => r[0]);
    inWorkspace = conv?.workspaceId === workspaceId;
  }

  if (!inWorkspace) return NextResponse.json({ error: "Message not in workspace" }, { status: 404 });

  const existing = await db
    .select()
    .from(pins)
    .where(eq(pins.messageId, messageId));

  if (existing.length > 0) {
    await db.delete(pins).where(eq(pins.messageId, messageId));
    return NextResponse.json({ pinned: false });
  }

  await db.insert(pins).values({
    id: newId(),
    messageId: msg.id,
    channelId: msg.channelId,
    conversationId: msg.conversationId,
    pinnedById: user.id,
  });

  return NextResponse.json({ pinned: true });
}
