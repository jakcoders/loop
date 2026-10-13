import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { apiError } from "@/lib/api";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return apiError(400, "VALIDATION_ERROR", "Email and password are required");
  }

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return apiError(401, "INVALID_CREDENTIALS", "Incorrect email or password");
  }

  const token = await createSession(user.id);
  await setSessionCookie(token);

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarColor: user.avatarColor,
    },
  });
}
