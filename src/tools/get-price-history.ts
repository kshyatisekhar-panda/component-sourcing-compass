import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBom } from "../bom.js";
import { text } from "../tool-response.js";

const HISTORY_PATH = join(process.cwd(), "data", "price-history.seed.json");

type PricePoint = { date: string; unit_cost: number; currency: string };
type PriceHistory = Record<string, PricePoint[]>;

async function loadHistory(): Promise<PriceHistory> {
  const raw = await readFile(HISTORY_PATH, "utf8");
  return JSON.parse(raw) as PriceHistory;
}

export function registerGetPriceHistory(server: McpServer): void {
  server.tool(
    "get_price_history",
    "Returns the monthly price history for a component over the last 3 months or 1 year, with trend direction and percentage change. Use this to understand whether a component's cost is rising, falling, or stable over time.",
    {
      component_id: z.string().describe("Component ID (e.g. COMP-MOTOR-3KW)"),
      period: z
        .enum(["3m", "1y"])
        .default("1y")
        .describe("Look-back window: '3m' = last 3 months, '1y' = last 12 months (default)"),
    },
    async ({ component_id, period }) => {
      const [bom, history] = await Promise.all([loadBom(), loadHistory()]);

      const component = bom.components.find((c) => c.id === component_id);
      if (!component) {
        const known = bom.components.map((c) => c.id).join(", ");
        return text(`Unknown component "${component_id}". Known: ${known}.`, { error: true });
      }

      const allPoints = history[component_id];
      if (!allPoints || allPoints.length === 0) {
        return text(`No price history available for "${component_id}".`, { error: true });
      }

      const monthsBack = period === "3m" ? 3 : 12;
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - monthsBack);

      const points = allPoints.filter((p) => new Date(p.date) >= cutoff);
      const first = points[0];
      const last = points[points.length - 1];
      const pctChange = +(((last.unit_cost - first.unit_cost) / first.unit_cost) * 100).toFixed(1);

      return text({
        component: { id: component.id, name: component.name },
        period,
        current_price: { value: last.unit_cost, currency: last.currency },
        period_start_price: { value: first.unit_cost, currency: first.currency },
        change_pct: pctChange,
        trend: pctChange > 1 ? "rising" : pctChange < -1 ? "falling" : "stable",
        data_points: points,
      });
    },
  );
}
