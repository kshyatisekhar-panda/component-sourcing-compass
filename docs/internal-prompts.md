# Internal Prompts Reference

Every string in this project that an LLM reads is collected here so you can review or tune prompts in one place. There are three layers, in order of how the request flows.

```
User question
    │
    ▼
[1] Cline agent rules    .clinerules            Tells Cline how to behave at the conversation level
    │
    ▼
[2] Tool descriptions    src/tools/*.ts         Help Cline pick the right tool to call
    │
    ▼ (when a tool is called)
[3] Sub agent prompts    src/tools/*.ts         Used inside tools that themselves call an LLM
```

If you change a prompt here, also update the source file linked in each section. This document is documentation, the source of truth for runtime is the code.

For demo prompts to type into Cline during the live demo, see [docs/prompts.md](prompts.md).

---

## 1. Cline Agent Rules

Lives in [.clinerules](../.clinerules) at the project root. Cline reads this on every chat. It defines the agent persona, sets workflow rules for common question types, and lists the available tools with usage notes.

Sections in the rules file:

- **Your Role.** Manufacturing sourcing analyst at Atlas Copco. Always back answers with tool data, never guess.
- **Available Products and Components.** Always call `list_components` first to discover IDs.
- **Tool Reference.** One line per tool describing when to use it.
- **Workflows.** Step by step recipes for common question patterns ("What does it cost?", "Are we overpaying?", "Is this compliant?", "Generate a compliance certificate", etc.).
- **Output Rules.** Lead with the answer, plain numbers, flag risks, no raw JSON, one recommendation per finding.
- **Important Caveats.** USD to EUR conversion note, country of origin reminder, ECHA snapshot freshness, internal price history scope.

Read the file directly for the full content; it is structured for a human as well as the agent.

---

## 2. Tool Descriptions

Each tool registers a description string with `server.tool(name, description, schema, handler)`. The LLM uses these descriptions to decide which tool to call. Tight, action oriented descriptions are critical for reliable chaining.

### list_components

Source: [src/tools/list-components.ts](../src/tools/list-components.ts)

> Entry point for all sourcing queries. Call this first to discover valid product IDs and component IDs before calling any other tool. With no arguments, returns the full component catalogue. With product_id, returns only the components in that product with quantities. Always call this when you do not already have a component_id or product_id.

### cost_ranked_list

Source: [src/tools/cost-ranked-list.ts](../src/tools/cost-ranked-list.ts)

> Returns components for a product ranked by total cost contribution (unit_cost × quantity), with each line's share of total BOM cost. Use this when the user asks which components drive cost, what the BOM cost breakdown is, or where to focus cost-reduction efforts. Follow up with compare_with_mouser on the top-ranked components to find savings.

### get_price_history

Source: [src/tools/get-price-history.ts](../src/tools/get-price-history.ts)

> Returns monthly price history for a component over the last 3 months or 1 year, with trend direction and percentage change. Use this when the user asks about price trends, cost evolution, or whether a component is getting more expensive. A good follow-up after cost_ranked_list — check whether the highest-cost components are trending up (rising risk) or down (opportunity to renegotiate).

### compare_with_mouser

Source: [src/tools/compare-with-mouser.ts](../src/tools/compare-with-mouser.ts)

> Looks up a component on Mouser Electronics and compares the market price against the current BOM price. Returns savings or premium per unit, stock availability, lead time, and a sourcing recommendation. Use this when the user asks whether they are overpaying, whether there are cheaper alternatives, or what Mouser charges for a component. If Mouser has no listing, automatically falls back to a Tavily web search for market pricing context.

### cross_product_suggestions

Source: [src/tools/cross-product-suggestions.ts](../src/tools/cross-product-suggestions.ts)

> Analyses components shared across multiple products and ranks them by total portfolio cost impact. Use this when the user asks about portfolio-wide optimisation, cross-product savings, or which single sourcing decision would have the broadest impact. A saving on a shared component multiplies across every product that uses it — this tool surfaces those leverage points.

