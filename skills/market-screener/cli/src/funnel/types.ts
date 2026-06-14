export type Market = "CN" | "US";
export type DataConfidence = "high" | "medium" | "low";

export interface MetricValue {
  value?: number;
  period?: string;
  currency?: string;
  source?: string;
  basis?: string;
  dataConfidence: DataConfidence;
}

export interface ThresholdRule {
  min?: number;
  max?: number;
  default?: number;
  market_overrides?: Partial<Record<Market, number>>;
  market_missing_overrides?: Partial<Record<Market, "skip">>;
  missing?: "skip" | "data_confidence_low";
  field?: string;
}

export interface ThresholdResult {
  passed: boolean;
  skipped: boolean;
  dataConfidence: DataConfidence;
}
