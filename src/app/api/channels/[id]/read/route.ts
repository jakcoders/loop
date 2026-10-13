import { NextRequest, NextResponse } from "next/server";
import { forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { requireScopeAccess, touchReadMarker } from "@/lib/chat";

/** Mark a channel read (read marker). */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scope = await requireScopeAccess(user.id, "channel", id);
  if (!scope) return forbidden("Not a member of this channel");

  const now = new Date();
  await touchReadMarker(user.id, scope, now);
  return NextResponse.json({ ok: true, readAt: now.toISOString() });
}
