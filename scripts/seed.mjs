// Development seed — demo accounts for trying Loop quickly.
import { randomBytes, scryptSync } from "crypto";
import pg from "pg";
import { config } from "dotenv";

config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const PASSWORD = "loopdemo123";

async function main() {
  const existing = await pool.query("select id from users where email = $1", [
    "ada@loop.app",
  ]);
  if (existing.rowCount > 0) {
    console.log("Seed already applied, skipping.");
    return;
  }

  const ada = "seed_user_ada_000000000001";
  const grace = "seed_user_grace_0000000001";
  const ws = "seed_ws_loophq_00000000001";
  const chGeneral = "seed_ch_general_0000000001";
  const chEng = "seed_ch_engineering_000001";
  const chRandom = "seed_ch_random_00000000001";

  await pool.query(
    `insert into users (id, name, email, password_hash, avatar_color) values
     ($1, 'Ada Lovelace', 'ada@loop.app', $3, '#8B5CF6'),
     ($2, 'Grace Hopper', 'grace@loop.app', $4, '#06B6D4')
     on conflict do nothing`,
    [ada, grace, hashPassword(PASSWORD), hashPassword(PASSWORD)]
  );

  await pool.query(
    `insert into workspaces (id, name, slug, invite_code, owner_id)
     values ($1, 'Loop HQ', 'loop-hq', 'LOOPDEMO', $2) on conflict do nothing`,
    [ws, ada]
  );

  await pool.query(
    `insert into memberships (user_id, workspace_id, role) values
     ($1, $3, 'OWNER'), ($2, $3, 'MEMBER') on conflict do nothing`,
    [ada, grace, ws]
  );

  await pool.query(
    `insert into channels (id, workspace_id, name, topic, created_by_id) values
     ($1, $4, 'general', 'Team-wide announcements and conversation', $5),
     ($2, $4, 'engineering', 'Build plans, PRs, and architecture talk', $5),
     ($3, $4, 'random', 'Watercooler — anything goes', $5)
     on conflict do nothing`,
    [chGeneral, chEng, chRandom, ws, ada]
  );

  await pool.query(
    `insert into channel_members (user_id, channel_id) values
     ($1, $3), ($2, $3), ($1, $4), ($2, $4), ($1, $5), ($2, $5)
     on conflict do nothing`,
    [ada, grace, chGeneral, chEng, chRandom]
  );

  const msgs = [
    ["m1", chGeneral, null, ada, "Welcome to Loop HQ! 🎉 This workspace is the vertical-slice demo: sign in on a second session and watch messages arrive live.", 40],
    ["m2", chGeneral, null, grace, "Love it. Realtime sync, threads, reactions — the whole core messaging contract is here.", 35],
    ["m3", chGeneral, "seed_msg_m1_00000000000001", grace, "Replying in a thread to prove the thread invariant works — this reply stays in #general with its parent.", 30],
    ["m4", chGeneral, "seed_msg_m1_00000000000001", ada, "And reply counts update everywhere through the change feed. 🚀", 25],
    ["m5", chEng, null, ada, "Reminder: messages are idempotent on clientMessageId — retries never duplicate.", 20],
    ["m6", chEng, null, grace, "And pagination uses opaque cursors, no offsets. Try “Load older messages” after we chat a while.", 15],
    ["m7", chRandom, null, grace, "Obligatory first post in #random ☕", 10],
  ];

  for (const [key, channelId, parentId, authorId, body, minsAgo] of msgs) {
    const id = `seed_msg_${key}_00000000000001`.slice(0, 26);
    await pool.query(
      `insert into messages (id, channel_id, parent_id, author_id, body, created_at, updated_at)
       values ($1, $2, $3, $4, $5, now() - ($6 || ' minutes')::interval, now() - ($6 || ' minutes')::interval)
       on conflict do nothing`,
      [id, channelId, parentId, authorId, body, String(minsAgo)]
    );
  }

  await pool.query(
    `update messages set reply_count = 2 where id = 'seed_msg_m1_00000000000001'`
  );

  await pool.query(
    `insert into reactions (id, message_id, user_id, emoji) values
     ('seed_rx_1_000000000000001', 'seed_msg_m1_00000000000001', $1, '🎉'),
     ('seed_rx_2_000000000000001', 'seed_msg_m1_00000000000001', $2, '🎉'),
     ('seed_rx_3_000000000000001', 'seed_msg_m2_00000000000001', $1, '👍')
     on conflict do nothing`,
    [grace, ada]
  );

  console.log("Seeded demo data: ada@loop.app / grace@loop.app (password: loopdemo123)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
