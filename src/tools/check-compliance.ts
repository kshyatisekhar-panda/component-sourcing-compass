import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBom } from "../bom.js";
import { text } from "../tool-response.js";

const COMPLIANCE_PATH = join(process.cwd(), "data", "compliance.seed.json");

type RegulationStatus = "compliant" | "flag" | "unverified" | "low_risk" | "review_required";

type ComplianceRecord = {
  overall_status: RegulationStatus;
  rohs: { status: RegulationStatus; note: string; action_required?: string };
  reach: { status: RegulationStatus; svhc_substances: string[]; note: string };
  conflict_minerals: { status: RegulationStatus; note: string };
};

type ComplianceData = Record<string, ComplianceRecord>;

async function loadCompliance(): Promise<ComplianceData> {
  const raw = await readFile(COMPLIANCE_PATH, "utf8");
  return JSON.parse(raw) as ComplianceData;
}

export function registerCheckCompliance(server: McpServer): void {
  server.tool(
    "check_compliance",
    "Checks a component against RoHS 2, REACH SVHC, and conflict minerals regulations. Returns compliance status, any flags, and required actions. Use this when the user asks whether a component is compliant, what regulatory risks exist, or before approving a supplier switch. Follow up with find_compliant_alternatives if the status is 'flag' or 'unverified'.",
    { component_id: z.string().describe("Component ID to check (e.g. COMP-VALVE-CHECK-12)") },
    async ({ component_id }) => {
      const [bom, compliance] = await Promise.all([loadBom(), loadCompliance()]);

      const component = bom.components.find((c) => c.id === component_id);
      if (!component) {
        const known = bom.components.map((c) => c.id).join(", ");
        return text(`Unknown component "${component_id}". Known: ${known}.`, { error: true });
      }

      const record = compliance[component_id];
      if (!record) {
        return text(`No compliance data available for "${component_id}".`, { error: true });
      }

      const flagCount = [record.rohs.status, record.reach.status, record.conflict_minerals.status].filter(
        (s) => s === "flag" || s === "unverified" || s === "review_required",
      ).length;

      return text({
        component: { id: component.id, name: component.name, manufacturer: component.manufacturer },
        overall_status: record.overall_status,
        flags_count: flagCount,
        regulations: {
          rohs: record.rohs,
          reach: record.reach,
          conflict_minerals: record.conflict_minerals,
        },
        next_step:
          flagCount > 0
            ? `${flagCount} issue(s) require attention. Call find_compliant_alternatives to surface replacement options.`
            : "No compliance issues identified.",
      });
    },
  );
}
