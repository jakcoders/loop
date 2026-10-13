import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { unauthorized } from "@/lib/api";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json({ user });
}
