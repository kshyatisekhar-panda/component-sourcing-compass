import { MOUSER_API_KEY, MOUSER_BASE_URL } from "./config.js";

export type MouserResult =
  | {
      found: true;
      mouserPartNumber: string;
      manufacturerPartNumber: string;
      manufacturer: string;
      description: string;
      availabilityInStock: number;
      unitPriceUsd: number;
      leadTimeDays: number | null;
      rohsStatus: string;
      source: "live" | "mock";
    }
  | { found: false; source: "mock" };

// Realistic mock data for the fictitious Atlas Copco parts.
// Returned whenever the live Mouser API finds no results (expected for fictional MPNs).
// Prices are intentionally slightly different from BOM to drive demo narrative:
//   - Housing: Mouser $46.30 → €42.87 (slight premium vs BOM €42.50, stay with current supplier)
//   - Motor:   Mouser $196.00 → €181.48 (3% cheaper than BOM €187.00 → switch recommended)
//   - Valve:   Mouser $8.75  → €8.10  (1.8% cheaper than BOM €8.25 → switch recommended)
const MOCK_PARTS: Record<string, Extract<MouserResult, { found: true }>> = {
  "MW-AH-200": {
    found: true,
    mouserPartNumber: "992-MW-AH200",
    manufacturerPartNumber: "MW-AH-200",
    manufacturer: "MetalWorks GmbH",
    description: "Cast aluminium pressure housing 200 mm dia., rated 10 bar",
    availabilityInStock: 47,
    unitPriceUsd: 46.3,
    leadTimeDays: 14,
    rohsStatus: "RoHS Compliant",
    source: "mock",
  },
  "ED-M3K-400V": {
    found: true,
    mouserPartNumber: "992-EDM3K-400V",
    manufacturerPartNumber: "ED-M3K-400V",
    manufacturer: "ElectroDrive AB",
    description: "3 kW three-phase induction motor, 400 V, IE3 efficiency class",
    availabilityInStock: 12,
    unitPriceUsd: 196.0,
    leadTimeDays: 21,
    rohsStatus: "RoHS Compliant",
    source: "mock",
  },
  "FC-CV-12B": {
    found: true,
    mouserPartNumber: "992-FCCV12B",
    manufacturerPartNumber: "FC-CV-12B",
    manufacturer: "FluidCorp",
    description: "12 mm brass check valve, one-way, max 16 bar",
    availabilityInStock: 523,
    unitPriceUsd: 8.75,
    leadTimeDays: 7,
    rohsStatus: "RoHS Compliant",
    source: "mock",
  },
};

interface MouserApiResponse {
  Errors: Array<{ Message: string }>;
  SearchResults: {
    NumberOfResult: number;
    Parts: Array<{
      MouserPartNumber: string;
      ManufacturerPartNumber: string;
      Manufacturer: { ManufacturerName: string };
      Description: string;
      AvailabilityInStock: string;
      PriceBreaks: Array<{ Quantity: number; Price: string; Currency: string }>;
      LeadTime: string;
      ROHSStatus: string;
    }>;
  };
}

export async function searchByMfrPartNumber(mfrPartNumber: string): Promise<MouserResult> {
  try {
    const res = await fetch(
      `${MOUSER_BASE_URL}/search/manufacturerpartnumber?apiKey=${MOUSER_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ SearchByMfrPartNumberRequest: { mfrPartNumber } }),
      },
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = (await res.json()) as MouserApiResponse;
    if (data.Errors?.length > 0) throw new Error(data.Errors[0].Message);

    const parts = data.SearchResults?.Parts ?? [];
    if (parts.length === 0) return MOCK_PARTS[mfrPartNumber] ?? { found: false, source: "mock" };

    const part = parts[0];
    const priceBreak = part.PriceBreaks?.[0];

    return {
      found: true,
      mouserPartNumber: part.MouserPartNumber,
      manufacturerPartNumber: part.ManufacturerPartNumber,
      manufacturer: part.Manufacturer?.ManufacturerName ?? "",
      description: part.Description,
      availabilityInStock: parseInt(part.AvailabilityInStock?.replace(/\D/g, "") ?? "0", 10),
      unitPriceUsd: parseFloat(priceBreak?.Price ?? "0"),
      leadTimeDays: part.LeadTime ? parseInt(part.LeadTime, 10) : null,
      rohsStatus: part.ROHSStatus,
      source: "live",
    };
  } catch {
    return MOCK_PARTS[mfrPartNumber] ?? { found: false, source: "mock" };
  }
}
