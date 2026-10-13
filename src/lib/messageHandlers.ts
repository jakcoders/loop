import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  channelMembers,
  channels,
  conversationMembers,
  messages,
  typingEvents,
  users,
} from "@/db/schema";
import { sendPushToUsers } from "@/lib/push";
import {
  apiError,
  decodeCursor,
  encodeCursor,
  newId,
  notFound,
} from "@/lib/api";
import type { AuthUser } from "@/lib/auth";
import {
  ScopeAccess,
  scopeColumn,
  serializeMessages,
  touchReadMarker,
} from "@/lib/chat";

const TYPING_TTL_MS = 5000;

async function activeTypers(scope: ScopeAccess, excludeUserId: string) {
  const cutoff = new Date(Date.now() - TYPING_TTL_MS);
  const rows = await db
    .select({ name: users.name })
    .from(typingEvents)
    .innerJoin(users, eq(users.id, typingEvents.userId))
    .where(
      and(
        eq(typingEvents.scopeType, scope.kind),
        eq(typingEvents.scopeId, scope.id),
        gt(typingEvents.updatedAt, cutoff),
        ne(typingEvents.userId, excludeUserId)
      )
    );
  return rows.map((r) => r.name);
}

/**
 * GET messages for a scope:
 *   ?cursor&limit — cursor-paginated top-level history (newest first)
 *   ?parentId=... — thread: parent + replies (oldest first)
 *   ?after=ISO    — change feed (includes ephemeral typing users)
 */
export async function listMessages(
  req: NextRequest,
  user: AuthUser,
  scope: ScopeAccess
) {
  const col = scopeColumn(scope.kind);
  const url = req.nextUrl;
  const after = url.searchParams.get("after");
  const parentId = url.searchParams.get("parentId");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    100
  );

  // --- Change feed mode (incremental sync / realtime polling) ---
  if (after) {
    const since = new Date(after);
    if (Number.isNaN(since.getTime())) {
      return apiError(400, "INVALID_PARAM", "`after` must be an ISO-8601 timestamp");
    }
    const [rows, typing] = await Promise.all([
      db
        .select()
        .from(messages)
        .where(and(eq(col, scope.id), gt(messages.updatedAt, since)))
        .orderBy(asc(messages.updatedAt))
        .limit(200),
      activeTypers(scope, user.id),
    ]);
    const items = await serializeMessages(rows);
    const serverTime =
      rows.length > 0 ? rows[rows.length - 1].updatedAt.toISOString() : after;
    return NextResponse.json({ items, serverTime, typing });
  }

  // --- Thread mode ---
  if (parentId) {
    const parentRows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, parentId), eq(col, scope.id)))
      .limit(1);
    if (parentRows.length === 0) return notFound("Thread parent not found");

    const replyRows = await db
      .select()
      .from(messages)
      .where(eq(messages.parentId, parentId))
      .orderBy(asc(messages.createdAt));

    const items = await serializeMessages([...parentRows, ...replyRows]);
    return NextResponse.json({ items, nextCursor: null, hasMore: false });
  }

  // --- History mode (opaque cursor, newest first) ---
  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeCursor(cursorParam) : null;
  if (cursorParam && !cursor) {
    return apiError(400, "INVALID_CURSOR", "Pagination cursor is malformed");
  }

  const whereBase = and(eq(col, scope.id), isNull(messages.parentId));
  const rows = await db
    .select()
    .from(messages)
    .where(
      cursor
        ? and(
            whereBase,
            or(
              lt(messages.createdAt, cursor.createdAt),
              and(
                eq(messages.createdAt, cursor.createdAt),
                lt(messages.id, cursor.id)
              )
            )
          )
        : whereBase
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = await serializeMessages(page);
  const last = page[page.length - 1];

  return NextResponse.json({
    items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    hasMore,
    serverTime: new Date().toISOString(),
  });
}

