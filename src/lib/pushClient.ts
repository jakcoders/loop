"use client";

/** Register the service worker and subscribe this browser to Web Push. */
export async function enablePush(): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    typeof Notification === "undefined"
  ) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    if (Notification.permission !== "granted") return false;

    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await (async () => {
        const res = await fetch("/api/push/public-key");
        if (!res.ok) throw new Error("no key");
        const { publicKey } = await res.json();
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      })());

    const register = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "WEB", subscription: sub.toJSON() }),
    });
    return register.ok;
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
