# Component Sourcing Compass

![Atlas Copco challenge brief](docs/assets/challenge-brief.png)

Built for the **Cline AI-Assisted Enterprise Coding Hackathon**, Atlas Copco challenge track: *Intelligent Component Sourcing & Compliance Verification* (challenge owner: Finn Eklöf Klemming, Product Manager).

A PoC that automatically evaluates and recommends alternative components by matching technical specifications against supplier data, while enforcing regulatory compliance and optimizing for cost, risk, and supply resilience.

## Read this first

[**Project and First Brainstorm**](docs/project-and-brainstorm.md) is the team's single source of truth. It covers:

- The challenge as given by Atlas Copco
- Problem statement and pain points
- Formal PoC charter (scope, methodology, KPIs, deliverables)
- First brainstorm output: user and goal, tech options, open questions

## Team

_Add team members here._

## Status

Phase 1 backbone scaffolded. TypeScript MCP server with one end-to-end tool (`list_components`) reading a fixture BOM. Decisions land in the "Decisions" section of [project-and-brainstorm.md](docs/project-and-brainstorm.md).

## Architecture at a glance

- **MCP server (TypeScript)** — [src/index.ts](src/index.ts). Exposes BOM-backed tools to any MCP-aware client.
- **Data layer (fixtures)** — [data/bom.seed.json](data/bom.seed.json), shape defined by [data/schemas/bom.schema.json](data/schemas/bom.schema.json). The Python data-generation track replaces the seed with a fuller fixture in Phase 2; the schema is the contract.
- **Demo client** — Cline (the hackathon's branded coding assistant) running the server over stdio.

## Running the MCP server

```sh
npm install
npm run typecheck   # optional: confirm the TS compiles cleanly
npm start           # runs the server over stdio (only useful when launched by an MCP client)
```

The server speaks MCP over stdio, so running it standalone in a terminal is not interactive — point Cline at it instead.

## Connecting Cline

1. Install the **Cline** extension in VS Code (Extensions panel → search "Cline").
2. Open Cline's MCP Servers panel and edit `cline_mcp_settings.json`.
3. Add this entry:

   ```json
   {
     "mcpServers": {
       "component-sourcing-compass": {
         "command": "npm",
         "args": ["start", "--silent"],
         "cwd": "<absolute path to this repo>"
       }
     }
   }
   ```

   The `--silent` is required — without it, npm's own preamble lines go to stdout and corrupt the MCP protocol.

4. Ask Cline *"list components in product PROD-AC-COMP-001"* — it should call `list_components` and return the BOM.
