import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { zoomAgent } from "./agents/zoom-agent.js";
import { initDbSchema } from "../lib/db.js";
import { TelegramBotService } from "../lib/telegram-bot.js";

/**
 * Mastra instance — the central hub that registers all agents and storage.
 *
 * Storage: Turso (LibSQL) for conversation memory persistence.
 * The same Turso database is used for both Mastra memory and
 * our custom zoom_tokens table (via direct @libsql/client queries).
 */
export const mastra = new Mastra({
  agents: { zoomAgent },
  storage: new LibSQLStore({
    id: "mastra-memory",
    url: process.env.TURSO_DATABASE_URL || "file:./mastra.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  }),
});

/**
 * Bootstrap side-effects when this module loads (i.e., when `mastra dev` starts).
 * - Initialize the zoom_tokens DB table
 * - Start the Telegram bot (polling)
 */
(async () => {
  try {
    await initDbSchema();
    console.log("[mastra] Database schema initialized");
  } catch (error) {
    console.error("[mastra] Failed to initialize database:", error);
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN);
      console.log("[mastra] Telegram bot started");
    } catch (error) {
      console.error("[mastra] Failed to start Telegram bot:", error);
    }
  } else {
    console.warn("[mastra] TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
  }
})();
