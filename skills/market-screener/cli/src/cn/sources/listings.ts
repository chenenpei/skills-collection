/**
 * CN 上市名册：只接受交易所当期列表作为范围观察。
 * 报价、搜索目录和历史快照都不能替代证券在截点的上市资格。
 */
import { z } from "zod";
import { type CompanyFacts, type SecurityIdentity } from "../../shared/financial-model.js";
import calendarData from "./exchange-calendar.json" with { type: "json" };

const boards = ["SSE_MAIN", "SSE_STAR", "SZSE", "BSE"] as const;
type Board = (typeof boards)[number];
type ListingSource = {
  id: string;
  mapping: "sse-list" | "szse-list" | "bse-list";
  url: string;
  fetchedAt: string;
  request?: { method: "POST"; body: string; contentType: "application/x-www-form-urlencoded" };
};
type ListedCompany = Pick<CompanyFacts, "ticker" | "companyName"> & { identity: SecurityIdentity };
export interface ListingPage {
  board: Board;
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  observedAt: string;
  reportDate?: string;
  identities: ListedCompany[];
}
export interface CnUniverse {
  status: "complete" | "partial";
  asOf: string;
  coverage: Array<{
    board: Board;
    state: "complete" | "partial" | "missing";
    expected?: number;
    received: number;
    reason?: string;
    snapshotDate?: string;
    expectedDate?: string;
    calendarSource?: string;
  }>;
}
const count = z.number().int().nonnegative(),
  positive = z.number().int().positive();
const code = z.string().regex(/^\d{6}$/),
  label = z.string().min(1);
const sseSchema = z.object({
  result: z.array(
    z.object({
      A_STOCK_CODE: code,
      SEC_NAME_CN: label,
      STOCK_TYPE: z.enum(["1", "8"]),
      LIST_DATE: label,
      DELIST_DATE: z.string(),
      CSRC_CODE: z.string(),
      CSRC_CODE_DESC: z.string(),
    }),
  ),
  pageHelp: z.object({ pageNo: positive, pageSize: positive, pageCount: positive, total: count }),
});
const szseSchema = z.array(
  z.object({
    metadata: z.object({
      catalogid: label,
      name: label,
      tabkey: label,
      subname: z.string(),
      pageno: positive,
      pagesize: positive,
      pagecount: count,
      recordcount: count,
    }),
    data: z.array(z.unknown()),
  }),
);
const szseRow = z.object({ agdm: code, agjc: label, agssrq: label, bk: label, sshymc: z.string() });
const bseSchema = z
  .array(
    z.object({
      content: z.array(
        z.object({
          xxzqdm: code,
          xxzqjc: label,
          xxzqjb: z.literal("T"),
          xxfcbj: z.literal("2"),
          fxssrq: label,
          xxjsrq: label,
          xxhyzl: z.string(),
        }),
      ),
      number: count,
      numberOfElements: count,
      size: positive,
      totalElements: count,
      totalPages: positive,
      firstPage: z.boolean(),
      lastPage: z.boolean(),
    }),
  )
  .length(1);
const chinaDate = (timestamp: string) =>
  new Date(Date.parse(timestamp) + 8 * 3600_000).toISOString().slice(0, 10);
