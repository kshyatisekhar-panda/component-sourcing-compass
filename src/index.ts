import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListComponents } from "./tools/list-components.js";
import { registerCostRankedList } from "./tools/cost-ranked-list.js";
import { registerGetPriceHistory } from "./tools/get-price-history.js";
import { registerCompareWithMouser } from "./tools/compare-with-mouser.js";
import { registerCrossProductSuggestions } from "./tools/cross-product-suggestions.js";
import { registerComplianceCheck } from "./tools/compliance-check.js";
import { registerGenerateReport } from "./tools/generate-report.js";

const server = new McpServer({
  name: "component-sourcing-compass",
  version: "0.3.0",
});

registerListComponents(server);
registerCostRankedList(server);
registerGetPriceHistory(server);
registerCompareWithMouser(server);
registerCrossProductSuggestions(server);
registerComplianceCheck(server);
registerGenerateReport(server);

await server.connect(new StdioServerTransport());
