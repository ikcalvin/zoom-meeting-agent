import TelegramBot from "node-telegram-bot-api";
import { mastra } from "../mastra/index.js";
import { transcribeAudio } from "./assemblyai.js";

/**
 * Telegram Bot integration for the Zoom Meeting Agent.
 *
 * Handles:
 * - /start command (onboarding)
 * - Text messages -> agent.generate()
 * - Voice messages -> AssemblyAI transcription -> agent.generate()
 * - Typing indicators while processing
 */
export class TelegramBotService {
  private bot: TelegramBot;

  constructor(token: string) {
    this.bot = new TelegramBot(token, { polling: true });
    this.registerHandlers();
    console.log("[telegram] Bot started with polling");
  }

  private registerHandlers(): void {
    // Handle /start command
    this.bot.onText(/\/start/, async (msg) => {
      await this.handleStart(msg);
    });

    // Handle voice messages
    this.bot.on("voice", async (msg) => {
      await this.handleVoice(msg);
    });

    // Handle text messages (excluding /start which is handled above)
    this.bot.on("message", async (msg) => {
      // Skip if it's a command we already handle, or not text
      if (!msg.text || msg.text.startsWith("/start")) return;
      // Skip voice messages (handled by the "voice" event)
      if (msg.voice) return;

      await this.handleText(msg);
    });

    // Handle errors gracefully
    this.bot.on("polling_error", (error) => {
      console.error("[telegram] Polling error:", error.message);
    });
  }

  /**
   * Handle /start command and send onboarding message.
   */
  private async handleStart(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = this.getUserId(msg);

    // Let the agent generate the welcome message (it has onboarding instructions)
    await this.sendTyping(chatId);
    const typingInterval = this.startTypingLoop(chatId);

    try {
      const agent = mastra.getAgentById("zoom-meeting-agent");
      const result = await agent.generate("/start", {
        memory: {
          resource: userId,
          thread: `tg-${chatId}`,
        },
      });

      clearInterval(typingInterval);
      await this.sendMessage(chatId, result.text);
    } catch (error) {
      clearInterval(typingInterval);
      console.error("[telegram] Error processing /start:", error);
      await this.sendMessage(chatId, "Sorry, something went wrong. Please try again.");
    }
  }

  /**
   * Handle incoming text messages.
   */
  private async handleText(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = this.getUserId(msg);
    const text = msg.text!;

    // Send typing indicator immediately
    await this.sendTyping(chatId);

    // Keep typing indicator alive with periodic pings
    const typingInterval = this.startTypingLoop(chatId);

    try {
      const agent = mastra.getAgentById("zoom-meeting-agent");
      const result = await agent.generate(text, {
        memory: {
          resource: userId,
          thread: `tg-${chatId}`,
        },
      });

      clearInterval(typingInterval);
      await this.sendMessage(chatId, result.text);
    } catch (error) {
      clearInterval(typingInterval);
      console.error("[telegram] Error processing text message:", error);
      await this.sendMessage(
        chatId,
        "Sorry, something went wrong while processing your message. Please try again."
      );
    }
  }

  /**
   * Handle incoming voice messages.
   *
   * Flow:
   * 1. Send typing indicator
   * 2. Download voice file from Telegram
   * 3. Transcribe via AssemblyAI
   * 4. Pass transcribed text to agent
   */
  private async handleVoice(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = this.getUserId(msg);

    if (!msg.voice) return;

    // Send typing indicator immediately
    await this.sendTyping(chatId);
    const typingInterval = this.startTypingLoop(chatId);

    try {
      // Step 1: Read the voice file directly from Telegram as a stream.
      // This avoids handing AssemblyAI a Telegram-scoped URL that it may not
      // be able to fetch reliably from outside our bot process.
      const fileId = msg.voice.file_id;
      const file = await this.bot.getFile(fileId);
      const filePath = file.file_path ?? "unknown-path";
      const fileStream = this.bot.getFileStream(fileId);

      console.log(`[telegram] Processing voice file: ${filePath}`);

      // Step 2: Transcribe with AssemblyAI
      let transcribedText: string;
      try {
        transcribedText = await transcribeAudio(fileStream);
      } catch (transcriptionError) {
        clearInterval(typingInterval);
        const message = this.getErrorMessage(transcriptionError);
        console.error("[telegram] Transcription failed:", message, transcriptionError);
        await this.sendMessage(
          chatId,
          "Sorry, I couldn't process your voice message. Please try again or send a text message instead."
        );
        return;
      }

      if (!transcribedText || transcribedText.trim().length === 0) {
        clearInterval(typingInterval);
        await this.sendMessage(
          chatId,
          "Sorry, I couldn't make out what you said. Could you try again or send a text message instead?"
        );
        return;
      }

      // Step 3: Send transcribed text to agent (same as text handling)
      const agent = mastra.getAgentById("zoom-meeting-agent");
      const result = await agent.generate(transcribedText, {
        memory: {
          resource: userId,
          thread: `tg-${chatId}`,
        },
      });

      clearInterval(typingInterval);

      // Send a note about what was transcribed, then the response
      await this.sendMessage(
        chatId,
        `I heard: "${transcribedText}"\n\n${result.text}`
      );
    } catch (error) {
      clearInterval(typingInterval);
      console.error("[telegram] Error processing voice message:", error);
      await this.sendMessage(
        chatId,
        "Sorry, something went wrong while processing your voice message. Please try again."
      );
    }
  }

  /**
   * Send a "typing..." chat action to Telegram.
   */
  private async sendTyping(chatId: number): Promise<void> {
    try {
      await this.bot.sendChatAction(chatId, "typing");
    } catch {
      // Non-critical; do not let typing indicator failures break the flow
    }
  }

  /**
   * Start a loop that sends typing indicators every 4 seconds.
   * Telegram typing indicators auto-expire after about 5 seconds,
   * so we need to refresh them during long operations.
   *
   * Returns the interval ID for cleanup.
   */
  private startTypingLoop(chatId: number): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.sendTyping(chatId);
    }, 4000);
  }

  /**
   * Get a stable user ID string from a Telegram message.
   */
  private getUserId(msg: TelegramBot.Message): string {
    return msg.from?.id.toString() ?? `anon-${msg.chat.id}`;
  }

  /**
   * Send a Telegram message after removing bold markdown markers that may
   * appear in model output.
   */
  private async sendMessage(chatId: number, text: string): Promise<void> {
    await this.bot.sendMessage(chatId, this.stripDoubleAsterisks(text));
  }

  private stripDoubleAsterisks(text: string): string {
    return text.replace(/\*\*/g, "");
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
}