// Validate maintained data once, so a malformed new year cannot silently imply an open market.
const exchangeCalendars = z.record(
  z.string().regex(/^\d{4}$/),
  z.object({
    publishedAt: z.string().date(),
    sources: z.object({ SSE: z.string().url(), SZSE: z.string().url(), BSE: z.string().url() }),
    closed: z.array(z.tuple([z.string().date(), z.string().date()])),
  }),
).refine(
  (calendars) => Object.entries(calendars).every(([year, calendar]) =>
    calendar.closed.every(([start, end]) => start.startsWith(`${year}-`) && end.startsWith(`${year}-`) && start <= end),
  ),
  "Exchange closure ranges must be ordered dates within their calendar year",
).parse(calendarData);
// Identity lists should include today's listings on a trading day, even before close.
// Only a verified exchange holiday/weekend can justify the previous session's list.
function expectedListingDate(
  observedDate: string,
  board: Board,
): { date: string; source: string } | undefined {
  const exchange = board === "SSE_MAIN" || board === "SSE_STAR" ? "SSE" : board;
  let date = observedDate;
  for (let days = 0; days < 32; days++) {
    const calendar = exchangeCalendars[date.slice(0, 4)];
    if (!calendar || calendar.publishedAt > observedDate) return undefined;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (
      weekday !== 0 &&
      weekday !== 6 &&
      !calendar.closed.some(([start, end]) => start <= date && date <= end)
    )
      return { date, source: calendar.sources[exchange] };
    date = new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
  }
  return undefined;
}
function listingDate(value: string): string {
  const iso = /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    throw new Error("Invalid listing date");
  return iso;
}
function unfiltered(url: URL, allowed: string[]): void {
  for (const [key, value] of url.searchParams)
    if (value !== "" && !allowed.includes(key))
      throw new Error(`Unfiltered listing query required: ${key}`);
  for (const key of url.searchParams.keys())
    if (url.searchParams.getAll(key).length !== 1)
      throw new Error("Duplicate listing query parameter");
}
/** The BSE endpoint returns a fixed null(JSON) wrapper when no callback is requested. Never execute it. */
export function decodeCnListingDocument(text: string, mapping?: string): unknown {
  if (mapping !== "bse-list") return JSON.parse(text);
  const match = text.trim().match(/^null\(([\s\S]*)\)$/);
  if (!match) throw new Error("Unsupported BSE listing response wrapper");
  return JSON.parse(match[1]);
}
/** Only current exchange listing contracts count as universe evidence; neither quote rows nor an issuer search directory do. */
// 三个交易所协议各异，但都要证明页码、总数和观察日期彼此一致。
export function parseCnListingPage(raw: unknown, source: ListingSource): ListingPage {
  if (!Number.isFinite(Date.parse(source.fetchedAt)))
    throw new Error("Invalid listing observation time");
  const url = new URL(source.url),
    observedDate = chinaDate(source.fetchedAt);
  let result: ListingPage;
  if (source.mapping === "sse-list") {
    if (
      url.protocol !== "https:" ||
      url.hostname !== "query.sse.com.cn" ||
      url.pathname !== "/sseQuery/commonQuery.do" ||
      url.searchParams.get("sqlId") !== "COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L" ||
      url.searchParams.get("COMPANY_STATUS") !== "2,4,5,7,8"
    )
      throw new Error("Unsupported SSE current listing contract");
    unfiltered(url, [
      "sqlId",
      "STOCK_TYPE",
      "COMPANY_STATUS",
      "type",
      "isPagination",
      "pageHelp.cacheSize",
      "pageHelp.beginPage",
      "pageHelp.endPage",
      "pageHelp.pageSize",
      "pageHelp.pageNo",
    ]);
    const stockType = url.searchParams.get("STOCK_TYPE");
    if (stockType !== "1" && stockType !== "8") throw new Error("Unsupported SSE board");
    const body = sseSchema.parse(raw),
      p = body.pageHelp;
    if (Number(url.searchParams.get("pageHelp.pageNo") ?? "1") !== p.pageNo)
      throw new Error("Listing page number mismatch");
    result = {
      board: stockType === "1" ? "SSE_MAIN" : "SSE_STAR",
      page: p.pageNo,
      pageSize: p.pageSize,
      pageCount: p.pageCount,
      total: p.total,
      observedAt: source.fetchedAt,
      identities: body.result.map((row, i) => {
        if (row.STOCK_TYPE !== stockType) throw new Error("SSE row board mismatch");
        if (row.DELIST_DATE !== "-") throw new Error("Current listing row has a delisting date");
        const listedAt = listingDate(row.LIST_DATE);
        return {
          ticker: row.A_STOCK_CODE,
          companyName: row.SEC_NAME_CN,
          identity: {
            exchange: "SSE",
            board: stockType === "1" ? "主板" : "科创板",
            listedAt,
            state: listedAt <= observedDate ? "listed" : "not_yet_listed",
            industryLabels: [`${row.CSRC_CODE} ${row.CSRC_CODE_DESC}`.trim()].filter(Boolean),
            sourceId: source.id,
            locator: `/result/${i}`,
            observedAt: source.fetchedAt,
          },
        };
      }),
    };
  } else if (source.mapping === "bse-list") {
    if (
      url.href !== "https://www.bse.cn/nqxxController/nqxxCnzq.do" ||
      source.request?.method !== "POST" ||
      source.request.contentType !== "application/x-www-form-urlencoded"
    )
      throw new Error("Unsupported BSE current listing contract");
    const query = new URLSearchParams(source.request.body);
    unfiltered(new URL("https://www.bse.cn/?" + query), [
      "page",
      "typejb",
      "xxfcbj[]",
      "sortfield",
      "sorttype",
    ]);
    if (
      query.get("typejb") !== "T" ||
      query.get("xxfcbj[]") !== "2" ||
      query.get("sortfield") !== "xxzqdm" ||
      query.get("sorttype") !== "asc" ||
      !/^\d+$/.test(query.get("page") ?? "")
    )
      throw new Error("Unsupported BSE current listing parameters");
    const p = bseSchema.parse(raw)[0];
    if (Number(query.get("page")) !== p.number) throw new Error("Listing page number mismatch");
    if (
      p.numberOfElements !== p.content.length ||
      p.firstPage !== (p.number === 0) ||
      p.lastPage !== (p.number === p.totalPages - 1)
    )
      throw new Error("Inconsistent BSE pagination flags");
    const reportDates = [...new Set(p.content.map((row) => listingDate(row.xxjsrq)))];
    if (reportDates.length > 1 || reportDates.some(date => date > observedDate))
      throw new Error("BSE listing snapshot dates are mixed or future dated");
    result = {
      board: "BSE",
      page: p.number + 1,
      pageSize: p.size,
      pageCount: p.totalPages,
      total: p.totalElements,
      observedAt: source.fetchedAt,
      reportDate: reportDates[0],
      identities: p.content.map((row, i) => {
        const listedAt = listingDate(row.fxssrq);
        return {
          ticker: row.xxzqdm,
          companyName: row.xxzqjc,
          identity: {
            exchange: "BSE",
            board: "北交所",
            listedAt,
            listedAtBasis: "exchange_listing_or_selected_tier",
            state: listedAt <= observedDate ? "listed" : "not_yet_listed",
            industryLabels: [row.xxhyzl].filter(Boolean),
            sourceId: source.id,
            locator: `/0/content/${i}`,
            observedAt: source.fetchedAt,
          },
        };
      }),
    };
  } else {
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.szse.cn" ||
      url.pathname !== "/api/report/ShowReport/data" ||
      url.searchParams.get("CATALOGID") !== "1110" ||
      url.searchParams.get("SHOWTYPE") !== "JSON" ||
      ![null, "tab1"].includes(url.searchParams.get("TABKEY"))
    )
      throw new Error("Unsupported SZSE A-share listing contract");
    unfiltered(url, ["SHOWTYPE", "CATALOGID", "TABKEY", "PAGENO", "tab1PAGESIZE"]);
    const body = szseSchema.parse(raw),
      tabs = body
        .map((tab, index) => ({ tab, index }))
        .filter((x) => x.tab.metadata.tabkey === "tab1");
    if (
      tabs.length !== 1 ||
      tabs[0].tab.metadata.catalogid !== "1110" ||
      tabs[0].tab.metadata.name !== "A股列表"
    )
      throw new Error("Missing unambiguous SZSE A-share tab");
    const { tab, index } = tabs[0],
      m = tab.metadata,
      reportDate = listingDate(m.subname.trim());
    if (reportDate > observedDate)
      throw new Error("SZSE listing snapshot date is in the future");
    if (Number(url.searchParams.get("PAGENO") ?? "1") !== m.pageno)
      throw new Error("Listing page number mismatch");
    result = {
      board: "SZSE",
      page: m.pageno,
      pageSize: m.pagesize,
      pageCount: m.pagecount,
      total: m.recordcount,
      observedAt: source.fetchedAt,
      reportDate,
      identities: tab.data.map((value, i) => {
        const row = szseRow.parse(value),
          listedAt = listingDate(row.agssrq),
          name = row.agjc
            .replace(/<[^>]*>/g, "")
            .replaceAll("&amp;", "&")
            .replaceAll("&nbsp;", " ")
            .trim();
        if (!name) throw new Error("Empty SZSE security name");
        return {
          ticker: row.agdm,
          companyName: name,
          identity: {
            exchange: "SZSE",
            board: row.bk,
            listedAt,
            state: listedAt <= observedDate ? "listed" : "not_yet_listed",
            industryLabels: [row.sshymc.trim()].filter(Boolean),
            sourceId: source.id,
            locator: `/${index}/data/${i}`,
            observedAt: source.fetchedAt,
          },
        };
      }),
    };
  }
  if (
    result.pageCount !== Math.max(1, Math.ceil(result.total / result.pageSize)) ||
    result.page > result.pageCount ||
    result.identities.length !==
      Math.min(result.pageSize, Math.max(0, result.total - (result.page - 1) * result.pageSize))
  )
    throw new Error("Inconsistent listing pagination");
  return result;
}
// 覆盖缺页时保留 partial，而不是把不完整抓取包装成完整股票池。
export function reconcileCnUniverse(
  pages: ListingPage[],
  asOf: string,
): { universe: CnUniverse; identities: ListedCompany[] } {
  if (
    !Number.isFinite(Date.parse(asOf)) ||
    pages.some(
      (p) =>
        Date.parse(p.observedAt) > Date.parse(asOf) || chinaDate(p.observedAt) !== chinaDate(asOf),
    )
  )
    throw new Error("Current listing evidence cannot establish a different-day or earlier cutoff");
  const seen = new Set<string>(),
    identities: ListedCompany[] = [];
  const coverage: CnUniverse["coverage"] = boards.map((board) => {
    const group = pages.filter((p) => p.board === board);
    if (!group.length)
      return { board, state: "missing", received: 0, reason: "listing_source_missing" };
    const first = group[0],
      pageNumbers = new Set<number>();
    for (const p of group) {
      if (
        p.total !== first.total ||
        p.pageSize !== first.pageSize ||
        p.pageCount !== first.pageCount ||
        p.reportDate !== first.reportDate
      )
        throw new Error("Listing totals changed during pagination");
      if (pageNumbers.has(p.page)) throw new Error("Duplicate listing page");
      pageNumbers.add(p.page);
      for (const c of p.identities) {
        if (seen.has(c.ticker))
          throw new Error(`Duplicate security in listing universe: ${c.ticker}`);
        seen.add(c.ticker);
        identities.push(c);
      }
    }
    const received = group.reduce((n, p) => n + p.identities.length, 0),
      pagesComplete =
        pageNumbers.size === first.pageCount && received === first.total && first.total > 0,
      observedDate = chinaDate(asOf),
      earlierSnapshot = first.reportDate !== undefined && first.reportDate < observedDate,
      calendar = earlierSnapshot ? expectedListingDate(observedDate, board) : undefined,
      current = !earlierSnapshot || calendar?.date === first.reportDate,
      complete = pagesComplete && current;
    return {
      board,
      state: complete ? "complete" : "partial",
      expected: first.total,
      received,
      ...(earlierSnapshot
        ? {
            snapshotDate: first.reportDate,
            ...(calendar ? { expectedDate: calendar.date, calendarSource: calendar.source } : {}),
          }
        : {}),
      ...(complete
        ? {}
        : { reason: !pagesComplete ? "listing_pages_incomplete" : "listing_snapshot_stale_or_unverified" }),
    };
  });
  return {
    universe: {
      status: coverage.every((c) => c.state === "complete") ? "complete" : "partial",
      asOf,
      coverage,
    },
    identities: identities.sort((a, b) => a.ticker.localeCompare(b.ticker, "en")),
  };
}

