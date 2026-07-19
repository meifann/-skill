import { z } from "zod";
import { getSessionSummary } from "../../db/queries.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetSummary(server: McpServer) {
  server.registerTool("get_session_summary", {
    title: "Get Session Summary",
    description:
      "Retrieve a full summary of a shopping session including all product evaluations, " +
      "comparisons, and the final outcome. Useful for reviewing what happened during a session.",
    inputSchema: {
      session_id: z.string().uuid().describe("Session ID to retrieve"),
    },
  }, async ({ session_id }) => {
    const summary = await getSessionSummary(session_id);

    if (!summary) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Session not found" }) }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  });
}
