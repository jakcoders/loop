import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  channelMembers,
  channels,
  memberships,
  workspaces,
} from "@/db/schema";
import { apiError, newId, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      inviteCode: workspaces.inviteCode,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, user.id))
    .orderBy(workspaces.createdAt);

  return NextResponse.json({ items: rows });
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const name = body.name?.trim() ?? "";
  if (name.length < 2) {
    return apiError(400, "VALIDATION_ERROR", "Workspace name is too short", {
      name: ["Workspace name must be at least 2 characters"],
    });
  }

  const id = newId();
  const slug = `${slugify(name)}-${randomBytes(3).toString("hex")}`;
  const inviteCode = randomBytes(4).toString("hex").toUpperCase();
  const channelId = newId();

  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({
      id,
      name,
      slug,
      inviteCode,
      ownerId: user.id,
    });
    await tx
      .insert(memberships)
      .values({ userId: user.id, workspaceId: id, role: "OWNER" });
    await tx.insert(channels).values({
      id: channelId,
      workspaceId: id,
      name: "general",
      topic: "Team-wide announcements and conversation",
      createdById: user.id,
    });
    await tx.insert(channelMembers).values({ userId: user.id, channelId });
  });

  return NextResponse.json(
    { id, name, slug, inviteCode, role: "OWNER", defaultChannelId: channelId },
    { status: 201 }
  );
}
