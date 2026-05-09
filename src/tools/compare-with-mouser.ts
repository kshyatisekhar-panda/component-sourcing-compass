import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBom } from "../bom.js";
import { searchByMfrPartNumber } from "../mouser.js";
import { searchComponent } from "../tavily.js";
import { USD_TO_EUR } from "../config.js";
import { text } from "../tool-response.js";

export function registerCompareWithMouser(server: McpServer): void {
  server.registerTool(
    "compare_with_mouser",
    {
      title: "Compare with Mouser",
      description: "Looks up a component on Mouser Electronics and compares the market price against the current BOM price. Returns savings or premium per unit, stock availability, lead time, and a sourcing recommendation. Use this when the user asks whether they are overpaying, whether there are cheaper alternatives, or what Mouser charges for a component. If Mouser has no listing, automatically falls back to a Tavily web search for market pricing context.",
      inputSchema: { component_id: z.string().describe("Component ID to compare (e.g. COMP-MOTOR-3KW)") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ component_id }) => {
      const bom = await loadBom();
      const component = bom.components.find((c) => c.id === component_id);
      if (!component) {
        const known = bom.components.map((c) => c.id).join(", ");
        return text(`Unknown component "${component_id}". Known: ${known}.`, { error: true });
      }

      if (!component.manufacturer_part_number) {
        return text(
          `Component "${component_id}" has no manufacturer_part_number — cannot look up on Mouser.`,
          { error: true },
        );
      }

      const mouser = await searchByMfrPartNumber(component.manufacturer_part_number);

      // Mouser returned no live listing — try Tavily web search before falling back to mock
      if (!mouser.found) {
        const tavily = await searchComponent(
          component.name,
          component.manufacturer_part_number,
          component.manufacturer ?? "",
        );

        return text({
          component: { id: component.id, name: component.name },
          bom_price: {
            eur: component.unit_cost,
            currency: "EUR",
            supplier: component.preferred_supplier,
          },
          mouser: null,
          web_search: tavily.found
            ? {
                query: tavily.query,
                answer: tavily.answer,
                sources: tavily.sources,
              }
            : null,
          note: tavily.found
            ? "Component not found on Mouser directly. Web search results above may indicate alternative pricing or suppliers."
            : "Component not found on Mouser or via web search. Verify the manufacturer part number.",
        });
      }

      const mouserPriceEur = +(mouser.unitPriceUsd * USD_TO_EUR).toFixed(2);
      const savingsEur = +(component.unit_cost - mouserPriceEur).toFixed(2);
      const savingsPct = +((savingsEur / component.unit_cost) * 100).toFixed(1);

      return text({
        component: { id: component.id, name: component.name },
        data_source: mouser.source,
        bom_price: {
          eur: component.unit_cost,
          currency: "EUR",
          supplier: component.preferred_supplier,
        },
        mouser_price: {
          usd: mouser.unitPriceUsd,
          eur: mouserPriceEur,
          exchange_rate_note: "1 EUR ≈ 1.08 USD (May 2026)",
        },
        availability_in_stock: mouser.availabilityInStock,
        lead_time_days: mouser.leadTimeDays,
        rohs_status: mouser.rohsStatus,
        savings_vs_bom: {
          eur_per_unit: savingsEur,
          pct: savingsPct,
          recommendation:
            savingsEur > 0
              ? `Mouser is ${savingsPct}% cheaper (€${savingsEur}/unit). Consider switching supplier.`
              : `Current BOM supplier is ${Math.abs(savingsPct)}% cheaper. No switch needed.`,
        },
      });
    },
  );
}
