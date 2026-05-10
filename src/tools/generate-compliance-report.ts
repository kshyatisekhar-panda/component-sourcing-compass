import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadBom } from "../bom.js";
import { evaluate, loadComplianceContext, type ComponentVerdict } from "../compliance.js";
import { chat } from "../llm.js";
import { openInDefaultApp } from "../open-file.js";
import {
  renderBrandedReport,
  escapeHtml,
  type FooterSource,
} from "../report-template.js";
import { text } from "../tool-response.js";

const MODEL = "anthropic/claude-sonnet-4.5";

// ─── LLM prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior compliance officer at Atlas Copco drafting an EU Declaration of Conformity (for the EU market) or an internal market compliance assessment (for the US market). The output is a DRAFT prepared for internal legal review BEFORE the manufacturer's authorised signatory signs the declaration and applies CE marking or other market clearance.

Voice: precise, conservative, auditable. Address Atlas Copco's legal and compliance team, not the end customer. The document will be reviewed and revised by Legal before any external use.

Every claim must be supported by the structured verdict data provided. Cite regulations by their full reference, for example RoHS Directive 2011/65/EU, REACH (EC) No 1907/2006 Article 33, Dodd Frank Section 1502.

Never invent component names, dates, CAS numbers, or substances beyond what is in the verdict data.

