import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Component } from "./bom.js";

const RULES_PATH = join(process.cwd(), "data", "compliance-rules.seed.json");
const SVHC_PATH = join(process.cwd(), "data", "svhc-cache.json");
const PROP65_PATH = join(process.cwd(), "data", "prop65-cache.json");

export type Market = "EU" | "US";
export type Severity = "blocking" | "warning";

type MaxThresholdCheck = {
  type: "max_threshold";
  spec_field: string;
  threshold: number;
  unit?: string;
};
type RequiredDeclarationCheck = { type: "required_declaration"; spec_field: string };
type SubstanceListMatchCheck = {
  type: "substance_list_match";
  spec_field: string;
  list_name: "svhc" | "prop65";
};
// Legacy alias kept for backwards compatibility with older rule fixtures.
type SvhcSubstanceMatchCheck = { type: "svhc_substance_match"; spec_field: string };
type Check =
  | MaxThresholdCheck
  | RequiredDeclarationCheck
  | SubstanceListMatchCheck
  | SvhcSubstanceMatchCheck;

export type Rule = {
  id: string;
  market: Market;
  regulation: string;
  title: string;
  description?: string;
  applies_to_categories?: string[];
  severity: Severity;
  check: Check;
};

export type SubstanceEntry = {
  cas: string;
  name: string;
  reason_for_inclusion: string;
  date_added: string;
};

export type SubstanceListCache = {
  source: string;
  regulation: string;
  snapshot_date: string;
  note: string;
  substances: SubstanceEntry[];
};

// Aliases for callers that still refer to the SVHC types.
export type SvhcEntry = SubstanceEntry;
export type SvhcCache = SubstanceListCache;

export type ComplianceContext = {
  rules: Rule[];
  svhc: SubstanceListCache;
  prop65: SubstanceListCache;
};

export type Violation = {
  rule_id: string;
  regulation: string;
  title: string;
  severity: Severity;
  finding: string;
  recommendation: string;
  matched_substances?: SubstanceEntry[];
  source_snapshot_date?: string;
  source_url?: string;
  // legacy field, retained for older consumers
  svhc_source_snapshot?: string;
};

export type ComponentVerdict = {
  component_id: string;
  component_name: string;
  status: "compliant" | "warning" | "non_compliant";
  rules_evaluated: number;
  rules_skipped: number;
  violations: Violation[];
};

let cachedContext: ComplianceContext | null = null;

export async function loadComplianceContext(): Promise<ComplianceContext> {
  if (cachedContext) return cachedContext;
  const [rulesRaw, svhcRaw, prop65Raw] = await Promise.all([
    readFile(RULES_PATH, "utf8"),
    readFile(SVHC_PATH, "utf8"),
    readFile(PROP65_PATH, "utf8"),
  ]);
  cachedContext = {
    rules: (JSON.parse(rulesRaw) as { rules: Rule[] }).rules,
    svhc: JSON.parse(svhcRaw) as SubstanceListCache,
    prop65: JSON.parse(prop65Raw) as SubstanceListCache,
  };
  return cachedContext;
}

export function evaluate(
  component: Component,
  market: Market,
  ctx: ComplianceContext,
): ComponentVerdict {
  const violations: Violation[] = [];
  let evaluated = 0;
  let skipped = 0;

  for (const rule of ctx.rules) {
    if (rule.market !== market) continue;
    if (
      rule.applies_to_categories &&
      !rule.applies_to_categories.includes(component.category ?? "")
    ) {
      skipped++;
      continue;
    }

    const result = checkRule(component, rule, ctx);
    if (!result.applicable) {
      skipped++;
      continue;
    }
    evaluated++;
    if (result.violation) violations.push(result.violation);
  }

  const hasBlocking = violations.some((v) => v.severity === "blocking");
  const hasWarning = violations.some((v) => v.severity === "warning");
  const status = hasBlocking ? "non_compliant" : hasWarning ? "warning" : "compliant";

  return {
    component_id: component.id,
    component_name: component.name,
    status,
    rules_evaluated: evaluated,
    rules_skipped: skipped,
    violations,
  };
}

