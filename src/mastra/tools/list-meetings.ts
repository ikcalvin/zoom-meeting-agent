import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { zoomFetch } from "../../lib/zoom-auth.js";
import { formatJamaicaTime } from "../../lib/time-utils.js";

export const listMeetingsTool = createTool({
  id: "list-zoom-meetings",
  description:
    "List all upcoming scheduled Zoom meetings. Returns a formatted list with topic, time, and meeting ID.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    meetings: z
      .array(
        z.object({
          meeting_id: z.number(),
          topic: z.string(),
          start_time: z.string(),
          start_time_formatted: z.string(),
          join_url: z.string(),
          duration: z.number(),
        })
      )
      .optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const response = await zoomFetch("/users/me/meetings?type=upcoming&page_size=50");

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          `[list-meetings] Zoom API error: ${response.status} — ${errorBody}`
        );
        return {
          success: false,
          error: "Failed to fetch meetings. Please try again later.",
        };
      }

      const data = (await response.json()) as {
        meetings: Array<{
          id: number;
          topic: string;
          start_time: string;
          join_url: string;
          duration: number;
          type: number;
        }>;
        total_records: number;
      };

      // Filter to only scheduled meetings (type 2) and sort by start time
      const upcoming = data.meetings
        .filter((m) => m.type === 2)
        .sort(
          (a, b) =>
            new Date(a.start_time).getTime() -
            new Date(b.start_time).getTime()
        )
        .map((m) => ({
          meeting_id: m.id,
          topic: m.topic,
          start_time: m.start_time,
          start_time_formatted: formatJamaicaTime(m.start_time),
          join_url: m.join_url,
          duration: m.duration,
        }));

      return {
        success: true,
        meetings: upcoming,
        count: upcoming.length,
      };
    } catch (error) {
      console.error("[list-meetings] Error:", error);
      return {
        success: false,
        error: "An unexpected error occurred while fetching meetings.",
      };
    }
  },
});
