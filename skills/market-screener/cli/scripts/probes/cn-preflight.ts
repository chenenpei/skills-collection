#!/usr/bin/env tsx
import { probeCnDatacenter } from "../../src/data/cn/eastmoney.js";
import { probeCnQuotes } from "../../src/data/cn/quotes.js";

async function main(): Promise<void> {
  await probeCnDatacenter();
  console.log("OK CN datacenter: 600519 annual rows");
  await probeCnQuotes();
  console.log("OK CN quote anchors: 603195/600519/600919");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
