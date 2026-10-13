import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channelMembers, channels, memberships, messages } from "@/db/schema";
import { apiError, forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/chat";

/**
 * Channel update (admin/owner only):
 * PATCH /api/channels/{id}
 * { name?, topic?, purpose?, isArchived? }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: channelId } = await ctx.params;

  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .then((r) => r[0]);

  if (!channel) return apiError(404, "NOT_FOUND", "Channel not found");

  // Only owner or admin can edit
  const membership = await getMembership(user.id, channel.workspaceId);
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return forbidden("Only owners and admins can edit channels");
  }

  const body = await req.json();
  const updates: Partial<typeof channels.$inferInsert> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.topic !== undefined) updates.topic = body.topic;
  if (body.purpose !== undefined) updates.purpose = body.purpose;
  if (body.isArchived !== undefined) updates.isArchived = body.isArchived;

  if (Object.keys(updates).length === 0) {
    return apiError(400, "VALIDATION_ERROR", "No fields to update");
  }

  if (updates.name) {
    // Check for duplicate name in workspace
    const dup = await db
      .select()
      .from(channels)
      .where(
        and(eq(channels.workspaceId, channel.workspaceId), eq(channels.name, updates.name!))
      )
      .then((r) => r[0]);
    if (dup && dup.id !== channelId) {
      return apiError(409, "CONFLICT", "A channel with that name already exists");
    }
  }

  await db.update(channels).set(updates).where(eq(channels.id, channelId));

  // Clear message cache / trigger sync
  return NextResponse.json({ ok: true });
}

/**
 * Star/unstar a channel for the current user.
 * POST /api/channels/{id}/star
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id: channelId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { action } = body; // "star" | "unstar"

  const channel = await db
    .select()
    .from(channels)
    .where(eq(channels.id, channelId))
    .then((r) => r[0]);

  if (!channel) return apiError(404, "NOT_FOUND", "Channel not found");

  const membership = await db
    .select()
    .from(channelMembers)
    .where(
      and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, channelId))
    )
    .then((r) => r[0]);

  if (!membership) return forbidden("Not a member of this channel");

  if (action === "star") {
    await db
      .update(channelMembers)
      .set({ starredAt: new Date() })
      .where(
        and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, channelId))
      );
  } else {
    await db
      .update(channelMembers)
      .set({ starredAt: null })
      .where(
        and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, channelId))
      );
  }

  return NextResponse.json({ ok: true });
}
