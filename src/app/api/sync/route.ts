import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { channelMembers, conversationMembers, messages } from "@/db/schema";
import { apiError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { serializeMessages } from "@/lib/chat";

const PAGE = 500;

/**
 * GET /api/sync?since=<ISO>
 *
 * Offline-recovery change feed across every scope the user can read:
 * all channels and conversations they are a member of. Returns messages
 * ordered by `updatedAt` ascending — creates, edits, reaction bumps, and
 * soft-delete tombstones all flow through, so clients can prune local
 * caches and reconcile optimistic rows by `clientMessageId`.
 *
 * Reconnect contract: call with your last `serverTime`, apply items in
 * order (server wins), then resume the per-scope live feed.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sinceParam = req.nextUrl.searchParams.get("since");
  if (!sinceParam) {
    return apiError(400, "MISSING_PARAM", "`since` (ISO-8601) is required");
  }
  const since = new Date(sinceParam);
  if (Number.isNaN(since.getTime())) {
    return apiError(400, "INVALID_PARAM", "`since` must be an ISO-8601 timestamp");
  }

  const [myChannels, myConvs] = await Promise.all([
    db
      .select({ id: channelMembers.channelId })
      .from(channelMembers)
      .where(eq(channelMembers.userId, user.id)),
    db
      .select({ id: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(eq(conversationMembers.userId, user.id)),
  ]);
  const channelIds = myChannels.map((c) => c.id);
  const convIds = myConvs.map((c) => c.id);

  const scopeFilter =
    channelIds.length > 0 && convIds.length > 0
      ? or(
          inArray(messages.channelId, channelIds),
          inArray(messages.conversationId, convIds)
        )
      : channelIds.length > 0
        ? inArray(messages.channelId, channelIds)
        : convIds.length > 0
          ? inArray(messages.conversationId, convIds)
          : null;

  if (!scopeFilter) {
    return NextResponse.json({
      items: [],
      serverTime: new Date().toISOString(),
      hasMore: false,
    });
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(scopeFilter, gt(messages.updatedAt, since)))
    .orderBy(asc(messages.updatedAt), asc(messages.id))
    .limit(PAGE + 1);

  const hasMore = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const items = await serializeMessages(page);
  const serverTime =
    page.length > 0
      ? page[page.length - 1].updatedAt.toISOString()
      : new Date().toISOString();

  return NextResponse.json({ items, serverTime, hasMore });
}
