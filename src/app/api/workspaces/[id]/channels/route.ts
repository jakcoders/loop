import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelMembers, channels, messages } from "@/db/schema";
import { apiError, forbidden, newId, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/chat";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return forbidden("Not a member of this workspace");

  const channelRows = await db
    .select()
    .from(channels)
    .where(eq(channels.workspaceId, workspaceId))
    .orderBy(channels.createdAt);

  const channelIds = channelRows.map((c) => c.id);
  const myMemberships =
    channelIds.length > 0
      ? await db
          .select()
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.userId, user.id),
              inArray(channelMembers.channelId, channelIds)
            )
          )
      : [];
  const memberMap = new Map(myMemberships.map((m) => [m.channelId, m]));

  // Unread = messages after my lastReadAt, authored by others, not deleted.
  const unreadRows =
    myMemberships.length > 0
      ? await db
          .select({
            channelId: messages.channelId,
            count: sql<number>`count(*)::int`,
          })
          .from(messages)
          .innerJoin(
            channelMembers,
            and(
              eq(channelMembers.channelId, messages.channelId),
              eq(channelMembers.userId, user.id)
            )
          )
          .where(
            and(
              inArray(messages.channelId, channelIds),
              sql`${messages.createdAt} > ${channelMembers.lastReadAt}`,
              sql`${messages.authorId} <> ${user.id}`,
              isNull(messages.deletedAt)
            )
          )
          .groupBy(messages.channelId)
      : [];
  const unreadMap = new Map(unreadRows.map((u) => [u.channelId, u.count]));

  const items = channelRows
    .filter((c) => !c.isPrivate || memberMap.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      topic: c.topic,
      purpose: c.purpose,
      isPrivate: c.isPrivate,
      isArchived: c.isArchived,
      isMember: memberMap.has(c.id),
      muted: memberMap.get(c.id)?.muted ?? false,
      starred: memberMap.get(c.id)?.starredAt != null,
      unreadCount: unreadMap.get(c.id) ?? 0,
    }));

  return NextResponse.json({ items });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return forbidden("Not a member of this workspace");

  let body: { name?: string; topic?: string; isPrivate?: boolean };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const name = (body.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 40);
  if (name.length < 2) {
    return apiError(400, "VALIDATION_ERROR", "Channel name is too short", {
      name: ["Channel name must be at least 2 characters"],
    });
  }

  const duplicate = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, name)))
    .limit(1);
  if (duplicate.length > 0) {
    return apiError(409, "CHANNEL_EXISTS", "A channel with this name already exists", {
      name: ["Channel name already in use"],
    });
  }

  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(channels).values({
      id,
      workspaceId,
      name,
      topic: body.topic?.trim() || null,
      isPrivate: Boolean(body.isPrivate),
      createdById: user.id,
    });
    await tx.insert(channelMembers).values({ userId: user.id, channelId: id });
  });

  return NextResponse.json(
    {
      id,
      name,
      topic: body.topic?.trim() || null,
      isPrivate: Boolean(body.isPrivate),
      isMember: true,
      unreadCount: 0,
    },
    { status: 201 }
  );
}
