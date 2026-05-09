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

let baseBomCache: Bom | null = null;

async function getBaseBom(): Promise<Bom> {
  if (baseBomCache) return baseBomCache;
  const raw = await readFile(BOM_PATH, "utf8");
  baseBomCache = JSON.parse(raw) as Bom;
  return baseBomCache;
}

const externalProducts = new Map<string, { product: Product; components: Component[] }>();

export function cacheExternalProduct(entry: { product: Product; components: Component[] }): void {
  externalProducts.set(entry.product.id, entry);
}

export function getExternalProduct(
  id: string,
): { product: Product; components: Component[] } | undefined {
  return externalProducts.get(id);
}

export async function loadBom(): Promise<Bom> {
  const base = await getBaseBom();
  if (externalProducts.size === 0) return base;

  const extraComponents = [...externalProducts.values()].flatMap((e) => e.components);
  const extraProducts = [...externalProducts.values()].map((e) => e.product);
  return {
    components: [...base.components, ...extraComponents],
    products: [...base.products, ...extraProducts],
  };
}
