import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Component } from "./bom.js";

const RULES_PATH = join(process.cwd(), "data", "compliance-rules.seed.json");

export type Market = "EU" | "US";
export type Severity = "blocking" | "warning";

type MaxThresholdCheck = {
  type: "max_threshold";
  spec_field: string;
  threshold: number;
  unit?: string;
};
type RequiredDeclarationCheck = { type: "required_declaration"; spec_field: string };
type Check = MaxThresholdCheck | RequiredDeclarationCheck;

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

export type Violation = {
  rule_id: string;
  regulation: string;
  title: string;
  severity: Severity;
  finding: string;
  recommendation: string;
};

export type ComponentVerdict = {
  component_id: string;
  component_name: string;
  status: "compliant" | "warning" | "non_compliant";
  rules_evaluated: number;
  rules_skipped: number;
  violations: Violation[];
};

export async function loadRules(): Promise<Rule[]> {
  const raw = await readFile(RULES_PATH, "utf8");
  return (JSON.parse(raw) as { rules: Rule[] }).rules;
}

export function evaluate(component: Component, market: Market, rules: Rule[]): ComponentVerdict {
  const violations: Violation[] = [];
  let evaluated = 0;
  let skipped = 0;

  for (const rule of rules) {
    if (rule.market !== market) continue;
    if (
      rule.applies_to_categories &&
      !rule.applies_to_categories.includes(component.category ?? "")
    ) {
      skipped++;
      continue;
    }

    const result = checkRule(component, rule);
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

  // required_declaration
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
