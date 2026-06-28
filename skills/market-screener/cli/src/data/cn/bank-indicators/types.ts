export type BankScrapeField =
  | "npl_ratio"
  | "provision_coverage"
  | "capital_adequacy"
  | "nim"
  | "roa";

export type BankScrapeMetrics = Partial<Record<BankScrapeField, number>>;

export type BankBulletinSourceTier = "cninfo" | "sse" | "szse" | "sina_ndbg";

export type BankBulletinEntry = {
  ticker: string;
  fiscalYear: number;
  name: string;
  sinaUrl?: string;
  pdfUrl: string;
  pdfTier: "cninfo_pdf" | "szse_disclosure_pdf" | "sse_mirror_pdf";
  sourceTier: BankBulletinSourceTier;
};

export type BankScrapeResult = {
  ticker: string;
  fiscalYear: number;
  metrics: BankScrapeMetrics;
  rawHits: Partial<Record<BankScrapeField, string>>;
  missing: BankScrapeField[];
  sourceUrls: string[];
  dataConfidence: "medium" | "low";
  scrapedAt: string;
  bulletinTitle?: string;
};
