import { secFetch } from "./sec-client.js";

type Submissions = { sicDescription?: string; sic?: string };

export function parseSubmissionsIndustry(body: Submissions): string | undefined {
  const text = String(body.sicDescription ?? "").trim();
  return text || undefined;
}

export async function fetchUsIndustryProxy(cik: string): Promise<string | undefined> {
  const res = await secFetch(`/submissions/CIK${cik}.json`);
  if (!res.ok) throw new Error(`SEC submissions failed for CIK${cik}: ${res.status}`);
  return parseSubmissionsIndustry((await res.json()) as Submissions);
}
