import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { apiError, newId, pickAvatarColor } from "@/lib/api";
import { createSession, hashPassword, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  const fieldErrors: Record<string, string[]> = {};
  if (name.length < 2) fieldErrors.name = ["Name must be at least 2 characters"];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    fieldErrors.email = ["Enter a valid email address"];
  if (password.length < 8)
    fieldErrors.password = ["Password must be at least 8 characters"];
  if (Object.keys(fieldErrors).length > 0) {
    return apiError(400, "VALIDATION_ERROR", "Invalid registration data", fieldErrors);
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    return apiError(409, "EMAIL_TAKEN", "An account with this email already exists", {
      email: ["This email is already registered"],
    });
  }

  const id = newId();
  await db.insert(users).values({
    id,
    name,
    email,
    passwordHash: hashPassword(password),
    avatarColor: pickAvatarColor(id),
  });

  const token = await createSession(id);
  await setSessionCookie(token);

  return NextResponse.json(
    { user: { id, name, email, avatarColor: pickAvatarColor(id) } },
    { status: 201 }
  );
}