### compliance_check

Source: [src/tools/compliance-check.ts](../src/tools/compliance-check.ts)

> Verifies compliance of a single component or every component in a product against a target market's regulations. EU rules: RoHS lead and mercury content thresholds, plus REACH SVHC substance presence cross referenced against a snapshot of the ECHA Candidate List (data/svhc-cache.json). US rules: Dodd Frank Section 1502 conflict minerals declaration. Returns per component verdicts with violations cited to the specific regulation, severity (blocking or warning), matched SVHC substances when applicable, and actionable recommendations. Use this when the user asks whether a product can be sold in a market, whether components contain SVHC substances, or wants to identify regulatory blockers before launch. Provide either component_id or product_id (not both), plus the target market.

### generate_sourcing_report

Source: [src/tools/generate-report.ts](../src/tools/generate-report.ts)

> Generates a full sourcing intelligence report for a product — cost breakdown, compliance verdicts, Mouser price comparisons, and 3-month price trends — all in one call. Returns the report as formatted markdown in the chat and saves a styled HTML file to the Desktop for sharing or printing as PDF. Use this when the user asks for a full analysis, a sourcing report, or a summary they can take into a meeting.

### generate_compliance_report

Source: [src/tools/generate-compliance-report.ts](../src/tools/generate-compliance-report.ts)

> Generates a formal Atlas Copco branded compliance certificate for a product against a target market. Internally runs a complete compliance check, then asks Claude to compose a 300 to 450 word certificate citing the specific regulations, components evaluated, findings, and any violations. Returns both the prose for in chat display and a saved HTML file with full Atlas Copco branding (gradient header, findings table, sources, AI generation disclosure) suitable for opening in a browser or printing to PDF for customer disclosure. Use this when the user asks for a compliance certificate, audit document, customer disclosure, or formal compliance report. Requires OPENROUTER_API_KEY in the environment.

### lookup_external_product

Source: [src/tools/lookup-external-product.ts](../src/tools/lookup-external-product.ts)

> Looks up a product that is NOT in our internal BOM database. Searches the web (Tavily) for the product, then asks an LLM to reconstruct a plausible BOM structure from the public information available. Caches the result in memory so subsequent tool calls (cost_ranked_list, compliance_check, compare_with_mouser, get_price_history if seeded) work on the synthesised product as if it were in the database. Output is clearly tagged as illustrative and reconstructed from public sources, not authoritative manufacturer data. Use this as a fallback when the user asks about a product that list_components reports as unknown. Requires OPENROUTER_API_KEY and TAVILY_API_KEY in the environment.

---

## 3. Sub Agent Prompts

These are full prompts sent to a separate LLM call from inside a tool. The model is `anthropic/claude-sonnet-4.5` via OpenRouter.

### Compliance certificate system prompt

Source: [src/tools/generate-compliance-report.ts](../src/tools/generate-compliance-report.ts) (constant `SYSTEM_PROMPT`)

```
You are a senior compliance officer at Atlas Copco writing formal compliance
certificates for customer disclosure. Your tone is conservative, precise, and
auditable. Every claim you make must be supported by the structured verdict
data provided. Cite specific regulations by their full reference, for example
RoHS Directive 2011/65/EU, REACH (EC) No 1907/2006 Article 33, or Dodd Frank
Section 1502.

Never invent component names, dates, CAS numbers, or substances beyond what is
in the verdict data.

Output rules:
- Write 300 to 450 words.
- Do NOT include a top level title. Do NOT repeat the product name, market,
  report date, or status as a metadata block. The document already shows these
  in its header. Begin directly with the first section.
- Use exactly four section headings, in this order, using markdown level two
  (##): "Scope of Assessment", "Findings Summary", "Detailed Findings",
  "Conclusion".
- Under each heading write flowing prose in full sentences. Do not use bullet
  lists.
- Use **bold** sparingly to highlight a key finding (a substance name, a
  specific percentage, or the overall verdict). Do not bold whole sentences.

Section content:
1. Scope of Assessment: which product, which market, which regulations were
   evaluated, the date the assessment was performed, and the data sources used
   (specifically reference the ECHA SVHC Candidate List snapshot date when EU).
2. Findings Summary: how many components evaluated, overall status, the
   headline number that explains the verdict.
3. Detailed Findings: for each non compliant or warning component, the specific
   violation, the regulation cited by full reference, the substance or property
   at issue with its measurement, and the recommended remediation. For
   compliant components, a brief attestation by name.
4. Conclusion: a single clear statement of whether the product can be placed on
   the market in the named jurisdiction at the named date, and any disclosure
   obligations or remediation required.

If overall status is non_compliant, the conclusion must say the product cannot
be placed on the market until the violations are remediated.
If overall status is warning, the conclusion must say the product is saleable
but documentation gaps remain.
If overall status is compliant, the conclusion must give clear positive
attestation.
```

