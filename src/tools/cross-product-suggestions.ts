import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadBom } from "../bom.js";
import { text } from "../tool-response.js";

export function registerCrossProductSuggestions(server: McpServer): void {
  server.tool(
    "cross_product_suggestions",
    "Analyses components shared across multiple products and ranks them by total portfolio cost impact. Use this when the user asks about portfolio-wide optimisation, cross-product savings, or which single sourcing decision would have the broadest impact. A saving on a shared component multiplies across every product that uses it — this tool surfaces those leverage points.",
    {},
    async () => {
      const bom = await loadBom();

      type Usage = {
        product_id: string;
        product_name: string;
        quantity: number;
        line_cost: number;
      };

      const usageMap = new Map<string, Usage[]>();

      for (const product of bom.products) {
        for (const { component_id, quantity } of product.components) {
          const c = bom.components.find((x) => x.id === component_id);
          if (!c) continue;
          const usages = usageMap.get(component_id) ?? [];
          usages.push({
            product_id: product.id,
            product_name: product.name,
            quantity,
            line_cost: +(c.unit_cost * quantity).toFixed(2),
          });
          usageMap.set(component_id, usages);
        }
      }

      const shared = [...usageMap.entries()]
        .filter(([, usages]) => usages.length > 1)
        .map(([component_id, usages]) => {
          const c = bom.components.find((x) => x.id === component_id)!;
          const totalPortfolioCost = +usages.reduce((s, u) => s + u.line_cost, 0).toFixed(2);
          const fivePctSaving = +(totalPortfolioCost * 0.05).toFixed(2);

          return {
            component_id: c.id,
            name: c.name,
            category: c.category,
            unit_cost: c.unit_cost,
            currency: c.currency,
            preferred_supplier: c.preferred_supplier,
            appears_in_products: usages.length,
            usages,
            total_portfolio_cost: totalPortfolioCost,
            optimization_note: `A 5% unit cost reduction saves €${fivePctSaving} per combined production run across all products.`,
          };
        });

      shared.sort((a, b) => b.total_portfolio_cost - a.total_portfolio_cost);

      const grandTotal = +shared.reduce((s, c) => s + c.total_portfolio_cost, 0).toFixed(2);

      return text({
        note: "Cost impact is per combined production run (one unit of each product). Components appearing in only one product are excluded.",
        shared_components_count: shared.length,
        total_shared_portfolio_cost: grandTotal,
        currency: "EUR",
        components: shared.map((c, i) => ({
          rank: i + 1,
          cost_share_pct: +((c.total_portfolio_cost / grandTotal) * 100).toFixed(1),
          ...c,
        })),
      });
    },
  );
}
