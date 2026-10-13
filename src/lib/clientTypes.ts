export type Me = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  statusText?: string | null;
  timezone: string;
};

export type UserSettings = {
  theme: "system" | "dark" | "light";
  notifyDm: boolean;
  notifyMention: boolean;
  notifyAllThreads: boolean;
  pushAllThreads: boolean;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  inviteCode: string;
  role: string;
};

export type Channel = {
  id: string;
  name: string;
  topic: string | null;
  purpose?: string | null;
  isPrivate: boolean;
  isArchived?: boolean;
  isMember: boolean;
  muted: boolean;
  starred?: boolean;
  unreadCount: number;
};

export type Member = {
  id: string;
  name: string;
  avatarColor: string;
  statusText?: string | null;
  lastSeenAt: string;
  role: string;
};

export type Conversation = {
  id: string;
  isGroup: boolean;
  name: string;
  others: { id: string; name: string; avatarColor: string; lastSeenAt: string }[];
  muted: boolean;
  unreadCount: number;
};

export type Scope = {
  kind: "channel" | "conversation";
  id: string;
  name: string;
  topic: string | null;
  isPrivate: boolean;
  muted: boolean;
};

export type SearchResult = {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  parentId: string | null;
  body: string;
  createdAt: string;
  authorName: string;
  authorColor: string;
  channelName: string | null;
};

export type AttachmentDto = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
};

export type ReactionAgg = {
  emoji: string;
  count: number;
  userIds: string[];
  userNames: string[];
};

export type Msg = {
  id: string;
  channelId: string | null;
  conversationId: string | null;
  parentId: string | null;
  authorId: string;
  clientMessageId: string | null;
  body: string;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: {
    id: string;
    name: string;
    avatarColor: string;
    lastSeenAt: string;
  };
  reactions: ReactionAgg[];
  attachments: AttachmentDto[];
  // Client-only flags (optimistic outbox state)
  pending?: boolean;
  failed?: boolean;
};

export function fmtBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isOnline(lastSeenAt: string): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < 70_000;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
