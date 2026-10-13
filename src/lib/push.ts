import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appConfig, devices } from "@/db/schema";

/**
 * Web Push dispatch (VAPID). Keys are generated once and persisted in
 * app_config so subscriptions survive restarts. Native clients register
 * FCM/APNs tokens through the same /api/devices contract; delivering to
 * them requires Firebase/Apple credentials (documented in clients/README).
 */

let vapidReady: Promise<string> | null = null;

async function ensureVapid(): Promise<string> {
  if (!vapidReady) {
    vapidReady = (async () => {
      const rows = await db
        .select()
        .from(appConfig)
        .where(inArray(appConfig.key, ["vapid_public", "vapid_private"]));
      let pub = rows.find((r) => r.key === "vapid_public")?.value;
      let priv = rows.find((r) => r.key === "vapid_private")?.value;

      if (!pub || !priv) {
        const keys = webpush.generateVAPIDKeys();
        await db
          .insert(appConfig)
          .values([
            { key: "vapid_public", value: keys.publicKey },
            { key: "vapid_private", value: keys.privateKey },
          ])
          .onConflictDoNothing();
        // Re-read in case another instance won the race.
        const fresh = await db
          .select()
          .from(appConfig)
          .where(inArray(appConfig.key, ["vapid_public", "vapid_private"]));
        pub = fresh.find((r) => r.key === "vapid_public")!.value;
        priv = fresh.find((r) => r.key === "vapid_private")!.value;
      }

      webpush.setVapidDetails("mailto:team@loop.app", pub, priv);
      return pub;
    })();
  }
  return vapidReady;
}

export async function getVapidPublicKey(): Promise<string> {
  return ensureVapid();
}

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
};

/**
 * Fire a push to every registered device of the given users.
 * Expired subscriptions (404/410) are pruned. Failures never propagate —
 * push is best-effort and must not block messaging.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await ensureVapid();
    const targets = await db
      .select()
      .from(devices)
      .where(inArray(devices.userId, userIds));

    const body = JSON.stringify(payload);
    await Promise.allSettled(
      targets
        .filter((d) => d.pushType === "webpush" && d.endpoint && d.p256dh && d.auth)
        .map(async (d) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: d.endpoint!,
                keys: { p256dh: d.p256dh!, auth: d.auth! },
              },
              body,
              { TTL: 60 }
            );
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) {
              await db.delete(devices).where(eq(devices.id, d.id));
            }
          }
        })
    );
  } catch {
    // Push infrastructure issues must never affect message delivery.
  }
}
