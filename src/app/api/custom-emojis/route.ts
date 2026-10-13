import { NextResponse } from "next/server";
import { db } from "@/db";
import { customEmojis } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { newId } from "@/lib/api";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const items = await db
    .select()
    .from(customEmojis)
    .where(eq(customEmojis.workspaceId, workspaceId));

  return NextResponse.json({
    items: items.map((e) => ({ name: e.name, code: e.code })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { workspaceId, name, code } = body;
  if (!workspaceId || !name || !code) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  await db.insert(customEmojis).values({
    id: newId(),
    workspaceId,
    name,
    code,
    uploadedById: user.id,
  });

  return NextResponse.json({ ok: true });
}
