import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadBom } from "./bom.js";
import { loadComplianceContext, evaluate } from "./compliance.js";
import { searchByMfrPartNumber } from "./mouser.js";
import { USD_TO_EUR } from "./config.js";
import type { ComponentVerdict } from "./compliance.js";
import { renderBrandedReport } from "./report-template.js";

const HISTORY_PATH = join(process.cwd(), "data", "price-history.seed.json");

// ─── Types ────────────────────────────────────────────────────────────────────

type PricePoint = { date: string; unit_cost: number; currency: string };
type PriceHistory = Record<string, PricePoint[]>;

type CostLine = {
  rank: number;
  component_id: string;
  name: string;
  unit_cost: number;
  quantity: number;
  line_cost: number;
  cost_share_pct: number;
};

type MouserComparison = {
  component_id: string;
  name: string;
  bom_price_eur: number;
  mouser_price_eur: number | null;
  savings_eur: number | null;
  savings_pct: number | null;
  availability: number | null;
  recommendation: string;
};

type PriceTrend = {
  component_id: string;
  name: string;
  three_months_ago: number;
  current: number;
  change_pct: number;
  trend: "rising" | "falling" | "stable";
  series: number[];
};

export type ReportData = {
  product: { id: string; name: string; description?: string };
  market: "EU" | "US";
  generated_at: string;
  total_bom_cost: number;
  cost_breakdown: CostLine[];
  compliance_verdicts: ComponentVerdict[];
  overall_compliance: "compliant" | "warning" | "non_compliant";
  mouser_comparisons: MouserComparison[];
  price_trends: PriceTrend[];
  total_potential_saving_eur: number;
  recommendations: string[];
};

// ─── Data builder ─────────────────────────────────────────────────────────────

