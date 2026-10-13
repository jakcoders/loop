import { NextRequest } from "next/server";
import { forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { requireScopeAccess } from "@/lib/chat";
import { registerTyping } from "@/lib/messageHandlers";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;

  const scope = await requireScopeAccess(user.id, "conversation", id);
  if (!scope) return forbidden("Not a member of this conversation");
  return registerTyping(user, scope);
}
