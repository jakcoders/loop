import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  channelMembers,
  channels,
  conversationMembers,
  conversations,
  memberships,
  messages,
  reactions,
  users,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// Authorization guards — enforced in the API, not just the UI
// ---------------------------------------------------------------------------

export async function getMembership(userId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export type ScopeKind = "channel" | "conversation";

export type ScopeAccess = {
  kind: ScopeKind;
  id: string;
  workspaceId: string;
};

/**
 * Verifies tenant + scope permission for a channel or conversation.
 * Public channels are auto-joined on first access; private channels and
 * conversations require an existing member row.
 */
export async function requireScopeAccess(
  userId: string,
  kind: ScopeKind,
  scopeId: string
): Promise<ScopeAccess | null> {
  if (kind === "channel") {
    const rows = await db
      .select()
      .from(channels)
      .where(eq(channels.id, scopeId))
      .limit(1);
    const channel = rows[0];
    if (!channel) return null;

    const membership = await getMembership(userId, channel.workspaceId);
    if (!membership) return null;

    const cm = await db
      .select()
      .from(channelMembers)
      .where(
        and(
          eq(channelMembers.userId, userId),
          eq(channelMembers.channelId, scopeId)
        )
      )
      .limit(1);

    if (cm.length === 0) {
      if (channel.isPrivate) return null;
      await db
        .insert(channelMembers)
        .values({ userId, channelId: scopeId })
        .onConflictDoNothing();
    }
    return { kind, id: scopeId, workspaceId: channel.workspaceId };
  }

  const rows = await db
    .select({
      conversation: conversations,
      member: conversationMembers,
    })
    .from(conversations)
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, userId)
      )
    )
    .where(eq(conversations.id, scopeId))
    .limit(1);
  if (rows.length === 0) return null;
  return { kind, id: scopeId, workspaceId: rows[0].conversation.workspaceId };
}

/** Column + table helpers for scope-generic message queries. */
export function scopeColumn(kind: ScopeKind) {
  return kind === "channel" ? messages.channelId : messages.conversationId;
}

export async function touchReadMarker(
  userId: string,
  scope: ScopeAccess,
  readAt: Date
) {
  if (scope.kind === "channel") {
    await db
      .update(channelMembers)
      .set({ lastReadAt: readAt })
      .where(
        and(
          eq(channelMembers.userId, userId),
          eq(channelMembers.channelId, scope.id)
        )
      );
  } else {
    await db
      .update(conversationMembers)
      .set({ lastReadAt: readAt })
      .where(
        and(
          eq(conversationMembers.userId, userId),
          eq(conversationMembers.conversationId, scope.id)
        )
      );
  }
}

// ---------------------------------------------------------------------------
// Message serialization — responses always include author + reactions + thread meta
// ---------------------------------------------------------------------------

export type MessageRow = typeof messages.$inferSelect;

export type SerializedMessage = {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  parentId: string | null;
  authorId: string;
  clientMessageId: string | null;
  body: string;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: {
    id: string;
    name: string;
    avatarColor: string;
    lastSeenAt: string;
  };
  reactions: { emoji: string; count: number; userIds: string[]; userNames: string[] }[];
  attachments: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    url: string;
  }[];
};

export async function serializeMessages(
  rows: MessageRow[]
): Promise<SerializedMessage[]> {
  if (rows.length === 0) return [];

  const authorIds = Array.from(new Set(rows.map((r) => r.authorId)));
  const messageIds = rows.map((r) => r.id);

  const attachmentRows = await db
    .select({
      id: attachments.id,
      messageId: attachments.messageId,
      name: attachments.name,
      mimeType: attachments.mimeType,
      size: attachments.size,
    })
    .from(attachments)
    .where(inArray(attachments.messageId, messageIds));

  const attachmentMap = new Map<
    string,
    { id: string; name: string; mimeType: string; size: number; url: string }[]
  >();
  for (const a of attachmentRows) {
    if (!a.messageId) continue;
    const list = attachmentMap.get(a.messageId) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      url: `/api/files/${a.id}`,
    });
    attachmentMap.set(a.messageId, list);
  }

  const [authorRows, reactionRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        avatarColor: users.avatarColor,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(inArray(users.id, authorIds)),
    db
      .select({
        messageId: reactions.messageId,
        emoji: reactions.emoji,
        userId: reactions.userId,
        userName: users.name,
      })
      .from(reactions)
      .innerJoin(users, eq(users.id, reactions.userId))
      .where(inArray(reactions.messageId, messageIds)),
  ]);

  const authorMap = new Map(authorRows.map((a) => [a.id, a]));

  const reactionMap = new Map<
    string,
    Map<string, { userIds: string[]; userNames: string[] }>
  >();
  for (const r of reactionRows) {
    let perMessage = reactionMap.get(r.messageId);
    if (!perMessage) {
      perMessage = new Map();
      reactionMap.set(r.messageId, perMessage);
    }
    let agg = perMessage.get(r.emoji);
    if (!agg) {
      agg = { userIds: [], userNames: [] };
      perMessage.set(r.emoji, agg);
    }
    agg.userIds.push(r.userId);
    agg.userNames.push(r.userName);
  }

  return rows.map((m) => {
    const author = authorMap.get(m.authorId);
    const perMessage = reactionMap.get(m.id);
    const deleted = m.deletedAt != null;
    return {
      id: m.id,
      channelId: m.channelId,
      conversationId: m.conversationId,
      parentId: m.parentId,
      authorId: m.authorId,
      clientMessageId: m.clientMessageId,
      body: deleted ? "" : m.body,
      replyCount: m.replyCount,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      author: {
        id: m.authorId,
        name: author?.name ?? "Unknown",
        avatarColor: author?.avatarColor ?? "#6366F1",
        lastSeenAt: author?.lastSeenAt
          ? author.lastSeenAt.toISOString()
          : new Date(0).toISOString(),
      },
      reactions: perMessage
        ? Array.from(perMessage.entries()).map(([emoji, agg]) => ({
            emoji,
            count: agg.userIds.length,
            userIds: agg.userIds,
            userNames: agg.userNames,
          }))
        : [],
      attachments: deleted ? [] : (attachmentMap.get(m.id) ?? []),
    };
  });
}
