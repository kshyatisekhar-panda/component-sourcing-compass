import { TAVILY_API_KEY, TAVILY_BASE_URL } from "./config.js";

export type TavilyResult = {
  found: boolean;
  query: string;
  answer: string | null;
  sources: Array<{ title: string; url: string; snippet: string }>;
};

interface TavilyResponse {
  results: Array<{ title: string; url: string; content: string; score: number }>;
  answer?: string;
}

export async function searchComponent(
  componentName: string,
  mfrPartNumber: string,
  manufacturer: string,
): Promise<TavilyResult> {
  const query = `${mfrPartNumber} ${manufacturer} ${componentName} price distributor`;

  try {
    const res = await fetch(`${TAVILY_BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);

    const data = (await res.json()) as TavilyResponse;

    return {
      found: data.results.length > 0,
      query,
      answer: data.answer ?? null,
      sources: data.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content.slice(0, 400),
      })),
    };
  } catch {
    return { found: false, query, answer: null, sources: [] };
  }
}

export async function searchProduct(productQuery: string): Promise<TavilyResult> {
  const query = `${productQuery} industrial product specifications components datasheet`;

  try {
    const res = await fetch(`${TAVILY_BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 6,
        include_answer: true,
      }),
    });

    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);

    const data = (await res.json()) as TavilyResponse;

    return {
      found: data.results.length > 0,
      query,
      answer: data.answer ?? null,
      sources: data.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content.slice(0, 600),
      })),
    };
  } catch {
    return { found: false, query, answer: null, sources: [] };
  }
}
