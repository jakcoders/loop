import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversationMembers } from "@/db/schema";
import { forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { requireScopeAccess } from "@/lib/chat";

/** Toggle the mute notification preference for a conversation. */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scope = await requireScopeAccess(user.id, "conversation", id);
  if (!scope) return forbidden("Not a member of this conversation");

  const updated = await db
    .update(conversationMembers)
    .set({ muted: sql`NOT ${conversationMembers.muted}` })
    .where(
      and(
        eq(conversationMembers.userId, user.id),
        eq(conversationMembers.conversationId, id)
      )
    )
    .returning({ muted: conversationMembers.muted });

  return NextResponse.json({ muted: updated[0]?.muted ?? false });
}
