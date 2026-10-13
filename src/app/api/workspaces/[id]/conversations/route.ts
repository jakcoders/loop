import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  conversationMembers,
  conversations,
  memberships,
  messages,
  users,
} from "@/db/schema";
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

  // My conversations in this workspace.
  const convRows = await db
    .select({
      id: conversations.id,
      isGroup: conversations.isGroup,
      muted: conversationMembers.muted,
      lastReadAt: conversationMembers.lastReadAt,
    })
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

  if (convRows.length === 0) return NextResponse.json({ items: [] });
  const convIds = convRows.map((c) => c.id);

  const [memberRows, unreadRows] = await Promise.all([
    db
      .select({
        conversationId: conversationMembers.conversationId,
        userId: users.id,
        name: users.name,
        avatarColor: users.avatarColor,
        lastSeenAt: users.lastSeenAt,
      })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(inArray(conversationMembers.conversationId, convIds)),
    db
      .select({
        conversationId: messages.conversationId,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, user.id)
        )
      )
      .where(
        and(
          inArray(messages.conversationId, convIds),
          sql`${messages.createdAt} > ${conversationMembers.lastReadAt}`,
          sql`${messages.authorId} <> ${user.id}`,
          isNull(messages.deletedAt)
        )
      )
      .groupBy(messages.conversationId),
  ]);

  const unreadMap = new Map(unreadRows.map((u) => [u.conversationId, u.count]));

  const items = convRows.map((c) => {
    const others = memberRows
      .filter((m) => m.conversationId === c.id && m.userId !== user.id)
      .map((m) => ({
        id: m.userId,
        name: m.name,
        avatarColor: m.avatarColor,
        lastSeenAt: m.lastSeenAt.toISOString(),
      }));
    return {
      id: c.id,
      isGroup: c.isGroup,
      others,
      name: others.map((o) => o.name).join(", ") || "Just you",
      muted: c.muted,
      unreadCount: unreadMap.get(c.id) ?? 0,
    };
  });

  return NextResponse.json({ items });
}

/**
 * Create (or return the existing) DM. Idempotent via unique (workspaceId, dmKey).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return forbidden("Not a member of this workspace");

  let body: { memberIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const otherIds = Array.from(
    new Set((body.memberIds ?? []).filter((m) => m && m !== user.id))
  );
  if (otherIds.length === 0) {
    return apiError(400, "VALIDATION_ERROR", "At least one other member is required");
  }
  if (otherIds.length > 8) {
    return apiError(400, "VALIDATION_ERROR", "Group DMs are limited to 9 people");
  }

  // Every participant must belong to this workspace (tenant isolation).
  const validMembers = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        inArray(memberships.userId, otherIds)
      )
    );
  if (validMembers.length !== otherIds.length) {
    return forbidden("All participants must be members of this workspace");
  }

  const participantIds = [user.id, ...otherIds].sort();
  const dmKey = participantIds.join(":");
  const isGroup = participantIds.length > 2;

  // Idempotent creation: insert, on dmKey conflict fetch existing.
  const convId = newId();
  const inserted = await db
    .insert(conversations)
    .values({ id: convId, workspaceId, isGroup, dmKey })
    .onConflictDoNothing({
      target: [conversations.workspaceId, conversations.dmKey],
    })
    .returning();

  let conversationId: string;
  if (inserted.length > 0) {
    conversationId = inserted[0].id;
    await db
      .insert(conversationMembers)
      .values(participantIds.map((userId) => ({ userId, conversationId })))
      .onConflictDoNothing();
  } else {
    const existing = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.dmKey, dmKey)
        )
      )
      .limit(1);
    conversationId = existing[0].id;
  }

  const others = await db
    .select({
      id: users.id,
      name: users.name,
      avatarColor: users.avatarColor,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .where(inArray(users.id, otherIds));

  return NextResponse.json(
    {
      id: conversationId,
      isGroup,
      others: others.map((o) => ({ ...o, lastSeenAt: o.lastSeenAt.toISOString() })),
      name: others.map((o) => o.name).join(", "),
      muted: false,
      unreadCount: 0,
    },
    { status: inserted.length > 0 ? 201 : 200 }
  );
}