/** POST a message to a scope — idempotent on clientMessageId. */
export async function createMessage(
  req: NextRequest,
  user: AuthUser,
  scope: ScopeAccess
) {
  const col = scopeColumn(scope.kind);

  let body: {
    body?: string;
    clientMessageId?: string;
    parentId?: string;
    attachmentIds?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const attachmentIds = (body.attachmentIds ?? []).slice(0, 10);
  const content = body.body?.trim() ?? "";
  if (!content && attachmentIds.length === 0)
    return apiError(400, "EMPTY_BODY", "Message body cannot be empty");
  if (content.length > 4000)
    return apiError(400, "BODY_TOO_LONG", "Message exceeds 4000 characters");
  const clientMessageId = body.clientMessageId?.slice(0, 64) || null;

  // Idempotency short-circuit.
  if (clientMessageId) {
    const existing = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.authorId, user.id),
          eq(messages.clientMessageId, clientMessageId)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      const [serialized] = await serializeMessages(existing);
      return NextResponse.json(serialized, { status: 200 });
    }
  }

  // Thread invariant: reply stays in the same scope as its parent, and
  // replies always attach to the thread root.
  let parentId: string | null = null;
  if (body.parentId) {
    const parentRows = await db
      .select()
      .from(messages)
      .where(eq(messages.id, body.parentId))
      .limit(1);
    const parent = parentRows[0];
    const parentScopeId =
      scope.kind === "channel" ? parent?.channelId : parent?.conversationId;
    if (!parent || parentScopeId !== scope.id) {
      return apiError(400, "INVALID_PARENT", "Thread parent not found in this scope");
    }
    parentId = parent.parentId ?? parent.id;
  }

  const id = newId();
  const created = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(messages)
      .values({
        id,
        channelId: scope.kind === "channel" ? scope.id : null,
        conversationId: scope.kind === "conversation" ? scope.id : null,
        parentId,
        authorId: user.id,
        clientMessageId,
        body: content,
      })
      .onConflictDoNothing({
        target: [messages.authorId, messages.clientMessageId],
      })
      .returning();

    if (inserted.length === 0) {
      // Lost an idempotency race — fetch the winner.
      const winner = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.authorId, user.id),
            eq(messages.clientMessageId, clientMessageId!)
          )
        )
        .limit(1);
      return { row: winner[0], deduped: true };
    }

    if (parentId) {
      await tx
        .update(messages)
        .set({
          replyCount: sql`${messages.replyCount} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(messages.id, parentId));
    }

    // Link pre-uploaded attachments. Ownership + unattached checks prevent
    // claiming someone else's upload or re-parenting an attached file.
    if (attachmentIds.length > 0) {
      await tx
        .update(attachments)
        .set({ messageId: inserted[0].id })
        .where(
          and(
            inArray(attachments.id, attachmentIds),
            eq(attachments.uploaderId, user.id),
            isNull(attachments.messageId)
          )
        );
    }

    return { row: inserted[0], deduped: false };
  });

  await touchReadMarker(user.id, scope, created.row.createdAt);
  // Sending a message implicitly ends the typing signal.
  await db
    .delete(typingEvents)
    .where(
      and(
        eq(typingEvents.scopeType, scope.kind),
        eq(typingEvents.scopeId, scope.id),
        eq(typingEvents.userId, user.id)
      )
    );

  // Push notifications: fire-and-forget after commit (never blocks the
  // response), skipping the author and anyone who muted this scope.
  if (!created.deduped) {
    void notifyScopeMembers(user, scope, content);
  }

  const [serialized] = await serializeMessages([created.row]);
  return NextResponse.json(serialized, { status: created.deduped ? 200 : 201 });
}

async function notifyScopeMembers(
  user: AuthUser,
  scope: ScopeAccess,
  content: string
) {
  try {
    let recipientIds: string[];
    let scopeLabel: string;

    if (scope.kind === "channel") {
      const [members, channelRows] = await Promise.all([
        db
          .select({ userId: channelMembers.userId })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, scope.id),
              eq(channelMembers.muted, false),
              ne(channelMembers.userId, user.id)
            )
          ),
        db
          .select({ name: channels.name })
          .from(channels)
          .where(eq(channels.id, scope.id))
          .limit(1),
      ]);
      recipientIds = members.map((m) => m.userId);
      scopeLabel = `#${channelRows[0]?.name ?? "channel"}`;
    } else {
      const members = await db
        .select({ userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, scope.id),
            eq(conversationMembers.muted, false),
            ne(conversationMembers.userId, user.id)
          )
        );
      recipientIds = members.map((m) => m.userId);
      scopeLabel = "a direct message";
    }

    await sendPushToUsers(recipientIds, {
      title: `${user.name} in ${scopeLabel}`,
      body: content.slice(0, 140) || "Sent an attachment",
      tag: `loop-${scope.kind}-${scope.id}`,
      url: "/app",
    });
  } catch {
    // Best-effort only.
  }
}

/** Register an ephemeral typing signal for a scope (TTL ~5s). */
export async function registerTyping(user: AuthUser, scope: ScopeAccess) {
  await db
    .insert(typingEvents)
    .values({ scopeType: scope.kind, scopeId: scope.id, userId: user.id })
    .onConflictDoUpdate({
      target: [typingEvents.scopeType, typingEvents.scopeId, typingEvents.userId],
      set: { updatedAt: sql`now()` },
    });
  // Opportunistic prune of stale rows.
  await db
    .delete(typingEvents)
    .where(lt(typingEvents.updatedAt, new Date(Date.now() - 60_000)));
  return NextResponse.json({ ok: true });
}
