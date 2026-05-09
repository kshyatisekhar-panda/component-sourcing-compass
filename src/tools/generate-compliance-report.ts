import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBom } from "../bom.js";
import { evaluate, loadComplianceContext } from "../compliance.js";
import { chat } from "../llm.js";
import { renderReportHtml, writeReportHtml } from "../report-html.js";
import { openInDefaultApp } from "../open-file.js";
import { text } from "../tool-response.js";

const MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are a senior compliance officer at Atlas Copco writing formal compliance certificates for customer disclosure. Your tone is conservative, precise, and auditable. Every claim you make must be supported by the structured verdict data provided. Cite specific regulations by their full reference, for example RoHS Directive 2011/65/EU, REACH (EC) No 1907/2006 Article 33, or Dodd Frank Section 1502.

Never invent component names, dates, CAS numbers, or substances beyond what is in the verdict data.

Output rules:
- Write 300 to 450 words.
- Do NOT include a top level title. Do NOT repeat the product name, market, report date, or status as a metadata block. The document already shows these in its header. Begin directly with the first section.
- Use exactly four section headings, in this order, using markdown level two (##): "Scope of Assessment", "Findings Summary", "Detailed Findings", "Conclusion".
- Under each heading write flowing prose in full sentences. Do not use bullet lists.
- Use **bold** sparingly to highlight a key finding (a substance name, a specific percentage, or the overall verdict). Do not bold whole sentences.

Section content:
1. Scope of Assessment: which product, which market, which regulations were evaluated, the date the assessment was performed, and the data sources used (specifically reference the ECHA SVHC Candidate List snapshot date when EU).
2. Findings Summary: how many components evaluated, overall status, the headline number that explains the verdict.
3. Detailed Findings: for each non compliant or warning component, the specific violation, the regulation cited by full reference, the substance or property at issue with its measurement, and the recommended remediation. For compliant components, a brief attestation by name.
4. Conclusion: a single clear statement of whether the product can be placed on the market in the named jurisdiction at the named date, and any disclosure obligations or remediation required.

If overall status is non_compliant, the conclusion must say the product cannot be placed on the market until the violations are remediated.
If overall status is warning, the conclusion must say the product is saleable but documentation gaps remain.
If overall status is compliant, the conclusion must give clear positive attestation.`;

export function registerGenerateComplianceReport(server: McpServer): void {
  server.tool(
    "generate_compliance_report",
    "Generates a formal Atlas Copco branded compliance certificate for a product against a target market. Internally runs a complete compliance check, then asks Claude to compose a 300 to 450 word certificate citing the specific regulations, components evaluated, findings, and any violations. Returns both the prose for in chat display and a saved HTML file with full Atlas Copco branding (gradient header, findings table, sources, AI generation disclosure) suitable for opening in a browser or printing to PDF for customer disclosure. Use this when the user asks for a compliance certificate, audit document, customer disclosure, or formal compliance report. Requires OPENROUTER_API_KEY in the environment.",
    {
      product_id: z.string().describe("Product ID to certify (e.g. PROD-AC-COMP-001)."),
      market: z.enum(["EU", "US"]).describe("Target market for the certificate: 'EU' or 'US'."),
    },
    async ({ product_id, market }) => {
      const [bom, ctx] = await Promise.all([loadBom(), loadComplianceContext()]);

      const product = bom.products.find((p) => p.id === product_id);
      if (!product) {
        const known = bom.products.map((p) => p.id).join(", ");
        return text(`Unknown product "${product_id}". Known: ${known}.`, { error: true });
      }

      const verdicts = product.components.flatMap(({ component_id }) => {
        const c = bom.components.find((x) => x.id === component_id);
        return c ? [evaluate(c, market, ctx)] : [];
      });

      const blocking = verdicts.filter((v) => v.status === "non_compliant").length;
      const warnings = verdicts.filter((v) => v.status === "warning").length;
      const overall_status =
        blocking > 0 ? "non_compliant" : warnings > 0 ? "warning" : "compliant";

      const reportDate = new Date().toISOString().slice(0, 10);

      const promptPayload = {
        product: { id: product.id, name: product.name, description: product.description },
        market,
        overall_status,
        report_date: reportDate,
        components: verdicts,
        svhc_source_url: ctx.svhc.source,
        svhc_snapshot_date: ctx.svhc.snapshot_date,
      };

      const userPrompt = `Generate a compliance certificate from the following verdict data.\n\nVerdict data:\n\`\`\`json\n${JSON.stringify(promptPayload, null, 2)}\n\`\`\`\n\nThe customer is preparing to place an order for ${product.name} in the ${market} market and needs to know whether it can be sold and any actions required before placement.`;

      let prose: string;
      try {
        const result = await chat({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1500,
        });
        prose = result.content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return text(
          `Failed to generate compliance report: ${msg}\n\nMake sure OPENROUTER_API_KEY is set in .env, then restart the MCP server in your client.`,
          { error: true },
        );
      }

      if (!prose.trim()) {
        return text("LLM returned an empty response. Try again.", { error: true });
      }

      const sources: Array<{ label: string; url?: string; note?: string }> = [
        {
          label: "RoHS Directive 2011/65/EU",
          url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011L0065",
        },
        {
          label: "REACH (EC) No 1907/2006",
          url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02006R1907-20140410",
        },
        {
          label: "ECHA SVHC Candidate List",
          url: ctx.svhc.source,
          note: `snapshot ${ctx.svhc.snapshot_date}`,
        },
        {
          label: "Dodd Frank Wall Street Reform Act, Section 1502",
          url: "https://www.sec.gov/spotlight/dodd-frank.shtml",
        },
      ];

      const html = renderReportHtml({
        product: { id: product.id, name: product.name, description: product.description },
        market,
        overall_status,
        verdicts,
        prose,
        sources,
        report_date: reportDate,
      });

      const fileName = `compliance-${product.id}-${market}-${reportDate}.html`;
      const htmlPath = await writeReportHtml(html, fileName);
      openInDefaultApp(htmlPath);

      return text({
        scope: { type: "product", id: product.id, name: product.name },
        market,
        overall_status,
        report_date: reportDate,
        model: MODEL,
        html_path: htmlPath,
        prose,
      });
    },
  );
}
