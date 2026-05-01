import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from "@mastra/observability";
import { zoomAgent } from "./agents/zoom-agent.js";
import { initDbSchema } from "../lib/db.js";

/**
 * Configure observability with trace collection and export.
 * 
 * - DefaultExporter: Persists traces to the database for local Mastra Studio access
 * - CloudExporter: Sends traces to Mastra Cloud (requires MASTRA_CLOUD_ACCESS_TOKEN)
 * - SensitiveDataFilter: Automatically redacts sensitive data like API keys, passwords, tokens
 */
const observability = new Observability({
  configs: {
    default: {
      serviceName: "zoom-meeting-agent",
      exporters: [
        new DefaultExporter(),
        new CloudExporter(),
      ],
      spanOutputProcessors: [
        new SensitiveDataFilter(),
      ],
    },
  },
});

/**
 * Mastra instance — the central hub that registers all agents and storage.
 *
 * Storage: Turso (LibSQL) for conversation memory persistence.
 * The same Turso database is used for both Mastra memory and
 * our custom zoom_tokens table (via direct @libsql/client queries).
 * 
 * Observability: Configured to trace all agent operations and tool calls.
 * Traces can be viewed in Mastra Studio (local or cloud).
 */
export const mastra = new Mastra({
  agents: { zoomAgent },
  storage: new LibSQLStore({
    id: "mastra-memory",
    url: process.env.TURSO_DATABASE_URL || "file:./mastra.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  }),
  observability,
});

/**
 * Bootstrap side-effects when this module loads (i.e., when `mastra dev` starts).
 * - Initialize the zoom_tokens DB table
 * - Start the Telegram bot (polling)
 *
 * Uses dynamic import for TelegramBotService to avoid circular dependency
 * (telegram-bot.ts needs to import mastra, which is still initializing here).
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
      // Dynamic import to avoid circular dependency
      const { TelegramBotService } = await import("../lib/telegram-bot.js");
      new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN);
      console.log("[mastra] Telegram bot started");
    } catch (error) {
      console.error("[mastra] Failed to start Telegram bot:", error);
    }
  } else {
    console.warn("[mastra] TELEGRAM_BOT_TOKEN not set — Telegram bot disabled");
  }
})();
