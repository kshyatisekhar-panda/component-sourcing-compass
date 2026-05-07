import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListComponents } from "./tools/list-components.js";

const server = new McpServer({
  name: "component-sourcing-compass",
  version: "0.1.0",
});

registerListComponents(server);

await server.connect(new StdioServerTransport());
