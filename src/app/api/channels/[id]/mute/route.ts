import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { channelMembers } from "@/db/schema";
import { forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { requireScopeAccess } from "@/lib/chat";

/** Toggle the mute notification preference for a channel. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scope = await requireScopeAccess(user.id, "channel", id);
  if (!scope) return forbidden("Not a member of this channel");

  const updated = await db
    .update(channelMembers)
    .set({ muted: sql`NOT ${channelMembers.muted}` })
    .where(
      and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, id))
    )
    .returning({ muted: channelMembers.muted });

  return NextResponse.json({ muted: updated[0]?.muted ?? false });
}
