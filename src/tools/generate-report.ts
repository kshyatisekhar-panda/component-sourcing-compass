import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildReportData, toMarkdown, toHtml, reportFilePath } from "../report.js";
import { text } from "../tool-response.js";

export function registerGenerateReport(server: McpServer): void {
  server.tool(
    "generate_sourcing_report",
    "Generates a full sourcing intelligence report for a product — cost breakdown, compliance verdicts, Mouser price comparisons, and 3-month price trends — all in one call. Returns the report as formatted markdown in the chat and saves a styled HTML file to the Desktop for sharing or printing as PDF. Use this when the user asks for a full analysis, a sourcing report, or a summary they can take into a meeting.",
    {
      product_id: z.string().describe("Product ID to report on (e.g. PROD-AC-COMP-001)"),
      market: z
        .enum(["EU", "US"])
        .default("EU")
        .describe("Target market for compliance evaluation: 'EU' (default) or 'US'"),
    },
    async ({ product_id, market }) => {
      const data = await buildReportData(product_id, market);

      if ("error" in data) {
        return text(data.error, { error: true });
      }

      const markdown = toMarkdown(data);
      const html = toHtml(data);
      const filePath = reportFilePath(product_id);

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, html, "utf8");

      const footer = [
        "",
        "---",
        "",
        `📄 Full report saved to: \`${filePath}\``,
        "_Open in your browser and use File → Print → Save as PDF to export._",
      ].join("\n");

      return text(markdown + footer);
    },
  );
}
