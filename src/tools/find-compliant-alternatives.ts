import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBom } from "../bom.js";
import { searchComponent } from "../tavily.js";
import { text } from "../tool-response.js";

export function registerFindCompliantAlternatives(server: McpServer): void {
  server.tool(
    "find_compliant_alternatives",
    "Searches for regulatory-compliant alternative components when a component has a compliance flag or the user wants to de-risk a supplier. Uses a live web search to find drop-in replacements that meet RoHS, REACH, or other specified regulations. Call this after check_compliance returns a flag or unverified status.",
    {
      component_id: z.string().describe("Component ID to find alternatives for (e.g. COMP-VALVE-CHECK-12)"),
      regulation: z
        .enum(["rohs", "reach", "all"])
        .default("all")
        .describe("Which regulation to optimise for: 'rohs', 'reach', or 'all' (default)"),
    },
    async ({ component_id, regulation }) => {
      const bom = await loadBom();

      const component = bom.components.find((c) => c.id === component_id);
      if (!component) {
        const known = bom.components.map((c) => c.id).join(", ");
        return text(`Unknown component "${component_id}". Known: ${known}.`, { error: true });
      }

      const regulationLabel =
        regulation === "rohs"
          ? "RoHS compliant"
          : regulation === "reach"
            ? "REACH SVHC-free"
            : "RoHS and REACH compliant";

      const query = `${regulationLabel} alternative to ${component.manufacturer_part_number} ${component.name} drop-in replacement distributor price`;

      const result = await searchComponent(
        component.name,
        component.manufacturer_part_number ?? "",
        component.manufacturer ?? "",
      );

      if (!result.found) {
        return text({
          component: { id: component.id, name: component.name },
          regulation,
          query,
          alternatives: null,
          note: "No web results found. Try searching distributor sites directly using the manufacturer part number.",
        });
      }

      return text({
        component: { id: component.id, name: component.name, current_unit_cost_eur: component.unit_cost },
        regulation,
        query,
        web_search_answer: result.answer,
        sources: result.sources,
        note: "Results from live web search. Verify technical specifications and request compliance declarations before switching supplier.",
      });
    },
  );
}
