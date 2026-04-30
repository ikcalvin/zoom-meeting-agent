import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { zoomFetch } from "../../lib/zoom-auth.js";

export const deleteMeetingTool = createTool({
  id: "delete-zoom-meeting",
  description:
    "Delete a scheduled Zoom meeting by its meeting ID. Call this ONLY after the user has confirmed they want to delete the specific meeting.",
  inputSchema: z.object({
    meeting_id: z
      .number()
      .describe("The Zoom meeting ID to delete"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ meeting_id }) => {
    try {
      const response = await zoomFetch(`/meetings/${meeting_id}`, {
        method: "DELETE",
      });

      // 204 = success (no content)
      if (response.status === 204 || response.ok) {
        return {
          success: true,
          message: `Meeting ${meeting_id} has been successfully deleted.`,
        };
      }

      // 404 = meeting not found
      if (response.status === 404) {
        return {
          success: false,
          error:
            "That meeting was not found. It may have already been deleted or the ID is incorrect.",
        };
      }

      const errorBody = await response.text();
      console.error(
        `[delete-meeting] Zoom API error: ${response.status} — ${errorBody}`
      );
      return {
        success: false,
        error: "Failed to delete the meeting. Please try again later.",
      };
    } catch (error) {
      console.error("[delete-meeting] Error:", error);
      return {
        success: false,
        error: "An unexpected error occurred while deleting the meeting.",
      };
    }
  },
});
