import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { zoomFetch } from "../../lib/zoom-auth.js";
import {
  formatJamaicaTime,
  toZoomIso,
} from "../../lib/time-utils.js";

export const createMeetingTool = createTool({
  id: "create-zoom-meeting",
  description:
    "Create a new scheduled Zoom meeting. Call this ONLY after the user has confirmed the meeting details (topic, time). The start_time should be an ISO 8601 UTC string.",
  inputSchema: z.object({
    topic: z.string().describe("Meeting topic/title"),
    start_time: z
      .string()
      .describe("Meeting start time as ISO 8601 UTC string (e.g., 2025-05-01T19:00:00Z)"),
    duration: z
      .number()
      .optional()
      .default(60)
      .describe("Meeting duration in minutes (default: 60)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    meeting_id: z.number().optional(),
    topic: z.string().optional(),
    start_time_formatted: z.string().optional(),
    join_url: z.string().optional(),
    passcode: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ topic, start_time, duration }) => {
    try {
      const response = await zoomFetch("/users/me/meetings", {
        method: "POST",
        body: JSON.stringify({
          topic,
          type: 2, // Scheduled meeting
          start_time: start_time,
          duration: duration || 60,
          // Note: start_time is already in UTC ISO format (with Z suffix)
          // so timezone field is not needed and would cause double conversion
          settings: {
            join_before_host: true,
            waiting_room: false,
            mute_upon_entry: true,
          },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          `[create-meeting] Zoom API error: ${response.status} — ${errorBody}`
        );
        return {
          success: false,
          error: "Failed to create the meeting. Please try again later.",
        };
      }

      const meeting = (await response.json()) as {
        id: number;
        topic: string;
        start_time: string;
        join_url: string;
        password: string;
      };

      return {
        success: true,
        meeting_id: meeting.id,
        topic: meeting.topic,
        start_time_formatted: formatJamaicaTime(meeting.start_time),
        join_url: meeting.join_url,
        passcode: meeting.password,
      };
    } catch (error) {
      console.error("[create-meeting] Error:", error);
      return {
        success: false,
        error: "An unexpected error occurred while creating the meeting.",
      };
    }
  },
});
