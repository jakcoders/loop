"use client";

/**
 * Persistent offline outbox (localStorage). Every queued send carries its
 * clientMessageId, so replays against the API are idempotent — the same
 * contract the Tauri SQLite outbox and native Room/SwiftData outboxes use.
 */

export type OutboxEntry = {
  clientMessageId: string;
  scopeKind: "channel" | "conversation";
  scopeId: string;
  parentId: string | null;
  body: string;
  attachmentIds: string[];
  queuedAt: string;
};

const KEY = "loop_outbox_v1";

function read(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-100)));
  } catch {
    /* storage full / unavailable */
  }
}

export function outboxList(): OutboxEntry[] {
  return read();
}

export function outboxAdd(entry: OutboxEntry) {
  const entries = read().filter(
    (e) => e.clientMessageId !== entry.clientMessageId
  );
  entries.push(entry);
  write(entries);
}

export function outboxRemove(clientMessageId: string) {
  write(read().filter((e) => e.clientMessageId !== clientMessageId));
}

/**
 * Replay every queued send. Safe to call repeatedly and from multiple
 * places — server-side idempotency on (authorId, clientMessageId)
 * guarantees no duplicates.
 */
export async function outboxReplay(): Promise<number> {
  const entries = read();
  let sent = 0;
  for (const e of entries) {
    try {
      const res = await fetch(
        `/api/${e.scopeKind === "channel" ? "channels" : "conversations"}/${e.scopeId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: e.body,
            clientMessageId: e.clientMessageId,
            parentId: e.parentId ?? undefined,
            attachmentIds:
              e.attachmentIds.length > 0 ? e.attachmentIds : undefined,
          }),
        }
      );
      if (res.ok) {
        outboxRemove(e.clientMessageId);
        sent++;
      } else if (res.status === 400 || res.status === 403) {
        // Permanently rejected — drop it rather than retry forever.
        outboxRemove(e.clientMessageId);
      }
    } catch {
      // Still offline — keep the entry for the next replay.
    }
  }
  return sent;
}
