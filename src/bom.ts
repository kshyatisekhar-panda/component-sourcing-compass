import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BOM_PATH = join(process.cwd(), "data", "bom.seed.json");

export type Component = {
  id: string;
  name: string;
  unit_cost: number;
  currency: string;
  manufacturer?: string;
  manufacturer_part_number?: string;
  category?: string;
  description?: string;
  specifications?: Record<string, unknown>;
  lead_time_days?: number;
  preferred_supplier?: string;
};

export type ProductComponent = {
  component_id: string;
  quantity: number;
};

export type Product = {
  id: string;
  name: string;
  description?: string;
  components: ProductComponent[];
};

export type Bom = {
  components: Component[];
  products: Product[];
};

export async function loadBom(): Promise<Bom> {
  const raw = await readFile(BOM_PATH, "utf8");
  return JSON.parse(raw) as Bom;
}
