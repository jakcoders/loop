import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { devices } from "@/db/schema";
import { apiError, newId, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";

const PLATFORMS = new Set(["WEB", "DESKTOP", "ANDROID", "IOS"]);

/**
 * Register a push device. One contract for every client:
 *  - Web/Desktop:  { platform, subscription: { endpoint, keys: { p256dh, auth } } }
 *  - Android:      { platform: "ANDROID", token: "<fcm-token>" }
 *  - iOS:          { platform: "IOS",     token: "<apns-token>" }
 * Upserts by endpoint (webpush) or token (native), so re-registration is safe.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: {
    platform?: string;
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    token?: string;
  };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const platform = body.platform?.toUpperCase() ?? "WEB";
  if (!PLATFORMS.has(platform)) {
    return apiError(400, "VALIDATION_ERROR", "Unknown platform", {
      platform: ["Must be WEB, DESKTOP, ANDROID, or IOS"],
    });
  }

  // --- Web Push subscription ---
  if (body.subscription?.endpoint) {
    const { endpoint, keys } = body.subscription;
    if (!keys?.p256dh || !keys?.auth) {
      return apiError(400, "VALIDATION_ERROR", "Subscription keys are required");
    }
    const existing = await db
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.endpoint, endpoint!))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(devices)
        .set({
          userId: user.id, // endpoint may move between accounts on shared browsers
          p256dh: keys.p256dh,
          auth: keys.auth,
          lastSeenAt: sql`now()`,
        })
        .where(eq(devices.id, existing[0].id));
      return NextResponse.json({ id: existing[0].id, status: "updated" });
    }

    const id = newId();
    await db.insert(devices).values({
      id,
      userId: user.id,
      platform,
      pushType: "webpush",
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
    return NextResponse.json({ id, status: "registered" }, { status: 201 });
  }

  // --- Native FCM/APNs token ---
  if (body.token) {
    const pushType = platform === "IOS" ? "apns" : "fcm";
    const existing = await db
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.token, body.token), eq(devices.pushType, pushType)))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(devices)
        .set({ userId: user.id, lastSeenAt: sql`now()` })
        .where(eq(devices.id, existing[0].id));
      return NextResponse.json({ id: existing[0].id, status: "updated" });
    }
    const id = newId();
    await db.insert(devices).values({
      id,
      userId: user.id,
      platform,
      pushType,
      token: body.token,
    });
    return NextResponse.json({ id, status: "registered" }, { status: 201 });
  }

  return apiError(400, "VALIDATION_ERROR", "Provide a subscription or token");
}

/** Unregister (logout / permission revoked). Body: { endpoint } or { token }. */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let body: { endpoint?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  if (body.endpoint) {
    await db
      .delete(devices)
      .where(and(eq(devices.endpoint, body.endpoint), eq(devices.userId, user.id)));
  } else if (body.token) {
    await db
      .delete(devices)
      .where(and(eq(devices.token, body.token), eq(devices.userId, user.id)));
  }
  return NextResponse.json({ ok: true });
}
