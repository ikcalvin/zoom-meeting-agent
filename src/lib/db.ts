import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;

/**
 * Get or create the Turso (LibSQL) client singleton.
 * Used for direct queries (Zoom token storage).
 * Mastra memory uses its own @mastra/libsql store separately.
 */
export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
      throw new Error("TURSO_DATABASE_URL environment variable is required");
    }

    client = createClient({
      url,
      authToken: authToken || undefined,
    });
  }
  return client;
}

/**
 * Initialize the database schema.
 * Creates the zoom_tokens table if it doesn't exist.
 */
export async function initDbSchema(): Promise<void> {
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS zoom_tokens (
      id INTEGER PRIMARY KEY DEFAULT 1,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (id = 1)
    )
  `);

  // Seed with the initial refresh token from env if table is empty
  const result = await db.execute("SELECT COUNT(*) as count FROM zoom_tokens");
  const count = Number(result.rows[0]?.count ?? 0);

  if (count === 0 && process.env.ZOOM_REFRESH_TOKEN) {
    await db.execute({
      sql: `INSERT INTO zoom_tokens (id, access_token, refresh_token, expires_at)
            VALUES (1, '', ?, 0)`,
      args: [process.env.ZOOM_REFRESH_TOKEN],
    });
    console.log("[db] Seeded zoom_tokens with initial refresh token from env");
  }
}
