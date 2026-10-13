/// Auto-schema-migration for Vercel deploys.
/// Runs `drizzle-kit push` against DATABASE_URL so the Postgres schema is
/// always in sync with src/db/schema.ts — no manual migration needed.
/// Safe no-op locally when DATABASE_URL is unset.
import { config } from "dotenv";
config();

if (!process.env.DATABASE_URL) {
  console.log("[migrate] DATABASE_URL not set — skipping");
  process.exit(0);
}

// Use drizzle-kit's programmatic push against the live Neon DB.
import("drizzle-kit").then((dk) => {
  // `push` isn't exported as a stable API, so shell out instead.
}).catch(() => {});

import("child_process").then(({ spawnSync }) => {
  const result = spawnSync("npx", ["drizzle-kit", "push"], {
    env: { ...process.env },
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) {
    console.error("[migrate]", result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
});
