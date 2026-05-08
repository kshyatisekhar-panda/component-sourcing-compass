import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadBom } from "../bom.js";
import { evaluate, loadComplianceContext, type Market } from "../compliance.js";
import { text } from "../tool-response.js";

export function registerComplianceCheck(server: McpServer): void {
  server.tool(
    "compliance_check",
    "Verifies compliance of a single component or every component in a product against a target market's regulations. EU: RoHS lead/mercury thresholds, plus a live cross-reference of declared CAS numbers against the ECHA REACH SVHC Candidate List (data/svhc-cache.json). US: Dodd-Frank Section 1502 conflict minerals declaration. Returns per-component status with violations cited to the specific regulation, severity (blocking vs warning), matched SVHC substances when applicable, and actionable recommendations. Use this when the user asks whether a product can be sold in a market, whether components contain SVHC substances, or wants to identify regulatory blockers before launch. Provide either component_id OR product_id (not both), plus the target market.",
    {
      component_id: z
        .string()
        .optional()
        .describe("Component ID for a single-component check (e.g. COMP-VALVE-CHECK-12)."),
      product_id: z
        .string()
        .optional()
        .describe(
          "Product ID to evaluate every component in that product (e.g. PROD-AC-COMP-001).",
        ),
      market: z
        .enum(["EU", "US"])
        .describe(
          "Target market: 'EU' applies RoHS and REACH rules; 'US' applies Dodd-Frank 1502.",
        ),
    },
    async ({ component_id, product_id, market }) => {
      if (!component_id && !product_id) {
        return text("Provide either component_id or product_id.", { error: true });
      }
      if (component_id && product_id) {
        return text("Provide either component_id or product_id, not both.", { error: true });
      }

      const [bom, ctx] = await Promise.all([loadBom(), loadComplianceContext()]);

      if (component_id) {
        const component = bom.components.find((c) => c.id === component_id);
        if (!component) {
          const known = bom.components.map((c) => c.id).join(", ");
          return text(`Unknown component "${component_id}". Known: ${known}.`, { error: true });
        }
        const verdict = evaluate(component, market as Market, ctx);
        return text({
          scope: { type: "component", id: component.id, name: component.name },
          market,
          svhc_data: { snapshot_date: ctx.svhc.snapshot_date, source: ctx.svhc.source },
          ...verdict,
        });
      }

      const product = bom.products.find((p) => p.id === product_id);
      if (!product) {
        const known = bom.products.map((p) => p.id).join(", ");
        return text(`Unknown product "${product_id}". Known: ${known}.`, { error: true });
      }

      const verdicts = product.components.flatMap(({ component_id }) => {
        const c = bom.components.find((x) => x.id === component_id);
        return c ? [evaluate(c, market as Market, ctx)] : [];
      });

      const blocking = verdicts.filter((v) => v.status === "non_compliant").length;
      const warnings = verdicts.filter((v) => v.status === "warning").length;
      const compliant = verdicts.filter((v) => v.status === "compliant").length;

      const overall_status =
        blocking > 0 ? "non_compliant" : warnings > 0 ? "warning" : "compliant";

      const summary =
        blocking > 0
          ? `${blocking} of ${verdicts.length} component(s) have blocking violations. ${product.name} cannot be placed on the ${market} market as currently sourced.`
          : warnings > 0
            ? `${warnings} of ${verdicts.length} component(s) have warnings. ${product.name} is saleable in ${market} but has documentation gaps to close.`
            : `All ${verdicts.length} components compliant. ${product.name} is cleared for the ${market} market.`;

      return text({
        scope: { type: "product", id: product.id, name: product.name },
        market,
        svhc_data: { snapshot_date: ctx.svhc.snapshot_date, source: ctx.svhc.source },
        overall_status,
        summary,
        breakdown: {
          compliant,
          warnings,
          non_compliant: blocking,
          total: verdicts.length,
        },
        components: verdicts,
      });
    },
  );
}
