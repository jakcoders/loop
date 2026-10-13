import { NextRequest } from "next/server";
import { forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { requireScopeAccess } from "@/lib/chat";
import { createMessage, listMessages } from "@/lib/messageHandlers";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scope = await requireScopeAccess(user.id, "channel", id);
  if (!scope) return forbidden("Not a member of this channel");
  return listMessages(req, user, scope);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scope = await requireScopeAccess(user.id, "channel", id);
  if (!scope) return forbidden("Not a member of this channel");
  return createMessage(req, user, scope);
}
