import { AssemblyAI } from "assemblyai";

type AudioInput = string | NodeJS.ReadableStream | Buffer;

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
function describeAudioInput(audio: AudioInput): string {
  if (typeof audio === "string") return audio;
  if (Buffer.isBuffer(audio)) return "[buffer]";
  return "[stream]";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown transcription error";
  }
}

export async function transcribeAudio(audio: AudioInput): Promise<string> {
  const aai = getClient();

  console.log(
    `[assemblyai] Starting transcription for: ${describeAudioInput(audio)}`
  );

  try {

    const params = {
      audio: audio,
      speech_models: ["universal-3-pro", "universal-2"],
      language_detection: true,
    };
    
    const transcript = await aai.transcripts.transcribe(params);

    console.log(`[assemblyai] Transcript status: ${transcript.status}`);

    if (transcript.status === "error") {
      console.error(`[assemblyai] Transcription error: ${transcript.error}`);
      throw new Error(`Transcription failed: ${transcript.error}`);
    }

    if (transcript.status !== "completed") {
      console.error(`[assemblyai] Unexpected status: ${transcript.status}`);
      throw new Error(`Transcription did not complete. Status: ${transcript.status}`);
    }

    const text = transcript.text ?? "";
    console.log(
      `[assemblyai] Transcription complete: "${text.substring(0, 100)}..."`
    );

    if (!text || text.trim().length === 0) {
      throw new Error("Transcription resulted in empty text");
    }

    return text;
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("[assemblyai] Transcription failed:", message, error);
    throw new Error(message);
  }
}