export async function buildReportData(
  product_id: string,
  market: "EU" | "US",
): Promise<ReportData | { error: string }> {
  const [bom, ctx, historyRaw] = await Promise.all([
    loadBom(),
    loadComplianceContext(),
    readFile(HISTORY_PATH, "utf8"),
  ]);

  const product = bom.products.find((p) => p.id === product_id);
  if (!product) {
    const known = bom.products.map((p) => p.id).join(", ");
    return { error: `Unknown product "${product_id}". Known: ${known}.` };
  }

  const history = JSON.parse(historyRaw) as PriceHistory;

  // ── Cost breakdown ──────────────────────────────────────────────────────────
  const lines = product.components.flatMap(({ component_id, quantity }) => {
    const c = bom.components.find((x) => x.id === component_id);
    if (!c) return [];
    return [{ component: c, quantity, line_cost: +(c.unit_cost * quantity).toFixed(2) }];
  });
  lines.sort((a, b) => b.line_cost - a.line_cost);
  const total = +lines.reduce((s, l) => s + l.line_cost, 0).toFixed(2);

  const cost_breakdown: CostLine[] = lines.map((l, i) => ({
    rank: i + 1,
    component_id: l.component.id,
    name: l.component.name,
    unit_cost: l.component.unit_cost,
    quantity: l.quantity,
    line_cost: l.line_cost,
    cost_share_pct: +((l.line_cost / total) * 100).toFixed(1),
  }));

  // ── Compliance ──────────────────────────────────────────────────────────────
  const compliance_verdicts = product.components.flatMap(({ component_id }) => {
    const c = bom.components.find((x) => x.id === component_id);
    return c ? [evaluate(c, market, ctx)] : [];
  });

  const overall_compliance: ReportData["overall_compliance"] = compliance_verdicts.some(
    (v) => v.status === "non_compliant",
  )
    ? "non_compliant"
    : compliance_verdicts.some((v) => v.status === "warning")
      ? "warning"
      : "compliant";

  // ── Mouser comparison (top 2 cost components) ───────────────────────────────
  const mouser_comparisons: MouserComparison[] = await Promise.all(
    lines.slice(0, 2).map(async ({ component: c }) => {
      if (!c.manufacturer_part_number) {
        return {
          component_id: c.id,
          name: c.name,
          bom_price_eur: c.unit_cost,
          mouser_price_eur: null,
          savings_eur: null,
          savings_pct: null,
          availability: null,
          recommendation: "No manufacturer part number available.",
        };
      }
      const result = await searchByMfrPartNumber(c.manufacturer_part_number);
      if (!result.found) {
        return {
          component_id: c.id,
          name: c.name,
          bom_price_eur: c.unit_cost,
          mouser_price_eur: null,
          savings_eur: null,
          savings_pct: null,
          availability: null,
          recommendation: "Not found on Mouser.",
        };
      }
      const mouserEur = +(result.unitPriceUsd * USD_TO_EUR).toFixed(2);
      const savingsEur = +(c.unit_cost - mouserEur).toFixed(2);
      const savingsPct = +((savingsEur / c.unit_cost) * 100).toFixed(1);
      return {
        component_id: c.id,
        name: c.name,
        bom_price_eur: c.unit_cost,
        mouser_price_eur: mouserEur,
        savings_eur: savingsEur,
        savings_pct: savingsPct,
        availability: result.availabilityInStock,
        recommendation:
          savingsEur > 0
            ? `Mouser is ${savingsPct}% cheaper — consider switching supplier.`
            : `Current supplier is ${Math.abs(savingsPct)}% cheaper — no switch needed.`,
      };
    }),
  );

  const total_potential_saving_eur = +mouser_comparisons
    .filter((m) => (m.savings_eur ?? 0) > 0)
    .reduce((s, m) => s + (m.savings_eur ?? 0), 0)
    .toFixed(2);

  // ── Price trends (3 months) ─────────────────────────────────────────────────
  const price_trends: PriceTrend[] = product.components.flatMap(({ component_id }) => {
    const c = bom.components.find((x) => x.id === component_id);
    if (!c) return [];
    const points = history[component_id] ?? [];
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    const filtered = points.filter((p) => new Date(p.date) >= cutoff);
    if (filtered.length < 2) return [];
    const first = filtered[0];
    const last = filtered[filtered.length - 1];
    const change_pct = +(((last.unit_cost - first.unit_cost) / first.unit_cost) * 100).toFixed(1);
    return [
      {
        component_id: c.id,
        name: c.name,
        three_months_ago: first.unit_cost,
        current: last.unit_cost,
        change_pct,
        trend: change_pct > 1 ? "rising" : change_pct < -1 ? "falling" : "stable",
        series: filtered.map((p) => p.unit_cost),
      },
    ];
  });

  // ── Recommendations ─────────────────────────────────────────────────────────
  const recommendations: string[] = [];

  const blocking = compliance_verdicts.filter((v) => v.status === "non_compliant");
  if (blocking.length > 0) {
    recommendations.push(
      `🚫 ${blocking.length} component(s) have blocking compliance violations — ${product.name} cannot be placed on the ${market} market without remediation.`,
    );
  }

  const warnings = compliance_verdicts.filter((v) => v.status === "warning");
  if (warnings.length > 0) {
    recommendations.push(
      `⚠️ ${warnings.length} component(s) have compliance warnings — obtain supplier declarations before market entry.`,
    );
  }

  for (const m of mouser_comparisons) {
    if ((m.savings_eur ?? 0) > 0) {
      recommendations.push(
        `💰 Switch ${m.name} to Mouser — save €${m.savings_eur}/unit (${m.savings_pct}%). Verify country of origin before switching.`,
      );
    }
  }

  for (const t of price_trends) {
    if (t.trend === "rising") {
      recommendations.push(
        `📈 ${t.name} up ${t.change_pct}% in 3 months — lock in price with current supplier or find alternative.`,
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "✅ No critical issues identified. Product is well-optimised for the selected market.",
    );
  }

  return {
    product: { id: product.id, name: product.name, description: product.description },
    market,
    generated_at: new Date().toISOString(),
    total_bom_cost: total,
    cost_breakdown,
    compliance_verdicts,
    overall_compliance,
    mouser_comparisons,
    price_trends,
    total_potential_saving_eur,
    recommendations,
  };
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

const COMPLIANCE_EMOJI: Record<string, string> = {
  compliant: "✅",
  warning: "⚠️",
  non_compliant: "❌",
};

const TREND_EMOJI: Record<string, string> = {
  rising: "📈",
  falling: "📉",
  stable: "➡️",
};

export function toMarkdown(data: ReportData): string {
  const date = new Date(data.generated_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const lines: string[] = [
    `# Sourcing Report — ${data.product.name}`,
    `**Market:** ${data.market} &nbsp;|&nbsp; **Generated:** ${date} &nbsp;|&nbsp; **Total BOM Cost:** €${data.total_bom_cost}`,
    "",
    "---",
    "",
    "## Cost Breakdown",
    "",
    "| Rank | Component | Unit Cost | Qty | Line Cost | Share |",
    "|------|-----------|-----------|-----|-----------|-------|",
    ...data.cost_breakdown.map(
      (l) =>
        `| ${l.rank} | ${l.name} | €${l.unit_cost.toFixed(2)} | ${l.quantity} | €${l.line_cost.toFixed(2)} | ${l.cost_share_pct}% |`,
    ),
    "",
    "---",
    "",
    `## Compliance — ${data.market} Market`,
    "",
    `**Overall status:** ${COMPLIANCE_EMOJI[data.overall_compliance]} ${data.overall_compliance.replace("_", " ").toUpperCase()}`,
    "",
    "| Component | Status | Violations |",
    "|-----------|--------|------------|",
    ...data.compliance_verdicts.map(
      (v) =>
        `| ${v.component_name} | ${COMPLIANCE_EMOJI[v.status]} ${v.status.replace("_", " ")} | ${v.violations.length === 0 ? "None" : v.violations.map((x) => x.title).join("; ")} |`,
    ),
  ];

  const withViolations = data.compliance_verdicts.filter((v) => v.violations.length > 0);
  if (withViolations.length > 0) {
    lines.push("", "### Violation Details", "");
    for (const v of withViolations) {
      lines.push(`**${v.component_name}**`);
      for (const viol of v.violations) {
        lines.push(
          `- ${viol.severity === "blocking" ? "❌" : "⚠️"} **${viol.title}**`,
          `  - Finding: ${viol.finding}`,
          `  - Action: ${viol.recommendation}`,
        );
      }
      lines.push("");
    }
  }

  lines.push(
    "---",
    "",
    "## Market Price Comparison (Mouser Electronics)",
    "",
    "| Component | BOM Price | Mouser Price | Saving | Recommendation |",
    "|-----------|-----------|--------------|--------|----------------|",
    ...data.mouser_comparisons.map((m) => {
      const mouser = m.mouser_price_eur != null ? `€${m.mouser_price_eur.toFixed(2)}` : "—";
      const saving =
        m.savings_eur != null
          ? m.savings_eur > 0
            ? `💰 €${m.savings_eur.toFixed(2)} (${m.savings_pct}%)`
            : `➡️ €${Math.abs(m.savings_eur).toFixed(2)} more`
          : "—";
      return `| ${m.name} | €${m.bom_price_eur.toFixed(2)} | ${mouser} | ${saving} | ${m.recommendation} |`;
    }),
    "",
    "---",
    "",
    "## 3-Month Price Trends",
    "",
    "| Component | 3 Months Ago | Today | Change | Trend |",
    "|-----------|-------------|-------|--------|-------|",
    ...data.price_trends.map(
      (t) =>
        `| ${t.name} | €${t.three_months_ago.toFixed(2)} | €${t.current.toFixed(2)} | ${t.change_pct > 0 ? "+" : ""}${t.change_pct}% | ${TREND_EMOJI[t.trend]} ${t.trend} |`,
    ),
    "",
    "---",
    "",
    "## Key Recommendations",
    "",
    ...data.recommendations.map((r) => `- ${r}`),
    "",
    total_potential_saving_eur_line(data),
  );

  return lines.join("\n");
}

function total_potential_saving_eur_line(data: ReportData): string {
  if (data.total_potential_saving_eur > 0) {
    return `> 💡 **Total potential saving identified: €${data.total_potential_saving_eur.toFixed(2)} per unit** across Mouser price comparisons.`;
  }
  return `> ✅ Current supplier pricing is competitive — no immediate switching opportunities identified.`;
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

const COMPLIANCE_COLOR: Record<string, string> = {
  compliant: "#2E7D32",
  warning: "#E65100",
  non_compliant: "#B71C1C",
};

const COMPLIANCE_BG: Record<string, string> = {
  compliant: "#E8F5E9",
  warning: "#FFF3E0",
  non_compliant: "#FFEBEE",
};

const SOURCING_BODY_CSS = `
  .kpi-bar { display: flex; gap: 0; border-bottom: 1px solid #E0E0E0; }
  .kpi { flex: 1; padding: 20px 24px; border-right: 1px solid #E0E0E0; }
  .kpi:last-child { border-right: none; }
  .kpi .label { font-size: 11px; text-transform: uppercase; letter-spacing: .8px; color: #5a7080; margin-bottom: 4px; font-weight: 700; }
  .kpi .value { font-size: 22px; font-weight: 700; color: var(--ink); }
  .kpi .sub { font-size: 12px; color: #888; margin-top: 2px; }
  section.report-section { padding: 32px 48px; border-bottom: 1px solid #E0E0E0; }
  section.report-section:last-of-type { border-bottom: none; }
  section.report-section h2 {
    font-size: 16px;
    font-weight: 700;
    color: var(--ink);
    margin-bottom: 20px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--accent);
    display: inline-block;
  }
  section.report-section table { width: 100%; border-collapse: collapse; }
  section.report-section table tr:last-child td { border-bottom: none; }
  .recommendations { list-style: none; padding: 0; margin: 0; }
  .recommendations li {
    padding: 10px 14px;
    margin-bottom: 8px;
    background: #F8F9FA;
    border-radius: 6px;
    font-size: 14px;
    border-left: 4px solid var(--ink);
  }
  .saving-box {
    background: #E8F5E9;
    border: 1px solid #A5D6A7;
    border-radius: 8px;
    padding: 14px 20px;
    margin-top: 16px;
    font-size: 14px;
    color: #2E7D32;
    font-weight: 600;
  }
  .cost-bars { margin-bottom: 24px; }
  .cost-bar-row {
    display: grid;
    grid-template-columns: 220px 1fr 70px 90px;
    align-items: center;
    gap: 14px;
    margin-bottom: 8px;
    font-size: 13px;
  }
  .cost-bar-label { color: var(--ink); font-weight: 500; }
  .cost-bar-track {
    background: #f0f3f5;
    height: 18px;
    border-radius: 9px;
    overflow: hidden;
  }
  .cost-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--gradientColor1), var(--gradientColor2));
    border-radius: 9px;
  }
  .cost-bar-pct { text-align: right; color: var(--ink); font-weight: 600; }
  .cost-bar-eur { text-align: right; color: var(--ink-soft); font-size: 12px; }
  .sparkline-cell { width: 130px; }
  .sparkline-cell svg { display: block; }
`;

function costBarsHtml(lines: ReportData["cost_breakdown"]): string {
  if (lines.length === 0) return "";
  return `<div class="cost-bars">
    ${lines
      .map(
        (l) => `<div class="cost-bar-row">
          <div class="cost-bar-label">${l.name}</div>
          <div class="cost-bar-track"><div class="cost-bar-fill" style="width:${Math.max(2, l.cost_share_pct)}%"></div></div>
          <div class="cost-bar-pct">${l.cost_share_pct}%</div>
          <div class="cost-bar-eur">€${l.line_cost.toFixed(2)}</div>
        </div>`,
      )
      .join("\n")}
  </div>`;
}

function sparklineSvg(series: number[]): string {
  if (series.length < 2) return "";
  const w = 120;
  const h = 30;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const stepX = w / (series.length - 1);
  const points = series.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${w},${h} L 0,${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <path d="${areaPath}" fill="#F68363" fill-opacity="0.14"/>
    <path d="${linePath}" stroke="#F68363" stroke-width="2" fill="none" stroke-linejoin="round"/>
  </svg>`;
}

export function toHtml(data: ReportData): string {
  const date = new Date(data.generated_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const badge = (status: string) =>
    `<span style="background:${COMPLIANCE_BG[status]};color:${COMPLIANCE_COLOR[status]};padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">${COMPLIANCE_EMOJI[status]} ${status.replace("_", " ")}</span>`;

  const th = (s: string) =>
    `<th style="background:#054E5A;color:#fff;padding:10px 14px;text-align:left;font-weight:600;font-size:13px">${s}</th>`;
  const td = (s: string, extra = "") =>
    `<td style="padding:10px 14px;border-bottom:1px solid #E0E0E0;font-size:13px;${extra}">${s}</td>`;

  const costRows = data.cost_breakdown
    .map(
      (l) => `<tr>
      ${td(String(l.rank), "color:#666")}
      ${td(`<strong>${l.name}</strong>`)}
      ${td(`€${l.unit_cost.toFixed(2)}`)}
      ${td(String(l.quantity))}
      ${td(`<strong>€${l.line_cost.toFixed(2)}</strong>`)}
      ${td(`<span style="background:#E3F2FD;color:#0D47A1;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600">${l.cost_share_pct}%</span>`)}
    </tr>`,
    )
    .join("\n");

  const complianceRows = data.compliance_verdicts
    .map(
      (v) => `<tr>
      ${td(`<strong>${v.component_name}</strong>`)}
      ${td(badge(v.status))}
      ${td(v.violations.length === 0 ? '<span style="color:#2E7D32">None</span>' : v.violations.map((x) => `<div style="margin-bottom:4px">• ${x.title}</div>`).join(""))}
    </tr>`,
    )
    .join("\n");

  const violationDetails = data.compliance_verdicts
    .filter((v) => v.violations.length > 0)
    .map(
      (v) => `
      <div style="margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:8px">${v.component_name}</div>
        ${v.violations
          .map(
            (viol) => `
          <div style="background:${COMPLIANCE_BG[v.status]};border-left:4px solid ${COMPLIANCE_COLOR[v.status]};padding:10px 14px;margin-bottom:8px;border-radius:0 6px 6px 0">
            <div style="font-weight:600;color:${COMPLIANCE_COLOR[v.status]};margin-bottom:4px">${viol.title}</div>
            <div style="font-size:13px;margin-bottom:4px"><strong>Finding:</strong> ${viol.finding}</div>
            <div style="font-size:13px"><strong>Action:</strong> ${viol.recommendation}</div>
          </div>`,
          )
          .join("")}
      </div>`,
    )
    .join("");

  const mouserRows = data.mouser_comparisons
    .map((m) => {
      const mouser = m.mouser_price_eur != null ? `€${m.mouser_price_eur.toFixed(2)}` : "—";
      const saving =
        m.savings_eur != null
          ? m.savings_eur > 0
            ? `<span style="color:#2E7D32;font-weight:600">💰 €${m.savings_eur.toFixed(2)} (${m.savings_pct}%)</span>`
            : `<span style="color:#666">+€${Math.abs(m.savings_eur).toFixed(2)} more expensive</span>`
          : "—";
      return `<tr>
      ${td(`<strong>${m.name}</strong>`)}
      ${td(`€${m.bom_price_eur.toFixed(2)}`)}
      ${td(mouser)}
      ${td(saving)}
      ${td(m.recommendation, "font-size:12px;color:#555")}
    </tr>`;
    })
    .join("\n");

  const trendRows = data.price_trends
    .map((t) => {
      const changeColor =
        t.trend === "rising" ? "#B71C1C" : t.trend === "falling" ? "#2E7D32" : "#555";
      const changeStr = `${t.change_pct > 0 ? "+" : ""}${t.change_pct}%`;
      return `<tr>
      ${td(`<strong>${t.name}</strong>`)}
      ${td(`<div class="sparkline-cell">${sparklineSvg(t.series)}</div>`)}
      ${td(`€${t.three_months_ago.toFixed(2)}`)}
      ${td(`€${t.current.toFixed(2)}`)}
      ${td(`<span style="color:${changeColor};font-weight:600">${changeStr}</span>`)}
      ${td(`${TREND_EMOJI[t.trend]} ${t.trend}`)}
    </tr>`;
    })
    .join("\n");

  const body = `<div class="kpi-bar">
    <div class="kpi">
      <div class="label">Total BOM Cost</div>
      <div class="value">€${data.total_bom_cost.toFixed(2)}</div>
      <div class="sub">per unit</div>
    </div>
    <div class="kpi">
      <div class="label">Compliance</div>
      <div class="value" style="color:${COMPLIANCE_COLOR[data.overall_compliance]}">${COMPLIANCE_EMOJI[data.overall_compliance]} ${data.overall_compliance.replace("_", " ").toUpperCase()}</div>
      <div class="sub">${data.market} market</div>
    </div>
    <div class="kpi">
      <div class="label">Potential Saving</div>
      <div class="value" style="color:${data.total_potential_saving_eur > 0 ? "#2E7D32" : "#555"}">€${data.total_potential_saving_eur.toFixed(2)}</div>
      <div class="sub">per unit via Mouser</div>
    </div>
    <div class="kpi">
      <div class="label">Components</div>
      <div class="value">${data.cost_breakdown.length}</div>
      <div class="sub">in BOM</div>
    </div>
  </div>

  <section class="report-section">
    <h2>Cost Breakdown</h2>
    ${costBarsHtml(data.cost_breakdown)}
    <table>
      <thead><tr>${["#", "Component", "Unit Cost", "Qty", "Line Cost", "Share"].map(th).join("")}</tr></thead>
      <tbody>${costRows}</tbody>
    </table>
  </section>

  <section class="report-section">
    <h2>Compliance — ${data.market} Market</h2>
    <table>
      <thead><tr>${["Component", "Status", "Violations"].map(th).join("")}</tr></thead>
      <tbody>${complianceRows}</tbody>
    </table>
    ${violationDetails ? `<div style="margin-top:24px">${violationDetails}</div>` : ""}
  </section>

  <section class="report-section">
    <h2>Market Price Comparison (Mouser Electronics)</h2>
    <table>
      <thead><tr>${["Component", "BOM Price", "Mouser Price", "Saving", "Recommendation"].map(th).join("")}</tr></thead>
      <tbody>${mouserRows}</tbody>
    </table>
  </section>

  <section class="report-section">
    <h2>3-Month Price Trends</h2>
    <table>
      <thead><tr>${["Component", "Trend", "3 Months Ago", "Today", "Change", "Direction"].map(th).join("")}</tr></thead>
      <tbody>${trendRows}</tbody>
    </table>
  </section>

  <section class="report-section">
    <h2>Key Recommendations</h2>
    <ul class="recommendations">
      ${data.recommendations.map((r) => `<li>${r}</li>`).join("\n")}
    </ul>
    ${
      data.total_potential_saving_eur > 0
        ? `<div class="saving-box">💡 Total potential saving identified: €${data.total_potential_saving_eur.toFixed(2)} per unit across Mouser price comparisons.</div>`
        : ""
    }
  </section>`;

  return renderBrandedReport({
    documentTitle: `Sourcing Report — ${data.product.name}`,
    headerTitle: data.product.name,
    headerMeta: `Sourcing Report &nbsp;·&nbsp; <span class="accent">${data.market} Market</span> &nbsp;·&nbsp; Generated ${date}`,
    body,
    bodyCss: SOURCING_BODY_CSS,
    footerNote: `Component Sourcing Compass · Atlas Copco Hackathon PoC · Generated ${date}. Print this page from your browser to save as PDF.`,
  });
}

// ─── File path helper ─────────────────────────────────────────────────────────

export function reportFilePath(product_id: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const filename = `sourcing-report-${product_id}-${date}.html`;
  return join(homedir(), "Desktop", filename);
}
