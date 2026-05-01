import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { zoomFetch } from "../../lib/zoom-auth.js";
import { formatJamaicaTime } from "../../lib/time-utils.js";

export const updateMeetingTool = createTool({
  id: "update-zoom-meeting",
  description:
    "Update the topic and/or start time of an existing scheduled Zoom meeting. Call this ONLY after the user has confirmed the changes. The start_time must be a future ISO 8601 UTC string.",
  inputSchema: z.object({
    meeting_id: z
      .number()
      .describe("The Zoom meeting ID to update"),
    topic: z
      .string()
      .optional()
      .describe("New meeting topic/title (omit to keep unchanged)"),
    start_time: z
      .string()
      .optional()
      .describe(
        "New meeting start time as ISO 8601 UTC string (e.g., 2025-05-01T19:00:00Z). Must be in the future. Omit to keep unchanged."
      ),
    duration: z
      .number()
      .optional()
      .describe("New meeting duration in minutes (omit to keep unchanged)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    meeting_id: z.number().optional(),
    updated_fields: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ meeting_id, topic, start_time, duration }) => {
    try {
      // Ensure at least one field is being updated
      if (!topic && !start_time && duration === undefined) {
        return {
          success: false,
          error:
            "No changes provided. Please specify a new topic, start time, or duration.",
        };
      }

      // Validate that start_time is in the future
      if (start_time) {
        const newDate = new Date(start_time);
        if (isNaN(newDate.getTime())) {
          return {
            success: false,
            error: "Invalid date format. Please provide a valid ISO 8601 date string.",
          };
        }
        if (newDate <= new Date()) {
          return {
            success: false,
            error:
              "The new meeting time must be in the future. Please choose a later date/time.",
          };
        }
      }

      // Build the request body with only the provided fields
      const body: Record<string, unknown> = {};
      if (topic) body.topic = topic;
      if (start_time) {
        body.start_time = start_time;
        // Note: Don't include timezone when sending UTC ISO strings
        // The Z suffix indicates UTC, so timezone field would cause a double conversion
      }
      if (duration !== undefined) body.duration = duration;

      const response = await zoomFetch(`/meetings/${meeting_id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

      // 204 = success (no content)
      if (response.status === 204 || response.ok) {
        const updatedParts: string[] = [];
        if (topic) updatedParts.push(`Topic → "${topic}"`);
        if (start_time)
          updatedParts.push(`Time → ${formatJamaicaTime(start_time)}`);
        if (duration !== undefined)
          updatedParts.push(`Duration → ${duration} minutes`);

        return {
          success: true,
          meeting_id,
          updated_fields: updatedParts.join(", "),
        };
      }

      // 404 = meeting not found
      if (response.status === 404) {
        return {
          success: false,
          error:
            "That meeting was not found. It may have been deleted or the ID is incorrect.",
        };
      }

      const errorBody = await response.text();
      console.error(
        `[update-meeting] Zoom API error: ${response.status} — ${errorBody}`
      );
      return {
        success: false,
        error: "Failed to update the meeting. Please try again later.",
      };
    } catch (error) {
      console.error("[update-meeting] Error:", error);
      return {
        success: false,
        error: "An unexpected error occurred while updating the meeting.",
      };
    }
  },
});
