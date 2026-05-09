import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBom } from "../bom.js";
import { evaluate, loadComplianceContext } from "../compliance.js";
import { chat } from "../llm.js";
import { renderReportHtml, writeReportHtml } from "../report-html.js";
import { text } from "../tool-response.js";

const MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are a senior compliance officer at Atlas Copco writing formal compliance certificates for customer disclosure. Your tone is conservative, precise, and auditable. Every claim you make must be supported by the structured verdict data provided. Cite specific regulations by their full reference, for example RoHS Directive 2011/65/EU, REACH (EC) No 1907/2006 Article 33, or Dodd Frank Section 1502.

Never invent component names, dates, CAS numbers, or substances beyond what is in the verdict data.

Write 300 to 450 words. Use plain prose, short paragraphs, no markdown headings, no bullet lists. Use full sentences.

Structure the certificate as four paragraphs:
1. Scope statement: which product, which market, which regulations were evaluated, the date the assessment was performed.
2. Findings summary: how many components evaluated, overall status, key numbers.
3. Detailed findings: for each non compliant component, the specific violation, the regulation cited, the substance or property at issue with measurements, and the recommended remediation. For compliant components, a brief attestation.
4. Conclusion: a single clear statement of whether the product can be placed on the market in the named jurisdiction at the named date, and any disclosure obligations or remediation required.

If the overall status is non_compliant, the conclusion must say the product cannot be placed on the market until the violations are remediated.
If the overall status is warning, the conclusion must say the product is saleable but documentation gaps remain.
If the overall status is compliant, the conclusion must give clear positive attestation.`;

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
