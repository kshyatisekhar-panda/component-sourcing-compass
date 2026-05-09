import { writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
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

const LOGO_SVG: string = (() => {
  try {
    let svg = readFileSync(
      join(process.cwd(), "docs", "assets", "atlas-copco-logo.svg"),
      "utf8",
    );
    svg = svg
      .replace(/<\?xml[^>]+\?>\s*/, "")
      .replace(/<!--[\s\S]*?-->\s*/g, "")
      .replace(/\sxmlns:inkscape="[^"]+"/g, "")
      .replace(/\sxmlns:svg="[^"]+"/g, "")
      .replace(/\sinkscape:[a-zA-Z\-]+="[^"]*"/g, "")
      .replace(/fill:#ffffff;fill-opacity:1/g, "fill:#ffffff;fill-opacity:0")
      .replace(/fill:#1f4a58/g, "fill:#ffffff")
      .replace(/fill:#9fa7b4/g, "fill:rgba(255,255,255,0.85)");
    return svg;
  } catch {
    return '<span class="brand-fallback">ATLAS COPCO</span>';
  }
})();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
    --gradientColor1: #054E5A;
    --gradientColor2: #0A6470;
    --gradientColor3: #123F6D;
    --ink: #054E5A;
    --ink-soft: #5a7080;
    --accent: #F68363;
    --beige: #E1B77E;
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
    line-height: 1.65;
  }
  .page {
    max-width: 880px;
    margin: 40px auto;
    background: #ffffff;
    box-shadow: 0 4px 28px rgba(5, 78, 90, 0.08);
  }
  .header {
    background: linear-gradient(94deg, var(--gradientColor1) 4%, var(--gradientColor2) 48%, var(--gradientColor3) 96%);
    color: #ffffff;
    padding: 36px 56px 32px 56px;
  }
  .brand-logo {
    display: inline-block;
    height: 38px;
    margin-bottom: 18px;
  }
  .brand-logo svg { height: 100%; width: auto; display: block; }
  .brand-fallback {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 5px;
    text-transform: uppercase;
  }
  .title {
    font-size: 32px;
    font-weight: 600;
    margin: 6px 0 6px 0;
    letter-spacing: 0.2px;
  }
  .subtitle {
    font-size: 14px;
    opacity: 0.92;
    max-width: 620px;
  }
  .accent-bar {
    height: 4px;
    background: var(--accent);
  }
  .body {
    padding: 36px 56px 28px 56px;
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
  .status-compliant { background: #dff5e1; color: #1f6b35; }
  .status-warning { background: #fdf3d0; color: #8c6500; }
  .status-non_compliant { background: #fde2dc; color: #a8231a; }
  .prose {
    margin-bottom: 32px;
  }
  .prose p {
    margin: 0 0 14px 0;
    color: var(--ink);
  }
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
  .footer {
    padding: 28px 56px 36px 56px;
    background: #f0f3f5;
    font-size: 12.5px;
    color: var(--ink-soft);
    border-top: 4px solid var(--accent);
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
  .footer a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
  .footer a:hover { border-bottom-color: var(--accent); }
  .src-note { color: var(--ink-soft); font-size: 11.5px; }
  .footer .disclosure {
    margin: 0;
    line-height: 1.65;
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
    <div class="brand-logo">${LOGO_SVG}</div>
    <h1 class="title">Compliance Certificate</h1>
    <p class="subtitle">Verification of regulatory compliance for product placement on the ${escapeHtml(MARKET_LABEL[input.market])} market.</p>
  </header>
  <div class="accent-bar"></div>
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
    <h3 class="findings-title">Per Component Findings</h3>
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
