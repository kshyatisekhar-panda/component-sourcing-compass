import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Component } from "./bom.js";

const RULES_PATH = join(process.cwd(), "data", "compliance-rules.seed.json");
const SVHC_PATH = join(process.cwd(), "data", "svhc-cache.json");

export type Market = "EU" | "US";
export type Severity = "blocking" | "warning";

type MaxThresholdCheck = {
  type: "max_threshold";
  spec_field: string;
  threshold: number;
  unit?: string;
};
type RequiredDeclarationCheck = { type: "required_declaration"; spec_field: string };
type SvhcSubstanceMatchCheck = { type: "svhc_substance_match"; spec_field: string };
type Check = MaxThresholdCheck | RequiredDeclarationCheck | SvhcSubstanceMatchCheck;

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

export type SvhcEntry = {
  cas: string;
  name: string;
  reason_for_inclusion: string;
  date_added: string;
};

export type SvhcCache = {
  source: string;
  regulation: string;
  snapshot_date: string;
  note: string;
  substances: SvhcEntry[];
};

export type ComplianceContext = {
  rules: Rule[];
  svhc: SvhcCache;
};

export type Violation = {
  rule_id: string;
  regulation: string;
  title: string;
  severity: Severity;
  finding: string;
  recommendation: string;
  matched_substances?: SvhcEntry[];
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

export async function loadComplianceContext(): Promise<ComplianceContext> {
  const [rulesRaw, svhcRaw] = await Promise.all([
    readFile(RULES_PATH, "utf8"),
    readFile(SVHC_PATH, "utf8"),
  ]);
  return {
    rules: (JSON.parse(rulesRaw) as { rules: Rule[] }).rules,
    svhc: JSON.parse(svhcRaw) as SvhcCache,
  };
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

  // svhc_substance_match
  if (!Array.isArray(value)) return { violation: null, applicable: false };
  const cas_list = value.filter((c): c is string => typeof c === "string");
  const matches = cas_list.flatMap((cas) => {
    const entry = ctx.svhc.substances.find((s) => s.cas === cas);
    return entry ? [entry] : [];
  });

  if (matches.length === 0) return { violation: null, applicable: true };

  const finding =
    matches.length === 1
      ? `Contains 1 SVHC substance: ${matches[0].name} (CAS ${matches[0].cas}, listed ${matches[0].date_added}). Reason: ${matches[0].reason_for_inclusion}.`
      : `Contains ${matches.length} SVHC substances: ${matches
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
      recommendation:
        "REACH Article 33 requires disclosure of these substances to recipients of the article when present above 0.1% (w/w). Update the safety data sheet and customer disclosures.",
      matched_substances: matches,
      svhc_source_snapshot: ctx.svhc.snapshot_date,
    },
  };
}