function listingUrl(board: Board, page: number): string {
  if (board === "BSE") return "https://www.bse.cn/nqxxController/nqxxCnzq.do";
  if (board === "SZSE")
    return (
      "https://www.szse.cn/api/report/ShowReport/data?" +
      new URLSearchParams({
        SHOWTYPE: "JSON",
        CATALOGID: "1110",
        TABKEY: "tab1",
        PAGENO: String(page),
      })
    );
  return (
    "https://query.sse.com.cn/sseQuery/commonQuery.do?" +
    new URLSearchParams({
      STOCK_TYPE: board === "SSE_MAIN" ? "1" : "8",
      sqlId: "COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L",
      COMPANY_STATUS: "2,4,5,7,8",
      type: "inParams",
      isPagination: "true",
      "pageHelp.cacheSize": "1",
      "pageHelp.beginPage": String(page),
      "pageHelp.pageSize": "2000",
      "pageHelp.pageNo": String(page),
    })
  );
}
/** Freeze every obtained identity before financial collection. Missing exchanges remain explicitly partial. */
// 分页请求也受有限预算约束，超限时落盘可复核的 partial 结果。
export async function collectCnUniverse(
  directory: string,
  options: { maxRequests: number; maxMs: number; requestMs: number; signal?: AbortSignal },
  dependencies: {
    fetch?: typeof import("../../shared/runtime.js").httpFetch;
    now?: () => number;
  } = {},
): Promise<{ inputFile: string; status: "complete" | "partial"; count: number }> {
  const { default: fs } = await import("node:fs/promises"),
    { default: path } = await import("node:path");
  const { httpFetch } = await import("../../shared/runtime.js"),
    { sha256 } = await import("../evidence.js");
  const now = dependencies.now ?? Date.now,
    fetch = dependencies.fetch ?? httpFetch;
  for (const key of ["maxRequests", "maxMs", "requestMs"] as const)
    if (!Number.isSafeInteger(options[key]) || options[key] < 1)
      throw new Error(`Invalid universe budget: ${key}`);
  const started = now(),
    pages: ListingPage[] = [],
    sources: import("../evidence.js").EvidenceInput["sources"] = [],
    events: Array<{
      url: string;
      sourceId: string;
      state: "success" | "source_error";
      durationMs: number;
      reason?: string;
    }> = [];
  let requests = 0;
  await fs.mkdir(path.dirname(path.resolve(directory)), { recursive: true });
  await fs.mkdir(directory);
  await fs.mkdir(path.join(directory, "sources"));
  const inputFile = path.join(directory, "input.json");
  const save = async () => {
    const asOf = new Date(now()).toISOString(),
      { universe, identities } = reconcileCnUniverse(pages, asOf);
    const input: import("../evidence.js").EvidenceInput = {
      schemaVersion: 1,
      universe,
      sources,
      companies: identities.map((c) => ({
        ...c,
        companyId: c.ticker,
        market: "CN",
        currency: "CNY",
        asOf,
        basis: "CN-consolidated-CAS",
        latestFiscalYear: Number(asOf.slice(0, 4)) - 1,
        method: { state: "unresolved", evidence: [], reason: "business_method_not_assessed" },
        checks: {},
        facts: [],
      })),
    };
    await fs.writeFile(inputFile + ".tmp", JSON.stringify(input, null, 2) + "\n");
    await fs.rename(inputFile + ".tmp", inputFile);
    await fs.writeFile(
      path.join(directory, "collection.json"),
      JSON.stringify(
        {
          startedAt: new Date(started).toISOString(),
          updatedAt: asOf,
          budget: {
            maxRequests: options.maxRequests,
            maxMs: options.maxMs,
            requestMs: options.requestMs,
          },
          requests,
          interrupted: options.signal?.aborted ?? false,
          events,
        },
        null,
        2,
      ) + "\n",
    );
    return { inputFile, status: universe.status, count: identities.length };
  };
  await save();
  const stopped = () =>
    options.signal?.aborted || requests >= options.maxRequests || now() - started >= options.maxMs;
  for (const board of boards) {
    let pageCount = 1;
    for (let page = 1; page <= pageCount && !stopped(); page++) {
      const url = listingUrl(board, page),
        sourceId = `listing:${board}:${page}`,
        requestStarted = now();
      requests++;
      const request =
        board === "BSE"
          ? {
              method: "POST" as const,
              contentType: "application/x-www-form-urlencoded" as const,
              body: new URLSearchParams({
                page: String(page - 1),
                typejb: "T",
                "xxfcbj[]": "2",
                xxzqdm: "",
                sortfield: "xxzqdm",
                sorttype: "asc",
              }).toString(),
            }
          : undefined;
      let bytes = Buffer.alloc(0),
        reason: string | undefined,
        parsed: ListingPage | undefined;
      const fetchedAt = () => new Date(now()).toISOString();
      let source: import("../evidence.js").EvidenceInput["sources"][number];
      try {
        const signal = AbortSignal.any([
          AbortSignal.timeout(
            Math.max(1, Math.min(options.requestMs, options.maxMs - (now() - started))),
          ),
          ...(options.signal ? [options.signal] : []),
        ]);
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer:
              board === "BSE"
                ? "https://www.bse.cn/nq/listedcompany.html"
                : board === "SZSE"
                  ? "https://www.szse.cn/market/product/stock/list/index.html"
                  : "https://www.sse.com.cn/assortment/stock/list/share/",
            ...(request
              ? { Origin: "https://www.bse.cn", "Content-Type": request.contentType }
              : {}),
          },
          signal,
          redirect: "error",
          ...(request ? { method: request.method, body: request.body } : {}),
        });
        bytes = Buffer.from(await response.arrayBuffer());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const mapping =
          board === "BSE"
            ? ("bse-list" as const)
            : board === "SZSE"
              ? ("szse-list" as const)
              : ("sse-list" as const);
        source = {
          id: sourceId,
          path: "",
          url,
          mediaType: "application/json",
          mapping,
          fetchedAt: fetchedAt(),
          sha256: "",
          ...(request ? { request } : {}),
        };
        parsed = parseCnListingPage(decodeCnListingDocument(bytes.toString("utf8"), mapping), {
          ...source,
          mapping,
        });
        reconcileCnUniverse([...pages, parsed], fetchedAt()); // Validate before admitting a page to the frozen identities.
        pageCount = parsed.pageCount;
      } catch (error) {
        reason = (error as Error).message;
      }
      if (reason) {
        bytes = Buffer.from(
          JSON.stringify({ reason, rawSha256: sha256(bytes), rawBase64: bytes.toString("base64") }),
        );
        source = {
          id: sourceId,
          path: "",
          url,
          mediaType: "application/json",
          fetchedAt: fetchedAt(),
          sha256: "",
          ...(request ? { request } : {}),
        };
      } else pages.push(parsed!);
      source!.sha256 = sha256(bytes);
      source!.path = `sources/${source!.sha256}.json`;
      await fs.writeFile(path.join(directory, source!.path), bytes);
      sources.push(source!);
      events.push({
        url,
        sourceId,
        state: reason ? "source_error" : "success",
        durationMs: Math.max(0, now() - requestStarted),
        ...(reason ? { reason } : {}),
      });
      await save();
      if (reason) break; // A failed first page cannot tell us how many later pages exist.
    }
  }
  return save();
}
