"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AttachmentDto, Member, Me, Msg, Scope, fmtBytes, initials } from "@/lib/clientTypes";
import { outboxAdd, outboxRemove } from "@/lib/outbox";

const EMOJI_SET = ["👍", "✅", "🎉", "❤️", "😂", "🚀", "👀", "🙏"];

const FORMAT_SHORTCUTS: { label: string; markup: (sel: string) => string; placeholder: string }[] = [
  { label: "B", markup: (s) => `**${s}**`, placeholder: "Bold" },
  { label: "I", markup: (s) => `*${s}*`, placeholder: "Italic" },
  { label: "C", markup: (s) => `\`${s}\``, placeholder: "Code" },
  { label: "L", markup: (s) => `[${s}](url)`, placeholder: "Link" },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export default function ChatPane({
  me,
  scope,
  jumpToMessageId,
  onRead,
  members,
}: {
  me: Me;
  scope: Scope;
  jumpToMessageId?: string | null;
  onRead: () => void;
  members?: Member[];
}) {
  const apiBase = `/api/${scope.kind === "channel" ? "channels" : "conversations"}/${scope.id}`;
  const scopeLabel =
    scope.kind === "channel" ? `#${scope.name}` : scope.name;

  const [msgMap, setMsgMap] = useState<Record<string, Msg>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [muted, setMuted] = useState(scope.muted);
  const [emojiList, setEmojiList] = useState<string[]>(EMOJI_SET);
  const [pinnedMap, setPinnedMap] = useState<Record<string, boolean>>({});

  const toggleMute = useCallback(async () => {
    const res = await fetch(
      `/api/${scope.kind === "channel" ? "channels" : "conversations"}/${scope.id}/mute`,
      { method: "POST" }
    );
    if (res.ok) {
      const data = await res.json();
      setMuted(data.muted);
    }
  }, [scope.kind, scope.id]);

  const fetchEmoji = useCallback(async () => {
    try {
      const wsId = scope.kind === "channel" ? scope.id : scope.id;
      const res = await fetch(`/api/custom-emojis?workspaceId=${encodeURIComponent(wsId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.items?.length > 0) {
          setEmojiList([...EMOJI_SET, ...data.items.map((e: { code: string }) => e.code)]);
        }
      }
    } catch {}
  }, [scope.id]);

  const togglePin = useCallback(async (msgId: string) => {
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(msgId)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: scope.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setPinnedMap((p) => ({ ...p, [msgId]: data.pinned }));
      }
    } catch {}
  }, [scope.id]);

  const watermark = useRef<string>(new Date().toISOString());
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const highlightRef = useRef<string | null>(jumpToMessageId ?? null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  // ---- merge helper: dedupe by id, reconcile optimistic by clientMessageId --
  const upsert = useCallback((items: Msg[]) => {
    if (items.length === 0) return;
    setMsgMap((prev) => {
      const next = { ...prev };
      for (const m of items) {
        if (m.clientMessageId) delete next[`temp-${m.clientMessageId}`];
        next[m.id] = { ...m };
      }
      return next;
    });
  }, []);

  const markRead = useCallback(async () => {
    await fetch(`${apiBase}/read`, { method: "POST" }).catch(() => {});
    onReadRef.current();
  }, [apiBase]);

  // ---- initial history ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`${apiBase}/messages?limit=50`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      watermark.current = data.serverTime ?? new Date().toISOString();
      upsert(data.items);
      setNextCursor(data.nextCursor);
      setInitialLoaded(true);
      markRead();
      fetchEmoji();
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, upsert, markRead]);

  // ---- realtime change feed (poll ~2s, dedupe + reconcile + typing) ---------
  useEffect(() => {
    if (!initialLoaded) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `${apiBase}/messages?after=${encodeURIComponent(watermark.current)}`
        );
        if (!res.ok || stopped) return;
        const data = await res.json();
        setTypingUsers(data.typing ?? []);
        if (data.items.length > 0) {
          watermark.current = data.serverTime;
          upsert(data.items);
          const others: Msg[] = data.items.filter(
            (m: Msg) => m.authorId !== me.id && !m.deletedAt && !m.editedAt
          );
          if (others.length > 0) {
            markRead();
            // Browser notification when the tab is hidden (Phase 4 web track).
            if (
              document.hidden &&
              !muted &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              const m = others[others.length - 1];
              try {
                new Notification(`${m.author.name} · ${scopeLabel}`, {
                  body: m.body.slice(0, 120) || "Sent an attachment",
                  tag: `loop-${scope.id}`,
                  icon: "/icons/icon-512.png",
                });
              } catch {
                /* notifications unsupported in this context */
              }
            }
          }
        }
      } catch {
        /* transient network error — next tick retries */
      }
    };
    const interval = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [apiBase, initialLoaded, me.id, muted, scope.id, scopeLabel, upsert, markRead]);

  // ---- typing signal (throttled) --------------------------------------------
  const lastTypingSent = useRef(0);
  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2500) return;
    lastTypingSent.current = now;
    fetch(`${apiBase}/typing`, { method: "POST" }).catch(() => {});
  }, [apiBase]);

  // ---- derived lists --------------------------------------------------------
  const topLevel = useMemo(() => {
    return Object.values(msgMap)
      .filter((m) => !m.parentId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.id.localeCompare(b.id)
      );
  }, [msgMap]);

  const threadRoot = threadRootId ? (msgMap[threadRootId] ?? null) : null;
  const threadReplies = useMemo(() => {
    if (!threadRootId) return [];
    return Object.values(msgMap)
      .filter((m) => m.parentId === threadRootId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.id.localeCompare(b.id)
      );
  }, [msgMap, threadRootId]);

  // ---- autoscroll + jump-to-search-result ------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (highlightRef.current && initialLoaded) {
      const target = document.getElementById(`msg-${highlightRef.current}`);
      if (target) {
        target.scrollIntoView({ block: "center" });
        target.classList.add("bg-[#6366F1]/15");
        setTimeout(() => target.classList.remove("bg-[#6366F1]/15"), 2500);
        highlightRef.current = null;
        stickToBottom.current = false;
        return;
      }
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [topLevel.length, initialLoaded]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // ---- load older (cursor pagination) ---------------------------------------
  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const res = await fetch(
      `${apiBase}/messages?limit=50&cursor=${encodeURIComponent(nextCursor)}`
    );
    if (res.ok) {
      const data = await res.json();
      upsert(data.items);
      setNextCursor(data.nextCursor);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight + el.scrollTop;
      });
    }
    setLoadingOlder(false);
  }

  // ---- optimistic send (idempotent retry via clientMessageId) ---------------
  const sendMessage = useCallback(
    async (
      body: string,
      parentId: string | null,
      attachmentsToSend: AttachmentDto[] = [],
      retryClientId?: string
    ) => {
      const clientMessageId = retryClientId ?? crypto.randomUUID();
      const tempId = `temp-${clientMessageId}`;
      const optimistic: Msg = {
        id: tempId,
        channelId: scope.kind === "channel" ? scope.id : null,
        conversationId: scope.kind === "conversation" ? scope.id : null,
        parentId,
        authorId: me.id,
        clientMessageId,
        body,
        replyCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        author: {
          id: me.id,
          name: me.name,
          avatarColor: me.avatarColor,
          lastSeenAt: new Date().toISOString(),
        },
        reactions: [],
        attachments: attachmentsToSend,
        pending: true,
      };
      stickToBottom.current = true;
      setMsgMap((prev) => ({
        ...prev,
        [tempId]: optimistic,
        ...(parentId && prev[parentId]
          ? {
              [parentId]: {
                ...prev[parentId],
                replyCount: prev[parentId].replyCount + (retryClientId ? 0 : 1),
              },
            }
          : {}),
      }));

      // Persist to the offline outbox BEFORE attempting the network call —
      // if the tab closes or the network drops, the send survives and is
      // replayed idempotently on reconnect (same clientMessageId).
      outboxAdd({
        clientMessageId,
        scopeKind: scope.kind,
        scopeId: scope.id,
        parentId,
        body,
        attachmentIds: attachmentsToSend.map((a) => a.id),
        queuedAt: new Date().toISOString(),
      });

      try {
        const res = await fetch(`${apiBase}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            clientMessageId,
            parentId: parentId ?? undefined,
            attachmentIds:
              attachmentsToSend.length > 0
                ? attachmentsToSend.map((a) => a.id)
                : undefined,
          }),
        });
        if (!res.ok) {
          // 4xx = permanently rejected; don't let the outbox retry forever.
          if (res.status >= 400 && res.status < 500) {
            outboxRemove(clientMessageId);
          }
          throw new Error("send failed");
        }
        const serverMsg: Msg = await res.json();
        outboxRemove(clientMessageId);
        upsert([serverMsg]);
      } catch {
        // Entry stays in the persistent outbox (unless permanently rejected);
        // LoopApp's replay loop will re-send it when connectivity returns.
        setMsgMap((prev) =>
          prev[tempId]
            ? {
                ...prev,
                [tempId]: { ...prev[tempId], pending: false, failed: true },
              }
            : prev
        );
      }
    },
    [apiBase, scope, me, upsert]
  );

  const retryMessage = useCallback(
    (m: Msg) => {
      if (!m.clientMessageId) return;
      setMsgMap((prev) => {
        const next = { ...prev };
        delete next[`temp-${m.clientMessageId}`];
        return next;
      });
      sendMessage(m.body, m.parentId, m.attachments, m.clientMessageId);
    },
    [sendMessage]
  );

  // ---- message actions ------------------------------------------------------
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const res = await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) upsert([await res.json()]);
    },
    [upsert]
  );

  const editMessage = useCallback(
    async (messageId: string, body: string) => {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) upsert([await res.json()]);
    },
    [upsert]
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "DELETE",
      });
      if (res.ok) upsert([await res.json()]);
    },
    [upsert]
  );

  // ---- open thread: backfill replies ----------------------------------------
  const openThread = useCallback(
    async (rootId: string) => {
      setThreadRootId(rootId);
      const res = await fetch(`${apiBase}/messages?parentId=${rootId}`);
      if (res.ok) {
        const data = await res.json();
        upsert(data.items);
      }
    },
    [apiBase, upsert]
  );

  return (
    <div className="flex min-w-0 flex-1">
      {/* ==== main column ==== */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#0B0D12]">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-[#1E2432] px-5 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold">
              <span className="text-[#5B6476]">
                {scope.kind === "conversation"
                  ? "💬"
                  : scope.isPrivate
                    ? "🔒"
                    : "#"}
              </span>
              {scope.name}
            </h2>
            {scope.topic && (
              <p className="mt-0.5 truncate text-xs text-[#8A93A6]">
                {scope.topic}
              </p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleMute}
              title={
                muted
                  ? "Notifications muted — click to unmute"
                  : "Mute notifications for this conversation"
              }
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                muted
                  ? "border-[#F59E0B]/40 bg-[#F59E0B]/10 text-[#FCD34D]"
                  : "border-[#1E2432] bg-[#141821] text-[#8A93A6] hover:border-[#6366F1] hover:text-[#C7CEDD]"
              }`}
            >
              {muted ? "🔕 muted" : "🔔"}
            </button>
            <div className="flex items-center gap-1.5 rounded-full border border-[#1E2432] bg-[#141821] px-2.5 py-1 text-[10px] text-[#8A93A6]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22C55E]" />
              live sync
            </div>
          </div>
        </div>

        {/* messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-4"
        >
          {nextCursor && (
            <div className="mb-3 text-center">
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="rounded-full border border-[#2A3040] px-3 py-1 text-xs text-[#8A93A6] transition hover:border-[#6366F1] hover:text-[#A5B4FC] disabled:opacity-50"
              >
                {loadingOlder ? "Loading…" : "Load older messages"}
              </button>
            </div>
          )}

          {!initialLoaded ? (
            <div className="flex h-full items-center justify-center text-sm text-[#5B6476]">
              Loading messages…
            </div>
          ) : topLevel.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 text-4xl">👋</div>
              <p className="text-sm font-semibold">
                This is the start of {scopeLabel}
              </p>
              <p className="mt-1 text-xs text-[#8A93A6]">
                Send the first message — it will appear instantly in every
                other session.
              </p>
            </div>
          ) : (
            topLevel.map((m, i) => {
              const prev = topLevel[i - 1];
              const newDay =
                !prev ||
                new Date(prev.createdAt).toDateString() !==
                  new Date(m.createdAt).toDateString();
              const grouped =
                !newDay &&
                prev &&
                prev.authorId === m.authorId &&
                !prev.deletedAt &&
                new Date(m.createdAt).getTime() -
                  new Date(prev.createdAt).getTime() <
                  5 * 60_000;
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-4 flex items-center gap-3">
                      <div className="h-px flex-1 bg-[#1E2432]" />
                      <span className="text-[10px] font-semibold tracking-wider text-[#5B6476] uppercase">
                        {fmtDay(m.createdAt)}
                      </span>
                      <div className="h-px flex-1 bg-[#1E2432]" />
                    </div>
                  )}
                  <MessageRow
                    msg={m}
                    me={me}
                    grouped={!!grouped}
                    showThreadAction
                    onReact={toggleReaction}
                    onEdit={editMessage}
                    onDelete={deleteMessage}
                    onRetry={retryMessage}
                    onOpenThread={openThread}
                    onPin={togglePin}
                    isPinned={pinnedMap[m.id]}
                    emojiPicker={emojiList}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* typing indicator */}
        <div className="h-5 px-6 text-[11px] text-[#8A93A6]">
          {typingUsers.length > 0 && (
            <span className="animate-pulse">
              {typingUsers.slice(0, 3).join(", ")}{" "}
              {typingUsers.length === 1 ? "is" : "are"} typing…
            </span>
          )}
        </div>

        {/* composer */}
        <Composer
          placeholder={`Message ${scopeLabel}`}
          onSend={(body, atts) => sendMessage(body, null, atts)}
          onTyping={sendTyping}
          allowAttachments
          members={members}
        />
      </div>

      {/* ==== thread panel ==== */}
      {threadRoot && (
        <div className="flex w-[340px] shrink-0 flex-col border-l border-[#1E2432] bg-[#0E1118]">
          <div className="flex items-center justify-between border-b border-[#1E2432] px-4 py-3">
            <div>
              <h3 className="text-sm font-bold">Thread</h3>
              <p className="text-[11px] text-[#8A93A6]">{scopeLabel}</p>
            </div>
            <button
              onClick={() => setThreadRootId(null)}
              className="text-[#5B6476] hover:text-[#F5F7FA]"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <MessageRow
              msg={threadRoot}
              me={me}
              grouped={false}
              showThreadAction={false}
              onReact={toggleReaction}
              onEdit={editMessage}
              onDelete={deleteMessage}
              onRetry={retryMessage}
              onOpenThread={() => {}}
              onPin={togglePin}
              isPinned={pinnedMap[threadRoot.id]}
              emojiPicker={emojiList}
            />
            {threadReplies.length > 0 && (
              <div className="my-2 flex items-center gap-2">
                <span className="text-[10px] font-semibold text-[#5B6476] uppercase">
                  {threadReplies.length}{" "}
                  {threadReplies.length === 1 ? "reply" : "replies"}
                </span>
                <div className="h-px flex-1 bg-[#1E2432]" />
              </div>
            )}
            {threadReplies.map((m, i) => {
              const prev = threadReplies[i - 1];
              const grouped =
                prev &&
                prev.authorId === m.authorId &&
                !prev.deletedAt &&
                new Date(m.createdAt).getTime() -
                  new Date(prev.createdAt).getTime() <
                  5 * 60_000;
              return (
                  <MessageRow
                    key={m.id}
                    msg={m}
                    me={me}
                    grouped={!!grouped}
                    showThreadAction
                    onReact={toggleReaction}
                    onEdit={editMessage}
                    onDelete={deleteMessage}
                    onRetry={retryMessage}
                    onOpenThread={openThread}
                    onPin={togglePin}
                    isPinned={pinnedMap[m.id]}
                    emojiPicker={emojiList}
                  />
              );
            })}
          </div>
            <Composer
              placeholder="Reply in thread…"
              onSend={(body, atts) => sendMessage(body, threadRoot.id, atts)}
              onTyping={sendTyping}
              members={members}
            />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message row
// ---------------------------------------------------------------------------

function MessageRow({
  msg,
  me,
  grouped,
  showThreadAction,
  onReact,
  onEdit,
  onDelete,
  onRetry,
  onOpenThread,
  onPin,
  isPinned,
  emojiPicker,
}: {
  msg: Msg;
  me: Me;
  grouped: boolean;
  showThreadAction: boolean;
  onReact: (id: string, emoji: string) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  onRetry: (m: Msg) => void;
  onOpenThread: (id: string) => void;
  onPin: (id: string) => void;
  isPinned?: boolean;
  emojiPicker?: string[];
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body);
  const isMine = msg.authorId === me.id;
  const persisted = !msg.pending && !msg.failed && !msg.id.startsWith("temp-");

  if (msg.deletedAt) {
    return (
      <div className={`group flex gap-3 ${grouped ? "mt-0.5" : "mt-3"} rounded-md px-2 py-1`}>
        <div className="w-9 shrink-0" />
        <p className="text-xs text-[#5B6476] italic">This message was deleted</p>
      </div>
    );
  }

  return (
    <div
      id={`msg-${msg.id}`}
      className={`group relative flex gap-3 ${grouped ? "mt-0.5" : "mt-3"} rounded-md px-2 py-1 transition duration-500 hover:bg-[#12151E]`}
    >
      {grouped ? (
        <div className="w-9 shrink-0 pt-1 text-right">
          <span className="hidden text-[9px] text-[#5B6476] group-hover:inline">
            {fmtTime(msg.createdAt)}
          </span>
        </div>
      ) : (
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
          style={{ backgroundColor: msg.author.avatarColor }}
        >
          {initials(msg.author.name)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold">
              {msg.author.name}
              {isMine && <span className="font-normal text-[#5B6476]"> (you)</span>}
            </span>
            <span className="text-[10px] text-[#5B6476]">
              {fmtTime(msg.createdAt)}
            </span>
          </div>
        )}

        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim()) {
                    onEdit(msg.id, draft.trim());
                    setEditing(false);
                  }
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(msg.body);
                }
              }}
              rows={2}
              className="w-full resize-none rounded-lg border border-[#6366F1] bg-[#0B0D12] px-3 py-2 text-sm outline-none"
            />
            <p className="mt-0.5 text-[10px] text-[#5B6476]">
              Enter to save · Esc to cancel
            </p>
          </div>
        ) : (
          <p
            className={`text-sm leading-relaxed break-words whitespace-pre-wrap ${
              msg.pending ? "text-[#8A93A6]" : "text-[#DFE4EF]"
            }`}
          >
            {msg.body}
            {msg.editedAt && (
              <span className="ml-1.5 text-[10px] text-[#5B6476]">(edited)</span>
            )}
            {msg.pending && (
              <span className="ml-1.5 text-[10px] text-[#5B6476]">sending…</span>
            )}
          </p>
        )}

        {msg.failed && (
          <p className="mt-0.5 text-xs text-[#EF4444]">
            Failed to send.{" "}
            <button onClick={() => onRetry(msg)} className="underline">
              Retry
            </button>
          </p>
        )}

        {/* attachments */}
        {msg.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {msg.attachments.map((a) =>
              a.mimeType.startsWith("image/") ? (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${a.name} (${fmtBytes(a.size)})`}
                  className="block overflow-hidden rounded-lg border border-[#2A3040] transition hover:border-[#6366F1]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.url}
                    alt={a.name}
                    className="max-h-48 max-w-[280px] object-cover"
                    loading="lazy"
                  />
                </a>
              ) : (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-[#2A3040] bg-[#141821] px-3 py-2 text-xs text-[#C7CEDD] transition hover:border-[#6366F1]"
                >
                  <span className="text-base">📎</span>
                  <span className="max-w-[180px] truncate font-medium">
                    {a.name}
                  </span>
                  <span className="text-[#5B6476]">{fmtBytes(a.size)}</span>
                </a>
              )
            )}
          </div>
        )}

        {/* reactions */}
        {msg.reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {msg.reactions.map((r) => {
              const mine = r.userIds.includes(me.id);
              return (
                <button
                  key={r.emoji}
                  onClick={() => onReact(msg.id, r.emoji)}
                  title={r.userNames.join(", ")}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                    mine
                      ? "border-[#6366F1] bg-[#6366F1]/20 text-[#C7CEDD]"
                      : "border-[#2A3040] bg-[#141821] text-[#8A93A6] hover:border-[#6366F1]"
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="font-semibold">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* thread teaser */}
        {showThreadAction && msg.replyCount > 0 && persisted && (
          <button
            onClick={() => onOpenThread(msg.id)}
            className="mt-1.5 flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-xs text-[#A5B4FC] transition hover:border-[#2A3040] hover:bg-[#141821]"
          >
            💬 {msg.replyCount} {msg.replyCount === 1 ? "reply" : "replies"}
            <span className="text-[#5B6476]">View thread →</span>
          </button>
        )}
      </div>

      {/* hover actions */}
      {persisted && !editing && (
        <div className="absolute top-0 right-2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border border-[#2A3040] bg-[#141821] px-1 py-0.5 shadow-lg group-hover:flex">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            title="Add reaction"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-[#232B3D]"
          >
            😊
          </button>
          <button
            onClick={() => onPin(msg.id)}
            title={isPinned ? "Unpin message" : "Pin message"}
            className={`rounded px-1.5 py-0.5 text-sm hover:bg-[#232B3D] ${
              isPinned ? "text-[#6366F1]" : "text-[#8A93A6]"
            }`}
          >
            📌
          </button>
          {showThreadAction && (
            <button
              onClick={() => onOpenThread(msg.id)}
              title="Reply in thread"
              className="rounded px-1.5 py-0.5 text-sm hover:bg-[#232B3D]"
            >
              💬
            </button>
          )}
          {isMine && (
            <>
              <button
                onClick={() => {
                  setDraft(msg.body);
                  setEditing(true);
                }}
                title="Edit"
                className="rounded px-1.5 py-0.5 text-sm hover:bg-[#232B3D]"
              >
                ✏️
              </button>
              <button
                onClick={() => onDelete(msg.id)}
                title="Delete"
                className="rounded px-1.5 py-0.5 text-sm hover:bg-[#232B3D]"
              >
                🗑️
              </button>
            </>
          )}
        </div>
      )}

      {pickerOpen && (
        <div
          className="absolute top-6 right-2 z-20 flex gap-1 rounded-xl border border-[#2A3040] bg-[#141821] p-2 shadow-2xl"
          onMouseLeave={() => setPickerOpen(false)}
        >
          {emojiPicker?.map((e) => (
            <button
              key={e}
              onClick={() => {
                onReact(msg.id, e);
                setPickerOpen(false);
              }}
              className="rounded-lg p-1 text-lg transition hover:scale-125 hover:bg-[#232B3D]"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({
  placeholder,
  onSend,
  onTyping,
  allowAttachments,
  members,
}: {
  placeholder: string;
  onSend: (body: string, attachments: AttachmentDto[]) => void;
  onTyping: () => void;
  allowAttachments?: boolean;
  members?: Member[];
}) {
  const [value, setValue] = useState("");
  const [staged, setStaged] = useState<AttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!mentionQuery) submit();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setValue(v);
    if (v.trim()) onTyping();

    // Detect mention trigger
    const cursor = e.target.selectionStart ?? 0;
    const before = v.slice(0, cursor);
    const match = before.match(/@([a-zA-Z0-9_.-]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStart(cursor - match[1].length - 1);
    } else {
      if (mentionQuery !== null) setMentionQuery(null);
    }
  }

  function insertMention(name: string) {
    const before = value.slice(0, mentionStart);
    const after = value.slice(mentionStart + ("@" + (mentionQuery ?? "")).length);
    setValue(before + "@" + name + " " + after);
    setMentionQuery(null);
    setTimeout(() => {
      const el = document.activeElement as HTMLTextAreaElement;
      if (el) el.focus();
    }, 0);
  }

  function insertFormat(markup: (sel: string) => string) {
    const el = document.activeElement as HTMLTextAreaElement;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    const sel = value.slice(start, end) || "text";
    const result = markup(sel);
    const next = value.slice(0, start) + result + value.slice(end);
    setValue(next);
    onTyping();
  }

  function submit() {
    const body = value.trim();
    if (!body && staged.length === 0) return;
    onSend(body, staged);
    setValue("");
    setStaged([]);
    setUploadError(null);
    setMentionQuery(null);
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    for (const file of Array.from(files).slice(0, 5)) {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          setUploadError(data.message ?? "Upload failed");
          continue;
        }
        setStaged((prev) => [...prev, data]);
      } catch {
        setUploadError("Upload failed — check your connection");
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  const mentionMatches = mentionQuery
    ? members?.filter((m) =>
        m.name.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : [];

  return (
    <div className="border-t border-[#1E2432] p-3">
      {/* staged attachments */}
      {staged.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {staged.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1.5 rounded-lg border border-[#2A3040] bg-[#141821] px-2.5 py-1 text-xs text-[#C7CEDD]"
            >
              {a.mimeType.startsWith("image/") ? "🖼️" : "📎"} {a.name}
              <span className="text-[#5B6476]">{fmtBytes(a.size)}</span>
              <button
                onClick={() =>
                  setStaged((prev) => prev.filter((s) => s.id !== a.id))
                }
                className="text-[#5B6476] hover:text-[#EF4444]"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {uploadError && (
        <p className="mb-2 text-xs text-[#EF4444]">{uploadError}</p>
      )}

      <div className="flex items-end gap-2 rounded-xl border border-[#2A3040] bg-[#141821] p-2 transition focus-within:border-[#6366F1]">
        {/* formatting toolbar */}
        <div className="flex items-center gap-0.5 border-r border-[#1E2432] pr-1.5">
          {FORMAT_SHORTCUTS.map((f) => (
            <button
              key={f.label}
              onClick={() => insertFormat(f.markup)}
              title={f.placeholder}
              className="rounded px-1.5 py-1 text-xs font-bold text-[#8A93A6] hover:bg-[#232B3D] hover:text-[#F5F7FA]"
            >
              {f.label}
            </button>
          ))}
        </div>

        {allowAttachments && (
          <>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => uploadFiles(e.target.files)}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              title="Attach files (max 5MB each)"
              className="rounded-lg px-2 py-2 text-base text-[#8A93A6] transition hover:bg-[#232B3D] hover:text-[#F5F7FA] disabled:opacity-40"
            >
              {uploading ? "…" : "📎"}
            </button>
          </>
        )}
        <textarea
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={Math.min(value.split("\n").length, 5)}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder-[#5B6476] outline-none"
        />
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="rounded-lg bg-[#6366F1] px-3.5 py-2 text-sm font-semibold transition hover:bg-[#5558E6] disabled:opacity-30"
          title="Send (Enter)"
        >
          ➤
        </button>
      </div>

      {/* mention autocomplete */}
      {mentionQuery !== null && (
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[#2A3040] bg-[#141821]">
          {mentionMatches?.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-[#5B6476]">No matches</p>
          )}
          {mentionMatches?.map((m) => (
            <button
              key={m.id}
              onClick={() => insertMention(m.name)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-[#1A202E]"
            >
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: m.avatarColor }}
              >
                {initials(m.name)}
              </span>
              <span className="truncate">{m.name}</span>
              {m.role === "OWNER" && <span className="ml-auto text-[9px] text-[#5B6476]">OWNER</span>}
            </button>
          ))}
        </div>
      )}

      <p className="mt-1 px-1 text-[10px] text-[#5B6476]">
        Enter to send · Shift+Enter for a new line · @ to mention
      </p>
    </div>
  );
}
