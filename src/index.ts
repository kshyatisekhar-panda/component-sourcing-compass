import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BOM_PATH = join(here, "..", "data", "bom.seed.json");

type Component = {
  id: string;
  name: string;
  unit_cost: number;
  currency: string;
  manufacturer?: string;
  manufacturer_part_number?: string;
  category?: string;
  description?: string;
  specifications?: Record<string, unknown>;
  lead_time_days?: number;
  preferred_supplier?: string;
};

type Product = {
  id: string;
  name: string;
  description?: string;
  components: Array<{ component_id: string; quantity: number }>;
};

type Bom = { components: Component[]; products: Product[] };

async function loadBom(): Promise<Bom> {
  const raw = await readFile(BOM_PATH, "utf8");
  return JSON.parse(raw) as Bom;
}

const server = new McpServer({
  name: "component-sourcing-compass",
  version: "0.1.0",
});

server.tool(
  "list_components",
  "List components from the BOM. With no arguments, returns the full component catalogue. With product_id, returns only the components in that product, each annotated with quantity_per_product.",
  {
    product_id: z
      .string()
      .optional()
      .describe(
        "Optional product id (e.g. PROD-AC-COMP-001). When provided, results are filtered to the components of that product."
      ),
  },
  async ({ product_id }) => {
    const bom = await loadBom();

    if (!product_id) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ components: bom.components }, null, 2) },
        ],
      };
    }

    const product = bom.products.find((p) => p.id === product_id);
    if (!product) {
      const known = bom.products.map((p) => p.id).join(", ");
      return {
        content: [
          {
            type: "text",
            text: `No product with id "${product_id}". Known product ids: ${known}.`,
          },
        ],
        isError: true,
      };
    }

    const rows = product.components.map(({ component_id, quantity }) => {
      const c = bom.components.find((x) => x.id === component_id);
      return c
        ? { ...c, quantity_per_product: quantity }
        : { component_id, quantity_per_product: quantity, missing: true as const };
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { product: { id: product.id, name: product.name }, components: rows },
            null,
            2
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