Output rules:
- 300 to 450 words.
- Do NOT include a top level title. Do NOT repeat the product name, market, report date, or status as a metadata block. The document already shows these in its header. Begin directly with the first section.
- Use exactly four section headings, in this order, using markdown level two (##): "Scope of Assessment", "Findings Summary", "Detailed Findings", "Recommendation for Legal Review".
- Under each heading write flowing prose in full sentences. Do not use bullet lists.
- Use **bold** sparingly to highlight a key finding (a substance name, a specific percentage, or the overall verdict). Do not bold whole sentences.

Section content:
1. Scope of Assessment: which product, which market, which regulations were evaluated, the date the assessment was performed, and the data sources used (specifically reference the ECHA SVHC Candidate List snapshot date when EU).
2. Findings Summary: how many components evaluated, overall status, the headline number that explains the verdict.
3. Detailed Findings: for each non compliant or warning component, the specific violation, the regulation cited by full reference, the substance or property at issue with its measurement, and the recommended remediation. For compliant components, a brief attestation by name.
4. Recommendation for Legal Review: a single clear recommendation to Legal on whether the document may proceed to manufacturer signature and market placement, or whether remediation is required first.

If overall status is non_compliant, the recommendation must state that the document cannot proceed to signature and CE marking (EU) or market placement (US) until the violations are remediated.
If overall status is warning, the recommendation must state that the document may proceed only after the identified documentation gap is closed.
If overall status is compliant, the recommendation must state that the document is ready for manufacturer signature pending Legal's standard review.`;

// ─── HTML rendering (compliance certificate body) ─────────────────────────────

type OverallStatus = "compliant" | "warning" | "non_compliant";

const STATUS_LABEL: Record<OverallStatus, string> = {
  compliant: "Compliant",
  warning: "Warning",
  non_compliant: "Non Compliant",
};

const MARKET_LABEL: Record<"EU" | "US", string> = {
  EU: "European Union",
  US: "United States",
};

const BODY_CSS = `
  .compliance-body { padding: 36px 48px 28px 48px; }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
    padding-bottom: 26px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 30px;
  }
  .meta-label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 1.6px;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .meta-value { font-size: 14.5px; font-weight: 500; margin-top: 6px; color: var(--ink); }
  .status-pill {
    display: inline-block;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .status-compliant { background: #dff5e1; color: #1f6b35; }
  .status-warning { background: #fdf3d0; color: #8c6500; }
  .status-non_compliant { background: #fde2dc; color: #a8231a; }
  .prose { margin-bottom: 32px; }
  .prose p { margin: 0 0 14px 0; color: var(--ink); }
  .prose strong { color: var(--ink); font-weight: 600; }
  .md-section {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    color: var(--accent);
    margin: 26px 0 10px 0;
    padding: 0;
  }
  .md-section:first-child { margin-top: 0; }
  .findings { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 14px; }
  .findings th {
    text-align: left;
    padding: 10px 12px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--ink-soft);
    border-bottom: 2px solid var(--rule);
    font-weight: 700;
  }
  .findings td { padding: 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  .findings code {
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 12.5px;
    color: var(--ink-soft);
  }
  .findings tr:last-child td { border-bottom: none; }
  .findings-title {
    font-size: 11px;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    color: var(--accent);
    font-weight: 700;
    margin: 0 0 12px 0;
  }
`;

function proseToHtml(prose: string): string {
  let s = escapeHtml(prose).trim();
  s = s.replace(/^#{1,3}\s+(.+?)$/gm, '<h4 class="md-section">$1</h4>');
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>");

  return s
    .split(/\n\s*\n/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<h4")) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

function findingsTable(verdicts: ComponentVerdict[]): string {
  const rows = verdicts
    .map((v) => {
      const violationCount = v.violations.length;
      const violationCell = violationCount === 0 ? "None" : `${violationCount}`;
      const statusClass = `status-${v.status}`;
      return `<tr>
  <td><code>${escapeHtml(v.component_id)}</code></td>
  <td>${escapeHtml(v.component_name)}</td>
  <td><span class="status-pill ${statusClass}">${escapeHtml(STATUS_LABEL[v.status])}</span></td>
  <td>${v.rules_evaluated}</td>
  <td>${violationCell}</td>
</tr>`;
    })
    .join("\n");

  return `<table class="findings">
  <thead>
    <tr>
      <th>Component ID</th>
      <th>Name</th>
      <th>Status</th>
      <th>Rules</th>
      <th>Violations</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

type CertificateInput = {
  product: { id: string; name: string; description?: string };
  market: "EU" | "US";
  overall_status: OverallStatus;
  verdicts: ComponentVerdict[];
  prose: string;
  sources: FooterSource[];
  report_date: string;
};

function renderCertificateHtml(input: CertificateInput): string {
  const isEu = input.market === "EU";
  const docKind = isEu ? "EU Declaration of Conformity" : "US Market Compliance Assessment";
  const documentTitle = `${docKind} (draft), ${input.product.name}, ${MARKET_LABEL[input.market]}`;
  const headerTitle = `${docKind} (draft for legal review)`;
  const headerSubtitle = isEu
    ? `Draft EU Declaration of Conformity for the European Union market. Prepared for internal legal review prior to manufacturer signature and CE marking.`
    : `Draft market compliance assessment for the United States market. Prepared for internal legal review prior to market placement.`;
  const statusLabel = STATUS_LABEL[input.overall_status];

  const body = `<section class="compliance-body">
    <div class="meta-grid">
      <div>
        <div class="meta-label">Product</div>
        <div class="meta-value">${escapeHtml(input.product.name)}</div>
      </div>
      <div>
        <div class="meta-label">Product ID</div>
        <div class="meta-value">${escapeHtml(input.product.id)}</div>
      </div>
      <div>
        <div class="meta-label">Report Date</div>
        <div class="meta-value">${escapeHtml(input.report_date)}</div>
      </div>
      <div>
        <div class="meta-label">Overall Status</div>
        <div class="meta-value"><span class="status-pill status-${input.overall_status}">${escapeHtml(statusLabel)}</span></div>
      </div>
    </div>
    <div class="prose">
${proseToHtml(input.prose)}
    </div>
    <h3 class="findings-title">Per Component Findings</h3>
${findingsTable(input.verdicts)}
  </section>`;

  return renderBrandedReport({
    documentTitle,
    headerTitle,
    headerSubtitle,
    body,
    bodyCss: BODY_CSS,
    footerSources: input.sources,
    footerNote: `This draft was prepared by an AI compliance assistant on ${input.report_date} using structured verdict data from the component sourcing compass. Underlying regulations and substance lists are cited above. All factual claims are traceable to the verdict data. The document must be reviewed and approved by Atlas Copco Legal before manufacturer signature, CE marking, or any external use.`,
  });
}

async function writeCertificateFile(html: string, fileName: string): Promise<string> {
  const dir = join(process.cwd(), "output");
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, fileName);
  await writeFile(fullPath, html, "utf8");
  return fullPath;
}

// ─── MCP tool registration ────────────────────────────────────────────────────

export function registerGenerateComplianceReport(server: McpServer): void {
  server.tool(
    "generate_compliance_report",
    "Generates a draft EU Declaration of Conformity (for EU market) or a draft US market compliance assessment (for US market) for internal legal review at Atlas Copco. The document is NOT a third party certificate; it is the manufacturer's self declaration document that Atlas Copco's authorised signatory will sign after Legal review. Internally runs a complete compliance check, then asks Claude to compose a 300 to 450 word draft citing the specific regulations, components evaluated, findings, and any violations. Returns both the prose for in chat display and a saved Atlas Copco branded HTML file suitable for Legal and Compliance review before manufacturer signature and CE marking (EU) or market placement (US). Use this when the user asks for a declaration of conformity, compliance assessment, audit document, or formal compliance brief for an internal compliance team. Requires OPENROUTER_API_KEY in the environment.",
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
      const overall_status: OverallStatus =
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

      const sources: FooterSource[] = [
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

      const html = renderCertificateHtml({
        product: { id: product.id, name: product.name, description: product.description },
        market,
        overall_status,
        verdicts,
        prose,
        sources,
        report_date: reportDate,
      });

      const fileName = `compliance-${product.id}-${market}-${reportDate}.html`;
      const htmlPath = await writeCertificateFile(html, fileName);
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
