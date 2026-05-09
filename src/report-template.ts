import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared Atlas Copco brand template.
 *
 * Both `generate_sourcing_report` and `generate_compliance_report` render
 * their HTML through this module so the brand chrome (logo, gradient header,
 * accent bar, footer, palette) lives in exactly one place. New report tools
 * should call `renderBrandedReport` and only contribute their body content.
 */

export const BRAND_COLORS = {
  gradient1: "#054E5A",
  gradient2: "#0A6470",
  gradient3: "#123F6D",
  ink: "#054E5A",
  inkSoft: "#5a7080",
  accent: "#F68363",
  rule: "#e6e9ef",
  bg: "#f7f8fa",
} as const;

export const LOGO_SVG: string = (() => {
  try {
    return readFileSync(
      join(process.cwd(), "docs", "assets", "atlas-copco-logo.svg"),
      "utf8",
    ).replace(/<\?xml[^>]+\?>\s*/, "");
  } catch {
    return '<span class="brand-fallback">ATLAS COPCO</span>';
  }
})();

export const BRAND_BASE_CSS = `
  :root {
    --gradientColor1: ${BRAND_COLORS.gradient1};
    --gradientColor2: ${BRAND_COLORS.gradient2};
    --gradientColor3: ${BRAND_COLORS.gradient3};
    --ink: ${BRAND_COLORS.ink};
    --ink-soft: ${BRAND_COLORS.inkSoft};
    --accent: ${BRAND_COLORS.accent};
    --rule: ${BRAND_COLORS.rule};
    --bg: ${BRAND_COLORS.bg};
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
    max-width: 960px;
    margin: 40px auto;
    background: #ffffff;
    box-shadow: 0 8px 32px rgba(5, 78, 90, 0.10);
    overflow: hidden;
  }
  .brand-header {
    background: linear-gradient(94deg, var(--gradientColor1) 4%, var(--gradientColor2) 48%, var(--gradientColor3) 96%);
    color: #ffffff;
    padding: 32px 48px 28px 48px;
  }
  .brand-logo {
    display: inline-block;
    background: #ffffff;
    padding: 6px 12px;
    border-radius: 6px;
    margin-bottom: 14px;
    line-height: 0;
  }
  .brand-logo svg { height: 36px; width: auto; display: block; }
  .brand-fallback {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 5px;
    text-transform: uppercase;
  }
  .brand-title {
    font-size: 28px;
    font-weight: 700;
    margin: 4px 0 4px 0;
    letter-spacing: 0.2px;
  }
  .brand-subtitle {
    font-size: 14px;
    opacity: 0.92;
    max-width: 620px;
    margin: 4px 0 0 0;
  }
  .brand-meta {
    font-size: 13px;
    opacity: 0.88;
    margin-top: 6px;
  }
  .brand-meta .accent { color: var(--accent); font-weight: 700; }
  .accent-bar { height: 4px; background: var(--accent); }
  .brand-footer {
    padding: 24px 48px 28px 48px;
    background: #fafbfc;
    font-size: 12.5px;
    color: var(--ink-soft);
    border-top: 2px solid var(--accent);
  }
  .brand-footer h4 {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin: 0 0 8px 0;
    color: var(--ink);
  }
  .brand-footer ul { margin: 0 0 16px 0; padding-left: 18px; }
  .brand-footer li { margin-bottom: 4px; }
  .brand-footer a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--rule); }
  .brand-footer a:hover { border-bottom-color: var(--accent); }
  .brand-footer .src-note { color: var(--ink-soft); font-size: 11.5px; }
  .brand-footer .disclosure { margin: 0; line-height: 1.65; }
  @media print {
    body { background: #ffffff; }
    .page { margin: 0; max-width: none; box-shadow: none; }
    .brand-header { padding: 28px 40px 22px 40px; }
    .brand-footer { padding: 20px 40px 24px 40px; }
  }
`;

export type FooterSource = { label: string; url?: string; note?: string };

export type BrandedReportInput = {
  /** Plain text used in the <title> tag */
  documentTitle: string;
  /** h1 inside the gradient header */
  headerTitle: string;
  /** Short text under the title */
  headerSubtitle?: string;
  /** Raw HTML allowed (e.g. `<span class="accent">EU Market</span>`) */
  headerMeta?: string;
  /** Raw HTML for the body content between header and footer */
  body: string;
  /** Optional list of sources rendered in the footer */
  footerSources?: FooterSource[];
  /** Disclosure note rendered at the bottom of the footer */
  footerNote: string;
  /** Body specific CSS appended after the brand base CSS */
  bodyCss?: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sourcesHtml(sources: FooterSource[]): string {
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

export function renderBrandedReport(input: BrandedReportInput): string {
  const sources =
    input.footerSources && input.footerSources.length > 0
      ? `<div><h4>Sources and Citations</h4><ul>${sourcesHtml(input.footerSources)}</ul></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.documentTitle)}</title>
<style>
${BRAND_BASE_CSS}
${input.bodyCss ?? ""}
</style>
</head>
<body>
<div class="page">
  <header class="brand-header">
    <div class="brand-logo">${LOGO_SVG}</div>
    <h1 class="brand-title">${escapeHtml(input.headerTitle)}</h1>
    ${input.headerSubtitle ? `<p class="brand-subtitle">${escapeHtml(input.headerSubtitle)}</p>` : ""}
    ${input.headerMeta ? `<div class="brand-meta">${input.headerMeta}</div>` : ""}
  </header>
  <div class="accent-bar"></div>
  ${input.body}
  <footer class="brand-footer">
    ${sources}
    <div><h4>Disclosure</h4><p class="disclosure">${escapeHtml(input.footerNote)}</p></div>
  </footer>
</div>
</body>
</html>`;
}
