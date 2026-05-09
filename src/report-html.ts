import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ComponentVerdict } from "./compliance.js";
import {
  renderBrandedReport,
  escapeHtml,
  type FooterSource,
} from "./report-template.js";

export type ReportInput = {
  product: { id: string; name: string; description?: string };
  market: "EU" | "US";
  overall_status: "compliant" | "warning" | "non_compliant";
  verdicts: ComponentVerdict[];
  prose: string;
  sources: FooterSource[];
  report_date: string;
};

const STATUS_LABEL: Record<ReportInput["overall_status"], string> = {
  compliant: "Compliant",
  warning: "Warning",
  non_compliant: "Non Compliant",
};

const MARKET_LABEL: Record<ReportInput["market"], string> = {
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

export function renderReportHtml(input: ReportInput): string {
  const documentTitle = `Compliance Certificate — ${input.product.name} — ${MARKET_LABEL[input.market]}`;
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
    headerTitle: "Compliance Certificate",
    headerSubtitle: `Verification of regulatory compliance for product placement on the ${MARKET_LABEL[input.market]} market.`,
    body,
    bodyCss: BODY_CSS,
    footerSources: input.sources,
    footerNote: `This certificate was generated by an AI compliance assistant on ${input.report_date} using structured verdict data from the component sourcing compass. Underlying regulations and substance lists are cited above. All factual claims are traceable to the verdict data. Verify against the official regulatory sources before any binding legal use.`,
  });
}

export async function writeReportHtml(html: string, fileName: string): Promise<string> {
  const dir = join(process.cwd(), "output");
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, fileName);
  await writeFile(fullPath, html, "utf8");
  return fullPath;
}
