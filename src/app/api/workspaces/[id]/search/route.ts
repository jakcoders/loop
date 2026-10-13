import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  channelMembers,
  channels,
  conversationMembers,
  conversations,
  messages,
  users,
} from "@/db/schema";
import { forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/chat";

/**
 * Workspace message search, scoped to what the user can actually read:
 * public channels, private channels they belong to, and their conversations.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return forbidden("Not a member of this workspace");

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ items: [] });
  const pattern = `%${q.replace(/[%_\\]/g, "\\$&")}%`;

  // Accessible channels: public, or private where I'm a member.
  const channelRows = await db
    .select({ id: channels.id, name: channels.name, isPrivate: channels.isPrivate })
    .from(channels)
    .where(eq(channels.workspaceId, workspaceId));

  const privateIds = channelRows.filter((c) => c.isPrivate).map((c) => c.id);
  const myPrivate =
    privateIds.length > 0
      ? await db
          .select({ channelId: channelMembers.channelId })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.userId, user.id),
              inArray(channelMembers.channelId, privateIds)
            )
          )
      : [];
  const myPrivateSet = new Set(myPrivate.map((m) => m.channelId));
  const accessibleChannels = channelRows.filter(
    (c) => !c.isPrivate || myPrivateSet.has(c.id)
  );
  const channelNameMap = new Map(accessibleChannels.map((c) => [c.id, c.name]));
  const accessibleChannelIds = accessibleChannels.map((c) => c.id);

  // My conversations in this workspace.
  const convRows = await db
    .select({ id: conversations.id })
    .from(conversationMembers)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMembers.conversationId)
    )
    .where(
      and(
        eq(conversationMembers.userId, user.id),
        eq(conversations.workspaceId, workspaceId)
      )
    );
  const convIds = convRows.map((c) => c.id);

  const scopeFilter =
    convIds.length > 0 && accessibleChannelIds.length > 0
      ? or(
          inArray(messages.channelId, accessibleChannelIds),
          inArray(messages.conversationId, convIds)
        )
      : convIds.length > 0
        ? inArray(messages.conversationId, convIds)
        : accessibleChannelIds.length > 0
          ? inArray(messages.channelId, accessibleChannelIds)
          : null;
  if (!scopeFilter) return NextResponse.json({ items: [] });

  const rows = await db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      conversationId: messages.conversationId,
      parentId: messages.parentId,
      body: messages.body,
      createdAt: messages.createdAt,
      authorName: users.name,
      authorColor: users.avatarColor,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(
      and(scopeFilter, ilike(messages.body, pattern), isNull(messages.deletedAt))
    )
    .orderBy(desc(messages.createdAt))
    .limit(20);

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      conversationId: r.conversationId,
      parentId: r.parentId,
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      authorName: r.authorName,
      authorColor: r.authorColor,
      channelName: r.channelId ? (channelNameMap.get(r.channelId) ?? null) : null,
    })),
  });
}
