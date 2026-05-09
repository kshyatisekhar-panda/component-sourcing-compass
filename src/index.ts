import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListComponents } from "./tools/list-components.js";
import { registerCostRankedList } from "./tools/cost-ranked-list.js";
import { registerGetPriceHistory } from "./tools/get-price-history.js";
import { registerCompareWithMouser } from "./tools/compare-with-mouser.js";
import { registerCrossProductSuggestions } from "./tools/cross-product-suggestions.js";
import { registerCheckCompliance } from "./tools/check-compliance.js";
import { registerFindCompliantAlternatives } from "./tools/find-compliant-alternatives.js";
import { registerTaricLookup } from "./tools/taric-lookup.js";

const server = new McpServer({
  name: "component-sourcing-compass",
  version: "0.3.0",
});

// Unit economics
registerListComponents(server);
registerCostRankedList(server);
registerGetPriceHistory(server);
registerCompareWithMouser(server);
registerCrossProductSuggestions(server);

// Compliance & TARIC
registerCheckCompliance(server);
registerFindCompliantAlternatives(server);
registerTaricLookup(server);

await server.connect(new StdioServerTransport());
