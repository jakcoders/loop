"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ChatPane from "@/components/ChatPane";
import {
  Channel,
  Conversation,
  Me,
  Member,
  Scope,
  SearchResult,
  Workspace,
  initials,
  isOnline,
} from "@/lib/clientTypes";
import { enablePush } from "@/lib/pushClient";
import { outboxList, outboxReplay } from "@/lib/outbox";

export default function LoopApp({ me }: { me: Me }) {
  const router = useRouter();

  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeScope, setActiveScope] = useState<Scope | null>(null);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [modal, setModal] = useState<
    null | "createWs" | "joinWs" | "createChannel" | "search" | "groupDm" | "settings"
  >(null);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<"system" | "dark" | "light">("system");

  const activeWs = workspaces?.find((w) => w.id === activeWsId) ?? null;

  // ---- theme sync ----
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setTheme(s.theme ?? "system");
        applyTheme(s.theme ?? "system");
      })
      .catch(() => {});
  }, []);

  const toggleTheme = async () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme }),
      });
    } catch {}
  };

  // ---- workspace bootstrap -------------------------------------------------
  const loadWorkspaces = useCallback(async () => {
    const res = await fetch("/api/workspaces");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const data = await res.json();
    setWorkspaces(data.items);
    setActiveWsId((prev) =>
      prev && data.items.some((w: Workspace) => w.id === prev)
        ? prev
        : (data.items[0]?.id ?? null)
    );
  }, [router]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  // ---- sidebar polling (channels, DMs, members, unread, presence) ----------
  const loadSidebar = useCallback(async (wsId: string) => {
    const [chRes, convRes, memRes] = await Promise.all([
      fetch(`/api/workspaces/${wsId}/channels`),
      fetch(`/api/workspaces/${wsId}/conversations`),
      fetch(`/api/workspaces/${wsId}/members`),
    ]);
    let firstChannel: Channel | null = null;
    if (chRes.ok) {
      const data = await chRes.json();
      setChannels(data.items);
      firstChannel = data.items[0] ?? null;
    }
    if (convRes.ok) {
      const data = await convRes.json();
      setConversations(data.items);
    }
    if (memRes.ok) {
      const data = await memRes.json();
      setMembers(data.items);
    }
    setActiveScope((prev) => {
      if (prev) return prev;
      if (!firstChannel) return null;
      return {
        kind: "channel" as const,
        id: firstChannel.id,
        name: firstChannel.name,
        topic: firstChannel.topic,
        isPrivate: firstChannel.isPrivate,
        muted: firstChannel.muted,
      };
    });
  }, []);

  useEffect(() => {
    if (!activeWsId) return;
    setChannels([]);
    setConversations([]);
    setActiveScope(null);
    loadSidebar(activeWsId);
    const interval = setInterval(() => loadSidebar(activeWsId), 7000);
    return () => clearInterval(interval);
  }, [activeWsId, loadSidebar]);

  const clearUnread = useCallback((scope: Scope) => {
    if (scope.kind === "channel") {
      setChannels((prev) =>
        prev.map((c) => (c.id === scope.id ? { ...c, unreadCount: 0 } : c))
      );
    } else {
      setConversations((prev) =>
        prev.map((c) => (c.id === scope.id ? { ...c, unreadCount: 0 } : c))
      );
    }
  }, []);

  function openChannel(c: Channel) {
    setJumpTo(null);
    setActiveScope({
      kind: "channel",
      id: c.id,
      name: c.name,
      topic: c.topic,
      isPrivate: c.isPrivate,
      muted: c.muted,
    });
  }

  function openConversation(c: Conversation) {
    setJumpTo(null);
    setActiveScope({
      kind: "conversation",
      id: c.id,
      name: c.name,
      topic: null,
      isPrivate: true,
      muted: c.muted,
    });
  }

  async function openDmWith(memberId: string) {
    if (!activeWsId || memberId === me.id) return;
    const res = await fetch(`/api/workspaces/${activeWsId}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: [memberId] }),
    });
    if (!res.ok) return;
    const conv: Conversation = await res.json();
    setConversations((prev) =>
      prev.some((c) => c.id === conv.id) ? prev : [...prev, conv]
    );
    openConversation(conv);
  }

  function openSearchResult(r: SearchResult) {
    setModal(null);
    const targetId = r.parentId ?? r.id;
    if (r.channelId) {
      const ch = channels.find((c) => c.id === r.channelId);
      if (ch) {
        setJumpTo(targetId);
        setActiveScope({
          kind: "channel",
          id: ch.id,
          name: ch.name,
          topic: ch.topic,
          isPrivate: ch.isPrivate,
          muted: ch.muted,
        });
      }
    } else if (r.conversationId) {
      const conv = conversations.find((c) => c.id === r.conversationId);
      if (conv) {
        setJumpTo(targetId);
        openConversation(conv);
        setJumpTo(targetId);
      }
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function copyInvite() {
    if (!activeWs) return;
    navigator.clipboard?.writeText(activeWs.inviteCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Notification permission (needs a user gesture) → then Web Push
  // subscription registered via /api/devices.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      enablePush();
      return;
    }
    if (Notification.permission !== "default") return;
    const request = () => {
      Notification.requestPermission()
        .then((p) => {
          if (p === "granted") enablePush();
        })
        .catch(() => {});
      window.removeEventListener("pointerdown", request);
    };
    window.addEventListener("pointerdown", request, { once: true });
    return () => window.removeEventListener("pointerdown", request);
  }, []);

  // ---- advanced offline sync: connectivity + persistent outbox replay ----
  const [online, setOnline] = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueuedCount(outboxList().length);

    const replay = async () => {
      setQueuedCount(outboxList().length);
      const sent = await outboxReplay();
      if (sent > 0 && activeWsId) loadSidebar(activeWsId);
      setQueuedCount(outboxList().length);
    };

    const goOnline = () => {
      setOnline(true);
      replay();
    };
    const goOffline = () => setOnline(false);

    // Replay anything queued from a previous session on load.
    replay();

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    // Periodic sweep: catches sends that failed while technically "online".
    const sweep = setInterval(() => {
      if (navigator.onLine && outboxList().length > 0) replay();
      else setQueuedCount(outboxList().length);
    }, 5000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(sweep);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWsId]);

  // Cmd/Ctrl+K opens search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal((m) => (m === "search" ? null : "search"));
      } else if (e.key === "Escape") {
        setModal(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- empty state: no workspace yet ---------------------------------------
  if (workspaces !== null && workspaces.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-[#1E2432] bg-[#141821] p-8 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-2xl font-bold">
            ∞
          </div>
          <h1 className="text-xl font-semibold">
            Welcome to Loop, {me.name.split(" ")[0]}
          </h1>
          <p className="mt-2 text-sm text-[#8A93A6]">
            Create a workspace for your team, or join an existing one with an
            invite code.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => setModal("createWs")}
              className="rounded-lg bg-[#6366F1] py-2.5 text-sm font-semibold transition hover:bg-[#5558E6]"
            >
              Create a workspace
            </button>
            <button
              onClick={() => setModal("joinWs")}
              className="rounded-lg border border-[#2A3040] py-2.5 text-sm font-semibold text-[#C7CEDD] transition hover:bg-[#1A202E]"
            >
              Join with invite code
            </button>
            <button
              onClick={logout}
              className="text-xs text-[#8A93A6] hover:text-[#F5F7FA]"
            >
              Sign out
            </button>
          </div>
        </div>
        {(modal === "createWs" || modal === "joinWs") && (
          <WorkspaceModal
            kind={modal === "joinWs" ? "join" : "create"}
            onClose={() => setModal(null)}
            onDone={() => {
              setModal(null);
              loadWorkspaces();
            }}
          />
        )}
      </div>
    );
  }

  const onlineCount = members.filter((m) => isOnline(m.lastSeenAt)).length;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {(!online || queuedCount > 0) && (
        <div
          className={`flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium ${
            online
              ? "bg-[#F59E0B]/15 text-[#FCD34D]"
              : "bg-[#EF4444]/15 text-[#FCA5A5]"
          }`}
        >
          {online ? (
            <>⏳ Sending {queuedCount} queued message{queuedCount === 1 ? "" : "s"}…</>
          ) : (
            <>
              ⚠️ You&apos;re offline — messages will be queued and sent
              automatically when you reconnect
              {queuedCount > 0 && ` (${queuedCount} waiting)`}
            </>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ---- Workspace rail ---- */}
      <div className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-[#1E2432] bg-[#070910] py-3">
        {(workspaces ?? []).map((w) => (
          <button
            key={w.id}
            onClick={() => setActiveWsId(w.id)}
            title={w.name}
            className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold transition ${
              w.id === activeWsId
                ? "bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white shadow-lg shadow-[#6366F1]/30"
                : "bg-[#1A202E] text-[#8A93A6] hover:bg-[#232B3D] hover:text-[#F5F7FA]"
            }`}
          >
            {initials(w.name)}
          </button>
        ))}
        <button
          onClick={() => setModal("createWs")}
          title="Create workspace"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-[#2A3040] text-lg text-[#8A93A6] transition hover:border-[#6366F1] hover:text-[#A5B4FC]"
        >
          +
        </button>
        <button
          onClick={() => setModal("joinWs")}
          title="Join workspace with invite code"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-[#2A3040] text-sm text-[#8A93A6] transition hover:border-[#6366F1] hover:text-[#A5B4FC]"
        >
          ↳
        </button>
        <div className="mt-auto flex flex-col items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold"
            style={{ backgroundColor: me.avatarColor }}
            title={`${me.name} (you)`}
          >
            {initials(me.name)}
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="text-[10px] text-[#5B6476] hover:text-[#F5F7FA]"
          >
            Exit
          </button>
          <button
            onClick={() => setModal("settings")}
            title="Settings & profile"
            className="text-[10px] text-[#5B6476] hover:text-[#F5F7FA]"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* ---- Sidebar ---- */}
      <div className="flex w-60 shrink-0 flex-col border-r border-[#1E2432] bg-[#0E1118]">
        <div className="border-b border-[#1E2432] px-4 py-3.5">
          <h2 className="truncate text-sm font-bold">{activeWs?.name ?? "…"}</h2>
          <p className="mt-0.5 text-[11px] text-[#8A93A6]">
            {onlineCount} online · {members.length} member
            {members.length === 1 ? "" : "s"}
          </p>
        </div>

        <div className="px-3 pt-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setModal("search")}
              className="flex-1 items-center gap-2 rounded-lg border border-[#2A3040] bg-[#141821] px-3 py-1.5 text-xs text-[#5B6476] transition hover:border-[#6366F1]"
            >
              🔍 Search messages…
              <span className="ml-auto rounded border border-[#2A3040] px-1 text-[9px]">
                ⌘K
              </span>
            </button>
            <button
              onClick={toggleTheme}
              title="Toggle dark/light theme"
              className="rounded-lg border border-[#2A3040] bg-[#141821] px-2.5 py-1.5 text-sm text-[#8A93A6] hover:border-[#6366F1] hover:text-[#F5F7FA]"
            >
              {theme === "dark" ? "☀️" : theme === "light" ? "🌙" : "🌓"}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {/* Channels */}
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-wider text-[#5B6476] uppercase">
              Channels
            </span>
            <button
              onClick={() => setModal("createChannel")}
              title="Create channel"
              className="rounded px-1.5 text-sm text-[#8A93A6] hover:bg-[#1A202E] hover:text-[#F5F7FA]"
            >
              +
            </button>
          </div>
          {channels.map((c) => {
            const active =
              activeScope?.kind === "channel" && activeScope.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => openChannel(c)}
                className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                  active
                    ? "bg-[#6366F1]/20 text-[#E0E4FD]"
                    : c.unreadCount > 0
                      ? "font-semibold text-[#F5F7FA] hover:bg-[#1A202E]"
                      : "text-[#8A93A6] hover:bg-[#1A202E] hover:text-[#C7CEDD]"
                }`}
              >
                <span className="text-[#5B6476]">{c.isPrivate ? "🔒" : "#"}</span>
                <span className="truncate">{c.name}</span>
                {c.unreadCount > 0 && !active && (
                  <span className="ml-auto rounded-full bg-[#EF4444] px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {c.unreadCount > 99 ? "99+" : c.unreadCount}
                  </span>
                )}
              </button>
            );
          })}

          {/* Direct messages */}
          <div className="mt-5 mb-1 flex items-center justify-between px-2">
            <span className="text-[11px] font-semibold tracking-wider text-[#5B6476] uppercase">
              Direct messages
            </span>
            <button
              onClick={() => setModal("groupDm")}
              title="New group DM"
              className="rounded px-1.5 text-sm text-[#8A93A6] hover:bg-[#1A202E] hover:text-[#F5F7FA]"
            >
              +
            </button>
          </div>
          {conversations.map((c) => {
            const active =
              activeScope?.kind === "conversation" && activeScope.id === c.id;
            const other = c.others[0];
            const online = other ? isOnline(other.lastSeenAt) : false;
            return (
              <button
                key={c.id}
                onClick={() => openConversation(c)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${
                  active
                    ? "bg-[#6366F1]/20 text-[#E0E4FD]"
                    : c.unreadCount > 0
                      ? "font-semibold text-[#F5F7FA] hover:bg-[#1A202E]"
                      : "text-[#8A93A6] hover:bg-[#1A202E] hover:text-[#C7CEDD]"
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    online ? "bg-[#22C55E]" : "bg-[#3A4356]"
                  }`}
                />
                <span className="truncate">{c.name}</span>
                {c.unreadCount > 0 && !active && (
                  <span className="ml-auto rounded-full bg-[#EF4444] px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {c.unreadCount > 99 ? "99+" : c.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
          {conversations.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-[#5B6476]">
              Click a member below to start a DM
            </p>
          )}

          {/* Members */}
          <div className="mt-5 mb-1 px-2 text-[11px] font-semibold tracking-wider text-[#5B6476] uppercase">
            Members
          </div>
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => openDmWith(m.id)}
              disabled={m.id === me.id}
              title={m.id === me.id ? undefined : `Message ${m.name}`}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[#8A93A6] transition enabled:hover:bg-[#1A202E] enabled:hover:text-[#C7CEDD]"
            >
              <span className="relative inline-flex">
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ backgroundColor: m.avatarColor }}
                >
                  {initials(m.name)}
                </span>
                <span
                  className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-[#0E1118] ${
                    isOnline(m.lastSeenAt) ? "bg-[#22C55E]" : "bg-[#3A4356]"
                  }`}
                />
              </span>
              <span className="truncate">
                {m.name}
                {m.id === me.id && <span className="text-[#5B6476]"> (you)</span>}
              </span>
              {m.role === "OWNER" && (
                <span className="ml-auto text-[9px] text-[#5B6476]">owner</span>
              )}
            </button>
          ))}
        </div>

        {activeWs && (
          <div className="border-t border-[#1E2432] p-3">
            <p className="text-[10px] tracking-wider text-[#5B6476] uppercase">
              Invite code
            </p>
            <button
              onClick={copyInvite}
              title="Copy invite code"
              className="mt-1 flex w-full items-center justify-between rounded-md bg-[#1A202E] px-2.5 py-1.5 font-mono text-xs text-[#A5B4FC] transition hover:bg-[#232B3D]"
            >
              {activeWs.inviteCode}
              <span className="text-[10px] text-[#5B6476]">
                {copied ? "copied!" : "copy"}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ---- Chat ---- */}
      {activeScope ? (
         <ChatPane
          key={`${activeScope.kind}-${activeScope.id}-${jumpTo ?? ""}`}
          me={me}
          scope={activeScope}
          jumpToMessageId={jumpTo}
          onRead={() => clearUnread(activeScope)}
          members={members}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-[#5B6476]">
          {channels.length === 0 ? "Loading channels…" : "Select a channel"}
        </div>
      )}

      {/* ---- Modals ---- */}
      {modal === "createChannel" && activeWsId && (
        <ChannelModal
          workspaceId={activeWsId}
          onClose={() => setModal(null)}
          onDone={(ch) => {
            setModal(null);
            loadSidebar(activeWsId).then(() => openChannel(ch));
          }}
        />
      )}
      {(modal === "createWs" || modal === "joinWs") && (
        <WorkspaceModal
          kind={modal === "joinWs" ? "join" : "create"}
          onClose={() => setModal(null)}
          onDone={(id) => {
            setModal(null);
            loadWorkspaces().then(() => id && setActiveWsId(id));
          }}
        />
      )}
      {modal === "search" && activeWsId && (
        <SearchModal
          workspaceId={activeWsId}
          onClose={() => setModal(null)}
          onPick={openSearchResult}
        />
      )}
      {modal === "groupDm" && activeWsId && (
        <GroupDmModal
          workspaceId={activeWsId}
          members={members.filter((m) => m.id !== me.id)}
          onClose={() => setModal(null)}
          onDone={(conv) => {
            setModal(null);
            setConversations((prev) =>
              prev.some((c) => c.id === conv.id) ? prev : [...prev, conv]
            );
            openConversation(conv);
          }}
        />
      )}
      {modal === "settings" && (
        <SettingsModal me={me} theme={theme} setTheme={setTheme} onClose={() => setModal(null)} />
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? "max-w-lg" : "max-w-sm"} rounded-2xl border border-[#1E2432] bg-[#141821] p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-[#5B6476] hover:text-[#F5F7FA]">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const modalInput =
  "w-full rounded-lg border border-[#2A3040] bg-[#0B0D12] px-3 py-2 text-sm outline-none focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/30";

function WorkspaceModal({
  kind,
  onClose,
  onDone,
}: {
  kind: "create" | "join";
  onClose: () => void;
  onDone: (workspaceId?: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(
      kind === "create" ? "/api/workspaces" : "/api/workspaces/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "create" ? { name: value } : { inviteCode: value }
        ),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.message ?? "Something went wrong");
      setBusy(false);
      return;
    }
    onDone(data.id);
  }

  return (
    <ModalShell
      title={kind === "create" ? "Create a workspace" : "Join a workspace"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <input
          autoFocus
          className={modalInput}
          placeholder={
            kind === "create" ? "Workspace name" : "Invite code (e.g. LOOPDEMO)"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        {error && <p className="text-xs text-[#EF4444]">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-[#6366F1] py-2 text-sm font-semibold transition hover:bg-[#5558E6] disabled:opacity-50"
        >
          {busy ? "Working…" : kind === "create" ? "Create workspace" : "Join workspace"}
        </button>
      </form>
    </ModalShell>
  );
}

function ChannelModal({
  workspaceId,
  onClose,
  onDone,
}: {
  workspaceId: string;
  onClose: () => void;
  onDone: (channel: Channel) => void;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, topic, isPrivate }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message ?? "Something went wrong");
      setBusy(false);
      return;
    }
    onDone(data);
  }

  return (
    <ModalShell title="Create a channel" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          autoFocus
          className={modalInput}
          placeholder="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className={modalInput}
          placeholder="Topic (optional)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <label className="flex items-center gap-2 text-xs text-[#8A93A6]">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="accent-[#6366F1]"
          />
          Private channel (invite-only)
        </label>
        {error && <p className="text-xs text-[#EF4444]">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-[#6366F1] py-2 text-sm font-semibold transition hover:bg-[#5558E6] disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create channel"}
        </button>
      </form>
    </ModalShell>
  );
}

function GroupDmModal({
  workspaceId,
  members,
  onClose,
  onDone,
}: {
  workspaceId: string;
  members: Member[];
  onClose: () => void;
  onDone: (conv: Conversation) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/workspaces/${workspaceId}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: Array.from(selected) }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message ?? "Something went wrong");
      setBusy(false);
      return;
    }
    onDone(data);
  }

  return (
    <ModalShell title="New direct message" onClose={onClose}>
      <p className="mb-3 text-xs text-[#8A93A6]">
        Pick one person for a DM, or several for a group DM (up to 9 people).
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {members.length === 0 && (
          <p className="text-xs text-[#5B6476]">
            No other members yet — share the invite code.
          </p>
        )}
        {members.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-[#C7CEDD] transition hover:bg-[#1A202E]"
          >
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggle(m.id)}
              className="accent-[#6366F1]"
            />
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: m.avatarColor }}
            >
              {initials(m.name)}
            </span>
            <span className="truncate">{m.name}</span>
            <span
              className={`ml-auto h-2 w-2 rounded-full ${
                isOnline(m.lastSeenAt) ? "bg-[#22C55E]" : "bg-[#3A4356]"
              }`}
            />
          </label>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-[#EF4444]">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || selected.size === 0}
        className="mt-4 w-full rounded-lg bg-[#6366F1] py-2 text-sm font-semibold transition hover:bg-[#5558E6] disabled:opacity-50"
      >
        {busy
          ? "Creating…"
          : selected.size > 1
            ? `Start group DM (${selected.size + 1} people)`
            : "Start conversation"}
      </button>
    </ModalShell>
  );
}

function SearchModal({
  workspaceId,
  onClose,
  onPick,
}: {
  workspaceId: string;
  onClose: () => void;
  onPick: (r: SearchResult) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(
        `/api/workspaces/${workspaceId}/search?q=${encodeURIComponent(value.trim())}`
      );
      if (res.ok) {
        const data = await res.json();
        setResults(data.items);
      }
      setSearching(false);
    }, 300);
  }

  return (
    <ModalShell title="Search messages" onClose={onClose} wide>
      <input
        autoFocus
        className={modalInput}
        placeholder="Type at least 2 characters…"
        value={q}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-3 max-h-80 overflow-y-auto">
        {searching && <p className="px-1 py-2 text-xs text-[#5B6476]">Searching…</p>}
        {!searching && q.trim().length >= 2 && results.length === 0 && (
          <p className="px-1 py-2 text-xs text-[#5B6476]">No messages found.</p>
        )}
        {results.map((r) => (
          <button
            key={r.id}
            onClick={() => onPick(r)}
            className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-[#1A202E]"
          >
            <span className="flex items-center gap-2 text-[11px] text-[#5B6476]">
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
                style={{ backgroundColor: r.authorColor }}
              >
                {initials(r.authorName)}
              </span>
              <span className="font-semibold text-[#8A93A6]">{r.authorName}</span>
              <span>
                in {r.channelName ? `#${r.channelName}` : "a direct message"}
              </span>
              <span className="ml-auto">
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </span>
            <span className="line-clamp-2 text-sm text-[#DFE4EF]">{r.body}</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Theme helper
// ---------------------------------------------------------------------------

function applyTheme(theme: "system" | "dark" | "light") {
  const root = document.documentElement;
  root.classList.remove("light-theme", "dark-theme");
  if (theme === "system") {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      root.classList.add("dark-theme");
    } else {
      root.classList.add("light-theme");
    }
  } else {
    root.classList.add(`${theme}-theme`);
  }
}

function SettingsModal({
  me,
  theme,
  setTheme,
  onClose,
}: {
  me: Me;
  theme: "system" | "dark" | "light";
  setTheme: (t: "system" | "dark" | "light") => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"general" | "notifications" | "profile">("general");
  const [statusText, setStatusText] = useState(me.statusText ?? "");
  const [saved, setSaved] = useState(false);

  async function saveProfile() {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusText }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <ModalShell title="Settings" onClose={onClose} wide>
      <div className="flex gap-4">
        <div className="flex flex-col gap-1 pr-3">
          <button
            onClick={() => setTab("general")}
            className={`text-left text-sm ${tab === "general" ? "text-[#6366F1]" : "text-[#8A93A6]"}`}
          >
            General
          </button>
          <button
            onClick={() => setTab("notifications")}
            className={`text-left text-sm ${tab === "notifications" ? "text-[#6366F1]" : "text-[#8A93A6]"}`}
          >
            Notifications
          </button>
          <button
            onClick={() => setTab("profile")}
            className={`text-left text-sm ${tab === "profile" ? "text-[#6366F1]" : "text-[#8A93A6]"}`}
          >
            Profile
          </button>
        </div>
        <div className="flex-1">
          {tab === "general" && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-[#5B6476]">
                Appearance
              </h4>
              <div className="flex gap-2">
                {(["system", "dark", "light"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={async () => {
                      setTheme(t);
                      applyTheme(t);
                      await fetch("/api/settings", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ theme: t }),
                      });
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                      theme === t
                        ? "border-[#6366F1] bg-[#6366F1]/10 text-[#C7CEDD]"
                        : "border-[#2A3040] bg-[#141821] text-[#8A93A6] hover:border-[#6366F1]"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tab === "notifications" && <NotificationPrefs />}
          {tab === "profile" && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-[#5B6476]">
                Status
              </h4>
              <input
                value={statusText}
                onChange={(e) => setStatusText(e.target.value)}
                placeholder="e.g. In a meeting — back at 3pm"
                className={modalInput}
              />
              {saved && <p className="text-xs text-[#22C55E]">Saved</p>}
              <button
                onClick={saveProfile}
                className="rounded-lg bg-[#6366F1] px-3 py-1.5 text-sm font-semibold hover:bg-[#5558E6]"
              >
                Save profile
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function NotificationPrefs() {
  const [prefs, setPrefs] = useState({
    notifyDm: true,
    notifyMention: true,
    notifyAllThreads: false,
    pushAllThreads: false,
  });
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setPrefs({
          notifyDm: s.notifyDm ?? true,
          notifyMention: s.notifyMention ?? true,
          notifyAllThreads: s.notifyAllThreads ?? false,
          pushAllThreads: s.pushAllThreads ?? false,
        });
        setLoading(false);
      });
  }, []);

  async function save() {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (loading) return <p className="text-xs text-[#5B6476]">Loading…</p>;

  return (
    <div className="space-y-3">
      <ToggleRow
        label="Direct messages"
        checked={prefs.notifyDm}
        onChange={(v) => setPrefs((p) => ({ ...p, notifyDm: v }))}
      />
      <ToggleRow
        label="Mentions"
        checked={prefs.notifyMention}
        onChange={(v) => setPrefs((p) => ({ ...p, notifyMention: v }))}
      />
      <ToggleRow
        label="All new threads (not just @mentions)"
        checked={prefs.notifyAllThreads}
        onChange={(v) => setPrefs((p) => ({ ...p, notifyAllThreads: v }))}
      />
      <ToggleRow
        label="Push to mobile for all threads"
        checked={prefs.pushAllThreads}
        onChange={(v) => setPrefs((p) => ({ ...p, pushAllThreads: v }))}
      />
      <button
        onClick={save}
        className="rounded-lg bg-[#6366F1] px-3 py-1.5 text-sm font-semibold hover:bg-[#5558E6]"
      >
        Save notification settings
      </button>
      {saved && <p className="text-xs text-[#22C55E]">Saved</p>}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-[#C7CEDD]">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${
          checked ? "bg-[#6366F1]" : "bg-[#3A4356]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
            checked ? "left-5" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}
