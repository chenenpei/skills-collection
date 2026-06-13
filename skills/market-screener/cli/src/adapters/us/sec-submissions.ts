import { httpFetch } from "../../lib/http-fetch.js";
import { SEC_UA } from "./sec-tickers.js";

type Submissions = { sicDescription?: string; sic?: string };

export function parseSubmissionsIndustry(body: Submissions): string | undefined {
  const text = String(body.sicDescription ?? "").trim();
  return text || undefined;
}

export async function fetchUsIndustryProxy(cik: string): Promise<string | undefined> {
  const res = await httpFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": SEC_UA },
  });
  if (!res.ok) throw new Error(`SEC submissions failed for CIK${cik}: ${res.status}`);
  return parseSubmissionsIndustry((await res.json()) as Submissions);
}
