import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    avatarColor: text("avatar_color").notNull().default("#6366F1"),
    // Presence is derived from heartbeat expiry, never a permanent flag.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId, t.expiresAt),
  ]
);

// ---------------------------------------------------------------------------
// Workspaces & membership
// ---------------------------------------------------------------------------

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    inviteCode: text("invite_code").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_slug_unique").on(t.slug),
    uniqueIndex("workspaces_invite_code_unique").on(t.inviteCode),
  ]
);

export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("MEMBER"), // OWNER | ADMIN | MEMBER
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.workspaceId] }),
    index("memberships_workspace_idx").on(t.workspaceId, t.userId),
  ]
);

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    topic: text("topic"),
    isPrivate: boolean("is_private").notNull().default(false),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("channels_workspace_name_unique").on(t.workspaceId, t.name),
    index("channels_workspace_idx").on(t.workspaceId),
  ]
);

export const channelMembers = pgTable(
  "channel_members",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    muted: boolean("muted").notNull().default(false), // notification preference
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channelId] }),
    index("channel_members_channel_idx").on(t.channelId, t.userId),
  ]
);

// ---------------------------------------------------------------------------
// Conversations (DMs & group DMs)
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    isGroup: boolean("is_group").notNull().default(false),
    // DM uniqueness key: sorted participant IDs joined by ':'
    dmKey: text("dm_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_workspace_dmkey_unique").on(
      t.workspaceId,
      t.dmKey
    ),
    index("conversations_workspace_idx").on(t.workspaceId),
  ]
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    muted: boolean("muted").notNull().default(false), // notification preference
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.conversationId] }),
    index("conversation_members_conv_idx").on(t.conversationId, t.userId),
  ]
);

// ---------------------------------------------------------------------------
// Messages, threads, reactions
// ---------------------------------------------------------------------------

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    // Invariant (enforced in API): exactly one of channelId / conversationId.
    channelId: text("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    conversationId: text("conversation_id").references(
      () => conversations.id,
      { onDelete: "cascade" }
    ),
    parentId: text("parent_id"), // thread parent; same scope invariant enforced in API
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientMessageId: text("client_message_id"), // idempotency key from client
    body: text("body").notNull(),
    replyCount: integer("reply_count").notNull().default(0),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Bumped on edit / delete / reaction change — powers incremental sync.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_author_client_id_unique").on(
      t.authorId,
      t.clientMessageId
    ),
    index("messages_channel_created_idx").on(t.channelId, t.createdAt, t.id),
    index("messages_channel_updated_idx").on(t.channelId, t.updatedAt),
    index("messages_conv_created_idx").on(t.conversationId, t.createdAt, t.id),
    index("messages_conv_updated_idx").on(t.conversationId, t.updatedAt),
    index("messages_parent_idx").on(t.parentId, t.createdAt),
  ]
);

// Device registrations for push delivery — the plan's Device model,
// generalized across transports. Web uses the Push API (endpoint + keys);
// native clients register FCM/APNs tokens in the `token` column.
export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // WEB | DESKTOP | ANDROID | IOS
    pushType: text("push_type").notNull(), // webpush | fcm | apns
    endpoint: text("endpoint"), // webpush endpoint URL
    p256dh: text("p256dh"), // webpush public key
    auth: text("auth"), // webpush auth secret
    token: text("token"), // FCM/APNs token (native clients)
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("devices_endpoint_unique").on(t.endpoint),
    index("devices_user_idx").on(t.userId, t.platform),
  ]
);

// Small server-side key/value store (persists generated VAPID keys).
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Ephemeral typing signals (TTL ~5s, pruned opportunistically, never persisted
// into message history).
export const typingEvents = pgTable(
  "typing_events",
  {
    scopeType: text("scope_type").notNull(), // "channel" | "conversation"
    scopeId: text("scope_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeType, t.scopeId, t.userId] }),
    index("typing_events_scope_idx").on(t.scopeType, t.scopeId, t.updatedAt),
  ]
);

// File attachments. Bytes live in Postgres because this environment has no
// S3 credentials; the client contract (upload → attach via attachmentIds on
// message create) matches the plan's presigned-upload flow.
export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").references(() => messages.id, {
      onDelete: "cascade",
    }),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("attachments_message_idx").on(t.messageId),
    index("attachments_uploader_idx").on(t.uploaderId),
  ]
);

export const reactions = pgTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("reactions_message_user_emoji_unique").on(
      t.messageId,
      t.userId,
      t.emoji
    ),
    index("reactions_message_idx").on(t.messageId),
  ]
);
