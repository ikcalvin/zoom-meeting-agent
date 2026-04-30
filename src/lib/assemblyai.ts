import { AssemblyAI } from "assemblyai";

let client: AssemblyAI | null = null;

function getClient(): AssemblyAI {
  if (!client) {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      throw new Error("ASSEMBLYAI_API_KEY environment variable is required");
    }
    client = new AssemblyAI({ apiKey });
  }
  return client;
}

/**
 * Transcribe an audio file from a URL.
 *
 * Used for Telegram voice messages:
 * 1. Get the file URL from Telegram's getFile API
 * 2. Pass it here for transcription
 * 3. Returns the transcribed text
 *
 * The AssemblyAI SDK handles polling internally via transcripts.transcribe().
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  const aai = getClient();

  console.log(`[assemblyai] Starting transcription for: ${audioUrl}`);

  try {
    const transcript = await aai.transcripts.transcribe({
      audio_url: audioUrl,
    });

    if (transcript.status === "error") {
      console.error(`[assemblyai] Transcription error: ${transcript.error}`);
      throw new Error(`Transcription failed: ${transcript.error}`);
    }

    const text = transcript.text ?? "";
    console.log(
      `[assemblyai] Transcription complete: "${text.substring(0, 100)}..."`
    );

    return text;
  } catch (error) {
    console.error("[assemblyai] Transcription failed:", error);
    throw error;
  }
}
