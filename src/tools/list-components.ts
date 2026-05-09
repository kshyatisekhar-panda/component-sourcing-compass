import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBom } from "../bom.js";
import { text } from "../tool-response.js";

export function registerListComponents(server: McpServer): void {
  server.registerTool(
    "list_components",
    {
      title: "List Components",
      description: "Entry point for all sourcing queries. Call this first to discover valid product IDs and component IDs before calling any other tool. With no arguments, returns the full component catalogue. With product_id, returns only the components in that product with quantities. Always call this when you do not already have a component_id or product_id.",
      inputSchema: {
        product_id: z
          .string()
          .optional()
          .describe(
            "Optional product id (e.g. PROD-AC-COMP-001). Filters results to a single product.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ product_id }) => {
      const bom = await loadBom();

      if (!product_id) {
        return text({ components: bom.components });
      }

      const product = bom.products.find((p) => p.id === product_id);
      if (!product) {
        const known = bom.products.map((p) => p.id).join(", ");
        return text(`Unknown product "${product_id}". Available: ${known}.`, { error: true });
      }

      const components = product.components.map(({ component_id, quantity }) => {
        const c = bom.components.find((x) => x.id === component_id);
        return c
          ? { ...c, quantity_per_product: quantity }
          : { component_id, quantity_per_product: quantity, missing: true as const };
      });

      return text({
        product: { id: product.id, name: product.name },
        components,
      });
    },
  );
}
