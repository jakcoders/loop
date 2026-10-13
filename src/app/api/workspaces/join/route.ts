import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, workspaces } from "@/db/schema";
import { apiError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: { inviteCode?: string };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const inviteCode = body.inviteCode?.trim().toUpperCase() ?? "";
  if (!inviteCode) {
    return apiError(400, "VALIDATION_ERROR", "Invite code is required", {
      inviteCode: ["Enter an invite code"],
    });
  }

  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.inviteCode, inviteCode))
    .limit(1);
  const workspace = rows[0];
  if (!workspace) {
    return apiError(404, "INVALID_INVITE", "No workspace matches that invite code");
  }

  await db
    .insert(memberships)
    .values({ userId: user.id, workspaceId: workspace.id, role: "MEMBER" })
    .onConflictDoNothing();

  return NextResponse.json({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    inviteCode: workspace.inviteCode,
    role: "MEMBER",
  });
}
