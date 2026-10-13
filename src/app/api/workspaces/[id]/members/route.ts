import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { forbidden, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getMembership } from "@/lib/chat";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id: workspaceId } = await ctx.params;

  const membership = await getMembership(user.id, workspaceId);
  if (!membership) return forbidden("Not a member of this workspace");

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      avatarColor: users.avatarColor,
      statusText: users.statusText,
      lastSeenAt: users.lastSeenAt,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(users.name);

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      lastSeenAt: r.lastSeenAt.toISOString(),
    })),
  });
}
