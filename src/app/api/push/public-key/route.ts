import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getVapidPublicKey } from "@/lib/push";

export async function GET() {
  const user = await getCurrentUser({ heartbeat: false });
  if (!user) return unauthorized();
  return NextResponse.json({ publicKey: await getVapidPublicKey() });
}
