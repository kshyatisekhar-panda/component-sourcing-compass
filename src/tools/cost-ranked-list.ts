import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBom } from "../bom.js";
import { text } from "../tool-response.js";

export function registerCostRankedList(server: McpServer): void {
  server.tool(
    "cost_ranked_list",
    "Returns components for a product ranked by total cost contribution (unit_cost × quantity), with each line's share of total BOM cost. Use this when the user asks which components drive cost, what the BOM cost breakdown is, or where to focus cost-reduction efforts. Follow up with compare_with_mouser on the top-ranked components to find savings.",
    { product_id: z.string().describe("Product ID to analyse (e.g. PROD-AC-COMP-001)") },
    async ({ product_id }) => {
      const bom = await loadBom();
      const product = bom.products.find((p) => p.id === product_id);
      if (!product) {
        const known = bom.products.map((p) => p.id).join(", ");
        return text(`Unknown product "${product_id}". Known products: ${known}.`, { error: true });
      }

      const lines = product.components.flatMap(({ component_id, quantity }) => {
        const c = bom.components.find((x) => x.id === component_id);
        if (!c) return [];
        return [
          {
            component_id: c.id,
            name: c.name,
            category: c.category,
            manufacturer: c.manufacturer,
            unit_cost: c.unit_cost,
            currency: c.currency,
            quantity,
            line_cost: +(c.unit_cost * quantity).toFixed(2),
            lead_time_days: c.lead_time_days,
          },
        ];
      });

      lines.sort((a, b) => b.line_cost - a.line_cost);

      const total = +lines.reduce((s, l) => s + l.line_cost, 0).toFixed(2);

      return text({
        product: { id: product.id, name: product.name },
        total_bom_cost: total,
        currency: lines[0]?.currency ?? "EUR",
        components: lines.map((l, i) => ({
          rank: i + 1,
          ...l,
          cost_share_pct: +((l.line_cost / total) * 100).toFixed(1),
        })),
      });
    },
  );
}
