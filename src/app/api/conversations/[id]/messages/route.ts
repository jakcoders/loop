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

  const scope = await requireScopeAccess(user.id, "conversation", id);
  if (!scope) return forbidden("Not a member of this conversation");
  return listMessages(req, user, scope);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scope = await requireScopeAccess(user.id, "conversation", id);
  if (!scope) return forbidden("Not a member of this conversation");
  return createMessage(req, user, scope);
}