function listLabel(listName: "svhc" | "prop65"): string {
  return listName === "svhc" ? "SVHC" : "Prop 65";
}

function listRecommendation(listName: "svhc" | "prop65"): string {
  return listName === "svhc"
    ? "REACH Article 33 requires disclosure of these substances to recipients of the article when present above 0.1% (w/w). Update the safety data sheet and customer disclosures."
    : "California Proposition 65 requires a clear and reasonable warning before exposing any person to these substances. Update product warning labels and customer disclosures for the California market.";
}

function checkSubstanceListMatch(
  component: Component,
  rule: Rule,
  spec_field: string,
  list_name: "svhc" | "prop65",
  ctx: ComplianceContext,
): { violation: Violation | null; applicable: boolean } {
  const specs = component.specifications ?? {};
  const value = specs[spec_field];
  if (!Array.isArray(value)) return { violation: null, applicable: false };

  const cache = list_name === "svhc" ? ctx.svhc : ctx.prop65;
  const label = listLabel(list_name);
  const cas_list = value.filter((c): c is string => typeof c === "string");
  const matches = cas_list.flatMap((cas) => {
    const entry = cache.substances.find((s) => s.cas === cas);
    return entry ? [entry] : [];
  });

  if (matches.length === 0) return { violation: null, applicable: true };

  const finding =
    matches.length === 1
      ? `Contains 1 ${label} substance: ${matches[0].name} (CAS ${matches[0].cas}, listed ${matches[0].date_added}). Reason: ${matches[0].reason_for_inclusion}.`
      : `Contains ${matches.length} ${label} substances: ${matches
          .map((m) => `${m.name} (CAS ${m.cas}, listed ${m.date_added})`)
          .join("; ")}.`;

  return {
    applicable: true,
    violation: {
      rule_id: rule.id,
      regulation: rule.regulation,
      title: rule.title,
      severity: rule.severity,
      finding,
      recommendation: listRecommendation(list_name),
      matched_substances: matches,
      source_snapshot_date: cache.snapshot_date,
      source_url: cache.source,
      // legacy field for older callers
      svhc_source_snapshot: list_name === "svhc" ? cache.snapshot_date : undefined,
    },
  };
}

function checkRule(
  component: Component,
  rule: Rule,
  ctx: ComplianceContext,
): { violation: Violation | null; applicable: boolean } {
  const specs = component.specifications ?? {};
  const value = specs[rule.check.spec_field];

  if (rule.check.type === "max_threshold") {
    if (typeof value !== "number") return { violation: null, applicable: false };
    if (value > rule.check.threshold) {
      const factor = (value / rule.check.threshold).toFixed(1);
      const unit = rule.check.unit ?? "";
      return {
        applicable: true,
        violation: {
          rule_id: rule.id,
          regulation: rule.regulation,
          title: rule.title,
          severity: rule.severity,
          finding: `${rule.check.spec_field} = ${value}${unit} exceeds limit of ${rule.check.threshold}${unit} (${factor}× over threshold).`,
          recommendation:
            rule.severity === "blocking"
              ? "Source a compliant alternative or apply for a regulatory exemption before placing on the market."
              : "Review and document the deviation; obtain supplier confirmation.",
        },
      };
    }
    return { violation: null, applicable: true };
  }

  if (rule.check.type === "required_declaration") {
    if (value === true) return { violation: null, applicable: true };
    return {
      applicable: true,
      violation: {
        rule_id: rule.id,
        regulation: rule.regulation,
        title: rule.title,
        severity: rule.severity,
        finding: `Required declaration "${rule.check.spec_field}" is ${
          value === false ? "explicitly false" : "missing"
        }.`,
        recommendation:
          "Obtain the declaration from the supplier and update the component record before market entry.",
      },
    };
  }

  if (rule.check.type === "substance_list_match") {
    return checkSubstanceListMatch(
      component,
      rule,
      rule.check.spec_field,
      rule.check.list_name,
      ctx,
    );
  }

  // legacy svhc_substance_match — treat as substance_list_match against svhc
  return checkSubstanceListMatch(component, rule, rule.check.spec_field, "svhc", ctx);
}
