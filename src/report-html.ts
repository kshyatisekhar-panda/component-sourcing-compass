import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ComponentVerdict } from "./compliance.js";

export type ReportInput = {
  product: { id: string; name: string; description?: string };
  market: "EU" | "US";
  overall_status: "compliant" | "warning" | "non_compliant";
  verdicts: ComponentVerdict[];
  prose: string;
  sources: Array<{ label: string; url?: string; note?: string }>;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function proseToHtml(prose: string): string {
  return prose
    .trim()
    .split(/\n\s*\n/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function sourcesToHtml(sources: ReportInput["sources"]): string {
  return sources
    .map((s) => {
      const link = s.url
        ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`
        : escapeHtml(s.label);
      const note = s.note ? ` <span class="src-note">${escapeHtml(s.note)}</span>` : "";
      return `<li>${link}${note}</li>`;
    })
    .join("\n");
}

function findingsTable(verdicts: ComponentVerdict[]): string {
  const rows = verdicts
    .map((v) => {
      const violationCount = v.violations.length;
      const violationCell = violationCount === 0 ? "None" : `${violationCount}`;
      const statusClass = `status-${v.status}`;
      return `<tr>
  <td>${escapeHtml(v.component_id)}</td>
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
  const titleText = `Compliance Certificate — ${input.product.name} — ${MARKET_LABEL[input.market]}`;
  const statusLabel = STATUS_LABEL[input.overall_status];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleText)}</title>
<style>
  :root {
    --gradientColor1: #FF671F;
    --gradientColor2: #F89A4F;
    --gradientColor3: #002B5C;
    --ink: #002B5C;
    --ink-soft: #4a5b78;
    --accent: #FF671F;
    --rule: #e6e9ef;
    --bg: #f7f8fa;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 15px;
    line-height: 1.6;
  }
  .page {
    max-width: 880px;
    margin: 40px auto;
    background: #ffffff;
    box-shadow: 0 4px 28px rgba(20, 54, 91, 0.08);
  }
  .header {
    background: linear-gradient(94deg, var(--gradientColor1) 4%, var(--gradientColor2) 48%, var(--gradientColor3) 96%);
    color: #ffffff;
    padding: 44px 56px 36px 56px;
  }
  .brand {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 5px;
    text-transform: uppercase;
    opacity: 0.95;
  }
  .title {
    font-size: 34px;
    font-weight: 600;
    margin: 14px 0 6px 0;
    letter-spacing: 0.2px;
  }
  .subtitle {
    font-size: 14px;
    opacity: 0.92;
    max-width: 600px;
  }
  .body {
    padding: 38px 56px 28px 56px;
  }
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
  .meta-value {
    font-size: 14.5px;
    font-weight: 500;
    margin-top: 6px;
    color: var(--ink);
  }
  .status-pill {
    display: inline-block;
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .status-compliant { background: #e3f5e3; color: #2c7a2c; }
  .status-warning { background: #fff7d6; color: #9a6e00; }
  .status-non_compliant { background: #fde2de; color: #a8231a; }
  .prose {
    margin-bottom: 32px;
  }
  .prose p {
    margin: 0 0 14px 0;
    color: var(--ink);
  }
  .findings {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 14px;
  }
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
  .findings td {
    padding: 12px;
    border-bottom: 1px solid var(--rule);
    vertical-align: top;
  }
  .findings tr:last-child td { border-bottom: none; }
  .footer {
    padding: 28px 56px 36px 56px;
    background: #f0f2f6;
    font-size: 12.5px;
    color: var(--ink-soft);
    border-top: 4px solid var(--gradientColor1);
  }
  .footer h4 {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin: 0 0 8px 0;
    color: var(--ink);
  }
  .footer ul {
    margin: 0 0 18px 0;
    padding-left: 18px;
  }
  .footer li {
    margin-bottom: 4px;
  }
  .footer a { color: var(--ink); }
  .src-note { color: var(--ink-soft); font-size: 11.5px; }
  .footer .disclosure {
    margin: 0;
    line-height: 1.6;
  }
  @media print {
    body { background: #ffffff; }
    .page { margin: 0; max-width: none; box-shadow: none; }
    .header { padding: 32px 48px 24px 48px; }
    .body, .footer { padding-left: 48px; padding-right: 48px; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="header">
    <div class="brand">Atlas Copco</div>
    <h1 class="title">Compliance Certificate</h1>
    <p class="subtitle">Verification of regulatory compliance for product placement on the ${escapeHtml(MARKET_LABEL[input.market])} market.</p>
  </header>
  <section class="body">
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
    <h3 style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:var(--ink-soft);font-weight:700;margin:0 0 12px 0;">Per Component Findings</h3>
${findingsTable(input.verdicts)}
  </section>
  <footer class="footer">
    <div>
      <h4>Sources and Citations</h4>
      <ul>
${sourcesToHtml(input.sources)}
      </ul>
    </div>
    <div>
      <h4>Disclosure</h4>
      <p class="disclosure">This certificate was generated by an AI compliance assistant on ${escapeHtml(input.report_date)} using structured verdict data from the component sourcing compass. Underlying regulations and substance lists are cited above. All factual claims are traceable to the verdict data. Verify against the official regulatory sources before any binding legal use.</p>
    </div>
  </footer>
</div>
</body>
</html>`;
}

export async function writeReportHtml(html: string, fileName: string): Promise<string> {
  const dir = join(process.cwd(), "output");
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, fileName);
  await writeFile(fullPath, html, "utf8");
  return fullPath;
}
