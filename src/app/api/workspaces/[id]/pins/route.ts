import { NextResponse } from "next/server";
import { db } from "@/db";
import { pins, channels, conversations } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/chat";

/**
 * List pinned messages for a workspace.
 * GET /api/workspaces/{id}/pins
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: workspaceId } = await params;
  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const [chRows, convRows] = await Promise.all([
    db.select({ id: channels.id }).from(channels).where(eq(channels.workspaceId, workspaceId)),
    db.select({ id: conversations.id }).from(conversations).where(eq(conversations.workspaceId, workspaceId)),
  ]);

  const channelIds = chRows.map((c) => c.id);
  const convoIds = convRows.map((c) => c.id);

  let pinRows: any[] = [];
  let convoPins: any[] = [];

  if (channelIds.length > 0) {
    pinRows = await db
      .select()
      .from(pins)
      .where(inArray(pins.channelId, channelIds));
  }

  if (convoIds.length > 0) {
    convoPins = await db
      .select()
      .from(pins)
      .where(inArray(pins.conversationId, convoIds));
  }

  return NextResponse.json({
    items: [...pinRows, ...convoPins].map((p) => ({
      id: p.id,
      messageId: p.messageId,
      channelId: p.channelId,
      conversationId: p.conversationId,
      pinnedById: p.pinnedById,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}
