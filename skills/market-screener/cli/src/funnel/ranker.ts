export interface RankableCandidate {
  ticker: string;
  compositeScore: number;
  dataConfidence: "high" | "medium" | "low";
  supportingPassCount: number;
}

export function rankCandidates(candidates: RankableCandidate[]): RankableCandidate[] {
  const order = { high: 3, medium: 2, low: 1 };
  return [...candidates].sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    if (order[b.dataConfidence] !== order[a.dataConfidence]) {
      return order[b.dataConfidence] - order[a.dataConfidence];
    }
    return b.supportingPassCount - a.supportingPassCount;
  });
}

export function splitBySoftCap<T>(ranked: T[], softCap = 25): { primary: T[]; deferred: T[] } {
  return {
    primary: ranked.slice(0, softCap),
    deferred: ranked.slice(softCap),
  };
}
