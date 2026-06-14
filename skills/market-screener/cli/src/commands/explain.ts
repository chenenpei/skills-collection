import fs from "node:fs/promises";
import path from "node:path";
import {
  bestPassingCandidate,
  listTemplateTrackResults,
  routeSecurityRecord,
} from "../funnel/run.js";
import { applyKillGates, type SecurityRecord } from "../funnel/kill-gates.js";
import type { Market } from "../funnel/types.js";
import { loadSpecBundle } from "../spec/loader.js";

export interface ExplainCommandOptions {
  ticker: string;
  market: Market;
  fixture: string;
  spec: string;
}

async function loadSecurityRecordFromFixture(
  fixturePath: string,
  ticker: string,
  market: Market
): Promise<SecurityRecord> {
  const raw = JSON.parse(await fs.readFile(path.resolve(fixturePath), "utf8")) as
    | SecurityRecord
    | SecurityRecord[];

  const record = Array.isArray(raw)
    ? raw.find((r) => r.ticker === ticker && r.market === market) ??
      raw.find((r) => r.ticker === ticker)
    : raw;

  if (!record) {
    throw new Error(`No security record found for ticker ${ticker} in ${fixturePath}`);
  }
  if (record.market !== market) {
    throw new Error(
      `Record market ${record.market} does not match --market ${market} for ticker ${ticker}`
    );
  }

  return { ...record, ticker };
}

export async function explainCommand(opts: ExplainCommandOptions): Promise<void> {
  const bundle = await loadSpecBundle(path.resolve(opts.spec));
  const record = await loadSecurityRecordFromFixture(opts.fixture, opts.ticker, opts.market);

  const kill = applyKillGates(bundle.killGates, record);
  const route = routeSecurityRecord(bundle, record);
  const trackResults = listTemplateTrackResults(bundle, record, route);

  console.log(
    JSON.stringify(
      {
        ticker: record.ticker,
        market: record.market,
        companyName: record.companyName,
        kill,
        route,
        bestCandidate: bestPassingCandidate(bundle, record, kill, route),
        trackResults,
      },
      null,
      2
    )
  );
}