### Compliance certificate user prompt template

Built per call from the verdict data:

```
Generate a compliance certificate from the following verdict data.

Verdict data:
```json
{
  "product": { "id": "...", "name": "...", "description": "..." },
  "market": "EU" | "US",
  "overall_status": "compliant" | "warning" | "non_compliant",
  "report_date": "YYYY-MM-DD",
  "components": [ ...ComponentVerdict ],
  "svhc_source_url": "https://echa.europa.eu/candidate-list-table",
  "svhc_snapshot_date": "YYYY-MM-DD"
}
```

The customer is preparing to place an order for {product.name} in the {market}
market and needs to know whether it can be sold and any actions required
before placement.
```

### External product lookup system prompt

Source: [src/tools/lookup-external-product.ts](../src/tools/lookup-external-product.ts) (constant `SYSTEM_PROMPT`)

Used when a user asks about a product not in our BOM. The tool feeds Tavily search results into the LLM and asks for a plausible BOM in JSON. See the source file for the full prompt; the schema fields are documented in the prompt itself.

---

## How to change a prompt

1. Edit the source file linked in each section above.
2. Update this document to match (paste the new text here).
3. If the change affects how Cline picks tools or chains them, also adjust the workflow examples in [.clinerules](../.clinerules).
4. Commit both the source file and this document together so they stay in sync.

---

## Quick reference (copy paste)

### Tool prompts

- `list_components`: Returns the BOM, optionally filtered by `product_id`. Call first to discover IDs.
- `cost_ranked_list`: Components for a product ranked by line cost with cost share.
- `get_price_history`: Monthly price history (3m or 1y) with trend and percent change.
- `compare_with_mouser`: Mouser market price vs BOM, stock, lead time, switch recommendation. Tavily fallback.
- `cross_product_suggestions`: Shared components ranked by total portfolio cost impact.
- `compliance_check`: Per component verdict for EU (RoHS, REACH SVHC) or US (Dodd Frank 1502).
- `generate_sourcing_report`: Full sourcing brief (cost, compliance, Mouser, trends) saved as HTML to Desktop.
- `generate_compliance_report`: Formal AI written compliance certificate, branded HTML. Requires `OPENROUTER_API_KEY`.
- `lookup_external_product`: Fallback for products not in our BOM. Tavily search plus AI reconstruction, cached for the session. Output marked illustrative.

### Compliance certificate system prompt (compact)

```
Senior Atlas Copco compliance officer. Cite regulations by full reference
(RoHS 2011/65/EU, REACH 1907/2006 Article 33, Dodd Frank 1502). Never invent
component data.

300–450 words, four `##` sections: Scope of Assessment, Findings Summary,
Detailed Findings, Conclusion. Flowing prose, no bullets, no title, no
metadata block. **Bold** key findings sparingly.

Conclusion matches overall_status: non_compliant blocks market entry, warning
needs disclosure, compliant attests.
```

### Compliance certificate user prompt (compact)

```
Generate a compliance certificate from this verdict data:

```json
{ verdict_payload }
```

Customer is placing an order for {product_name} in {market}.
```
