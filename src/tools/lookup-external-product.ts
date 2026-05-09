import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cacheExternalProduct, type Component, type Product } from "../bom.js";
import { searchProduct } from "../tavily.js";
import { chat } from "../llm.js";
import { text } from "../tool-response.js";

const MODEL = "anthropic/claude-sonnet-4.5";

const SYSTEM_PROMPT = `You are an industrial sourcing analyst. Given a product query and supporting web search results, generate a PLAUSIBLE bill of materials structure for that product. The user understands this is illustrative and reconstructed from public sources, not authoritative manufacturer data.

Output rules:
- Return ONLY valid JSON matching the schema below. No markdown fences, no preamble, no explanation around the JSON.
- Generate 4 to 7 plausible components based on the product type. For example, an industrial compressor would have a motor, housing, valves, controller, cooling system, etc.
- Component IDs must be uppercase letters, digits, and hyphens, prefixed EXT-COMP-. Product ID prefixed EXT-PROD-.
- Use realistic EUR unit costs for industrial components (typical range 5 to 5000 EUR depending on the part).
- Each component must have a category from: mechanical, electrical, fluidic, electronic.
- Specifications must include lead_content_pct (0 unless the component is brass or solder containing alloy), mercury_content_pct (almost always 0), and cas_numbers (use real CAS numbers for materials present, e.g. 7440-50-8 copper, 7440-66-6 zinc, 7439-92-1 lead, 7429-90-5 aluminium, 7439-89-6 iron).
- Most components should be compliant. You may include one component with elevated lead (lead_content_pct above 0.1, lead in cas_numbers) only if appropriate to the part type, for example a leaded brass valve or a soldered electrical assembly.

Schema:
{
  "product": {
    "id": "EXT-PROD-...",
    "name": "<product name from query>",
    "description": "<one sentence>",
    "components": [
      { "component_id": "EXT-COMP-...", "quantity": <number> }
    ]
  },
  "components": [
    {
      "id": "EXT-COMP-...",
      "name": "...",
      "manufacturer": "...",
      "manufacturer_part_number": "...",
      "category": "mechanical|electrical|fluidic|electronic",
      "specifications": {
        "lead_content_pct": <number>,
        "mercury_content_pct": <number>,
        "cas_numbers": ["..."]
      },
      "unit_cost": <number>,
      "currency": "EUR",
      "lead_time_days": <number>,
      "preferred_supplier": "..."
    }
  ]
}`;

type GeneratedBom = {
  product: Product;
  components: Component[];
};

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return s.slice(firstBrace, lastBrace + 1);
  }
  return s.trim();
}

export function registerLookupExternalProduct(server: McpServer): void {
  server.tool(
    "lookup_external_product",
    "Looks up a product that is NOT in our internal BOM database. Searches the web (Tavily) for the product, then asks an LLM to reconstruct a plausible BOM structure from the public information available. Caches the result in memory so subsequent tool calls (cost_ranked_list, compliance_check, compare_with_mouser, get_price_history if seeded) work on the synthesised product as if it were in the database. Output is clearly tagged as illustrative and reconstructed from public sources, not authoritative manufacturer data. Use this as a fallback when the user asks about a product that list_components reports as unknown. Requires OPENROUTER_API_KEY and TAVILY_API_KEY in the environment.",
    {
      product_query: z
        .string()
        .describe(
          "Product name or short description to look up, e.g. 'Atlas Copco GA110' or 'Atlas Copco ZR 90 oil free compressor'.",
        ),
    },
    async ({ product_query }) => {
      const tavily = await searchProduct(product_query);

      const userPrompt = `Product query: "${product_query}"

Tavily search summary:
${tavily.answer ?? "(no summary available)"}

Top web sources:
${tavily.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}\n   ${s.snippet}`).join("\n\n")}

Generate the BOM JSON now. Remember: ONLY the JSON object, nothing else.`;

      let raw: string;
      try {
        const result = await chat({
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 2500,
        });
        raw = result.content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return text(
          `Failed to call the LLM: ${msg}\n\nMake sure OPENROUTER_API_KEY is set in .env.`,
          { error: true },
        );
      }

      let parsed: GeneratedBom;
      try {
        const json = extractJson(raw);
        parsed = JSON.parse(json) as GeneratedBom;
      } catch (err) {
        return text(
          `Failed to parse the generated BOM as JSON: ${err instanceof Error ? err.message : String(err)}\n\nLLM raw output (first 500 chars):\n${raw.slice(0, 500)}`,
          { error: true },
        );
      }

      if (!parsed.product?.id || !Array.isArray(parsed.components)) {
        return text(
          "Generated output did not match the expected shape. Try a more specific product query.",
          { error: true },
        );
      }

      cacheExternalProduct({ product: parsed.product, components: parsed.components });

      return text({
        product: parsed.product,
        components: parsed.components,
        data_source: "ai_generated_from_web",
        disclaimer:
          "This BOM is reconstructed from public web sources by an AI. It is illustrative, not authoritative manufacturer data. Real product BOMs are commercial confidential. Use only for exploratory analysis.",
        search_query: product_query,
        search_sources: tavily.sources.map((s) => ({ title: s.title, url: s.url })),
        cached: true,
        next_steps:
          "This product is now cached. You can call cost_ranked_list, compliance_check, or compare_with_mouser on it using the product_id or any component_id from this response.",
      });
    },
  );
}
