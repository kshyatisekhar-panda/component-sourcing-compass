import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBom } from "../bom.js";
import { text } from "../tool-response.js";

const TARIC_PATH = join(process.cwd(), "data", "taric.seed.json");

type AntiDumping = {
  active: boolean;
  affected_origins: string[];
  duty_rate_pct: number;
  regulation: string;
  note: string;
};

type TaricRecord = {
  commodity_code: string;
  cn_code: string;
  description: string;
  standard_import_duty_pct: number;
  anti_dumping: AntiDumping | null;
  origin_notes: string;
};

type TaricData = Record<string, TaricRecord>;

async function loadTaric(): Promise<TaricData> {
  const raw = await readFile(TARIC_PATH, "utf8");
  return JSON.parse(raw) as TaricData;
}

export function registerTaricLookup(server: McpServer): void {
  server.tool(
    "taric_lookup",
    "Returns the EU TARIC commodity code, standard import duty, and any active anti-dumping measures for a component. If origin_country is provided, calculates the effective landed cost including all applicable duties. Use this after compare_with_mouser to check whether a cheaper Mouser price still holds up once import duties are applied — especially important for components with active anti-dumping measures.",
    {
      component_id: z.string().describe("Component ID to look up (e.g. COMP-MOTOR-3KW)"),
      origin_country: z
        .string()
        .length(2)
        .toUpperCase()
        .optional()
        .describe(
          "Optional ISO 3166-1 alpha-2 country code of the supplier's manufacturing origin (e.g. 'CN' for China, 'SE' for Sweden). When provided, calculates effective duty rate and landed cost.",
        ),
    },
    async ({ component_id, origin_country }) => {
      const [bom, taric] = await Promise.all([loadBom(), loadTaric()]);

      const component = bom.components.find((c) => c.id === component_id);
      if (!component) {
        const known = bom.components.map((c) => c.id).join(", ");
        return text(`Unknown component "${component_id}". Known: ${known}.`, { error: true });
      }

      const record = taric[component_id];
      if (!record) {
        return text(`No TARIC data available for "${component_id}".`, { error: true });
      }

      const antiDumpingApplies =
        origin_country &&
        record.anti_dumping?.active &&
        record.anti_dumping.affected_origins.includes(origin_country);

      const effectiveDutyPct = antiDumpingApplies
        ? +(record.standard_import_duty_pct + record.anti_dumping!.duty_rate_pct).toFixed(1)
        : record.standard_import_duty_pct;

      const landedCost = origin_country
        ? {
            bom_unit_cost_eur: component.unit_cost,
            effective_duty_pct: effectiveDutyPct,
            duty_cost_eur: +(component.unit_cost * (effectiveDutyPct / 100)).toFixed(2),
            landed_cost_eur: +(component.unit_cost * (1 + effectiveDutyPct / 100)).toFixed(2),
            origin_country,
            anti_dumping_applied: antiDumpingApplies ?? false,
          }
        : null;

      return text({
        component: { id: component.id, name: component.name },
        commodity_code: record.commodity_code,
        cn_code: record.cn_code,
        description: record.description,
        standard_import_duty_pct: record.standard_import_duty_pct,
        anti_dumping: record.anti_dumping,
        origin_notes: record.origin_notes,
        ...(landedCost ? { landed_cost_calculation: landedCost } : {}),
        tip: record.anti_dumping?.active
          ? `Anti-dumping measures active for origins: ${record.anti_dumping.affected_origins.join(", ")}. Always verify supplier's country of manufacturing origin before switching.`
          : "No anti-dumping measures active for this component.",
      });
    },
  );
}
