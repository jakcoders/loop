import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, or, ilike } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase();

  if (!q || q.length < 1) {
    return NextResponse.json({ items: [] });
  }

  const results = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarColor: users.avatarColor,
      statusText: users.statusText,
    })
    .from(users)
    .where(
      or(
        ilike(users.name, `%${q}%`),
        ilike(users.email, `%${q}%`),
        ilike(users.name, `${q}%`)
      )
    )
    .limit(20);

  return NextResponse.json({ items: results });
}
