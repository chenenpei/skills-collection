/**
 * CN 年报文本事实：从可定位的合并报表、附注和监管表中提取观察。
 * 解析器刻意保守：范围、单位、表头或监管口径不明确时不把文本升级为事实。
 */
import { parseCnOtherFinancialFacts, parseCnInsuranceFacts } from "./financial-reports.js";

import {
  type FinancialFact,
  regulatoryMetricDefinitions,
  type RegulatoryContext,
  type BusinessBreakdown,
} from "../../shared/financial-model.js";

/** Identity and publication have already been checked against the announcement. */
export interface DisclosureText {
  entity: string;
  periodEnd: string;
  publishedAt: string;
  identityPage?: number;
  pages: Record<string, { text: string; lines: string[]; tables?: string[][][] }>;
}
type Statement = "balance" | "income" | "cashflow";
interface Table {
  kind: Statement;
  years?: number[];
  scale?: number;
  originalUnit?: string;
  hasNotes?: boolean;
}
const compact = (line: string) => line.replace(/\s/g, "");
const numberToken = "[−－-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const twoValues = new RegExp(`^(.*?)\\s+(${numberToken})\\s+(${numberToken})\\s*$`);

/** A current business description identifies primary operations, not all group entities or risks. */
// 业务描述用于识别当期主营活动，不试图穷尽集团实体、风险或持牌范围。
function primaryActivityFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    year = Number(document.periodEnd.slice(0, 4));
  const normalized = (text: string) => compact(text.normalize("NFKC"));
  for (const [page, content] of Object.entries(document.pages)) {
    const lines = content.lines.map(normalized);
    const headerYear = lines
      .slice(0, 4)
      .map((l) => l.match(/(20\d{2})年年度报告/)?.[1])
      .find(Boolean);
    if (headerYear && Number(headerYear) !== year) continue;
    let section: "basic" | "management" | undefined,
      management = false,
      excluded = false;
    for (const [i, line] of lines.entries()) {
      const heading =
        /^(?:第[一二三四五六七八九十]+节|[一二三四五六七八九十\d]+[、.]|\([一二三四五六七八九十\d]+\))/.test(
          line,
        );
      if (heading && /子公司|联营|合营|参股|任职|董事|简历|经营计划|经营范围|营业执照/.test(line)) {
        section = undefined;
        management = false;
        excluded = true;
        continue;
      }
      if (/^第[一二三四五六七八九十]+节管理层讨论与分析$/.test(line)) {
        management = true;
        section = undefined;
        excluded = false;
      } else if (!excluded && /^[一二三四五六七八九十]+、(?:公司基本情况|公司概况)$/.test(line)) {
        section = "basic";
        management = false;
      } else if (section === "basic" && /^\d+[、.](?:公司基本情况|公司概况)$/.test(line)) continue;
      else if (
        management &&
        /^(?:[一二三四五六七八九十]+、)?(?:报告期内公司从事的业务情况|业务概要)$/.test(line)
      )
        section = "management";
      else if (section === "management" && /^\([一二三四五六七八九十\d]+\)主要业务$/.test(line))
        continue;
      else if (/^(?:第[一二三四五六七八九十]+节|[一二三四五六七八九十]+、)/.test(line)) {
        section = undefined;
        management = false;
      } else if (heading) section = undefined;
      if (
        !section ||
        !/^本公司及子公司|^(?:本公司|本集团|公司)主要从事|^公司的主要业务涉及|^公司属于/.test(line)
      )
        continue;
      let sentence = "";
      for (const part of lines.slice(i, i + 6)) {
        if (!part) break;
        sentence += part;
        if (sentence.includes("。")) {
          sentence = sentence.slice(0, sentence.indexOf("。") + 1);
          break;
        }
      }
      const group = sentence.match(/^本公司及子公司\(以下合称[“"]本集团[”"]\)主要从事([^。]+)。$/);
      const generic = sentence.match(/^(本公司|本集团|公司)主要从事([^。]+)。$/);
      const issuer =
        section === "management" ? sentence.match(/^公司的主要业务涉及([^。]+)。$/) : undefined;
      const utility =
        section === "management"
          ? sentence.match(/^公司属于[^,]+,是[^,]+,从事([^。]+)。$/)
          : undefined;
      const description = group?.[1] ?? generic?.[2] ?? issuer?.[1] ?? utility?.[1];
      if (
        !description ||
        /尚未|未实际|拟开展|拟开发|未来|经营计划|经营范围|不再|停止经营|终止经营/.test(description)
      )
        continue;
      const scope = group || generic?.[1] === "本集团" ? "group" : "issuer";
      facts.push({
        id: `${options.sourceId}:${page}:${i}:business.primaryActivity`,
        field: "business.primaryActivity",
        entity: document.entity,
        year,
        period: { start: `${year}-01-01`, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify({ scope, description }),
        evidence: [
          { sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text },
        ],
        reason:
          "reported_current_primary_operations;not_complete_group_or_licensed_entity_inventory",
      });
    }
  }
  return facts;
}

function businessBreakdownFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    year = Number(document.periodEnd.slice(0, 4));
  for (const [page, content] of Object.entries(document.pages))
    for (const [start, line] of content.lines.entries()) {
      const title = compact(line).match(/^主营业务分(行业|产品)情况$/);
      if (!title) continue;
      const rawUnit = content.lines
        .slice(0, start)
        .reverse()
        .find((l) => /单位[：:]/.test(compact(l)));
      const unit = rawUnit && compact(rawUnit).match(/^单位[：:](元|千元|万元)币种[：:]人民币$/);
      if (!unit) continue;
      const scale = { 元: 1, 千元: 1000, 万元: 10000 }[unit[1] as "元" | "千元" | "万元"];
      const context: BusinessBreakdown = {
        scope: "main_business",
        dimension: title[1] === "行业" ? "industry" : "product",
        rows: [],
      };
      let header = false,
        prefix = "";
      for (let i = start + 1; i < content.lines.length; i++) {
        const raw = content.lines[i],
          text = compact(raw);
        if (/^主营业务分/.test(text) || /^[（(]?\d+[）).、]/.test(text)) break;
        if (text.startsWith(`分${title[1]}营业收入营业成本`)) {
          header = true;
          continue;
        }
        if (!header) continue;
        if (/^(?:减[：:])?集团$/.test(text)) {
          prefix = text;
          continue;
        }
        const values = raw
          .trim()
          .match(new RegExp(`^(.+?)\\s+(${numberToken}|—|-)\\s+(${numberToken}|—|-)(?:\\s|$)`));
        if (!values) {
          prefix = "";
          continue;
        }
        const name = prefix + compact(values[1]);
        prefix = "";
        const role = /^(?:减[：:])?(?:集团)?内部抵销$/.test(name)
          ? "elimination"
          : /^(?:合计|总计)$/.test(name)
            ? "total"
            : "business";
        const row: BusinessBreakdown["rows"][number] = { name, role };
        for (const [column, field, key] of [
          [1, "business.revenue", "revenueFactId"],
          [2, "business.cost", "costFactId"],
        ] as const) {
          if (!new RegExp(`^${numberToken}$`).test(values[column + 1])) continue;
          const value =
            Number(values[column + 1].replaceAll(",", "").replace(/[−－]/g, "-")) * scale;
          if (!Number.isFinite(value)) continue;
          const id = `${options.sourceId}:${page}:${i}:${field}`;
          row[key] = id;
          facts.push({
            id,
            field,
            entity: document.entity,
            year,
            period: { start: `${year}-01-01`, end: document.periodEnd },
            publishedAt: document.publishedAt,
            basis: options.basis,
            unit: "CNY",
            unitScale: scale,
            state: "observed",
            value,
            evidence: [{ sourceId: options.sourceId, locator: `/pages/${page}/lines/${i}`, raw }],
            reason: `main_business_${context.dimension};row:${name};role:${role};reported_unit:${unit[1]}`,
          });
        }
        context.rows.push(row);
      }
      if (context.rows.length)
        facts.push({
          id: `${options.sourceId}:${page}:${start}:business.breakdown`,
          field: "business.breakdown",
          entity: document.entity,
          year,
          period: { start: `${year}-01-01`, end: document.periodEnd },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "text",
          state: "observed",
          value: JSON.stringify(context),
          evidence: [
            { sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text },
          ],
          reason:
            "reported_main_business_rows;not_complete_group_segment_or_licensed_entity_inventory",
        });
    }
  return facts;
}

/** Reported operating segments are separate from subsidiaries and other licensed risk exposures. */
function businessSegmentFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    pages = Object.entries(document.pages).sort(([a], [b]) => Number(a) - Number(b));
  const unitPage = pages.find(
    ([, p]) =>
      compact(p.text).includes("记账本位币") &&
      /除有特别说明外，均以人民币(?:百万元|万元|千元|元)为单位表示/.test(compact(p.text)),
  );
  const reportedUnit =
    unitPage &&
    compact(unitPage[1].text).match(
      /除有特别说明外，均以人民币(百万元|万元|千元|元)为单位表示/,
    )?.[1];
  const scales = { 元: 1, 千元: 1000, 万元: 10000, 百万元: 1000000 };
  const defaultUnit =
    reportedUnit && unitPage
      ? {
          scale: scales[reportedUnit as keyof typeof scales],
          label: reportedUnit,
          page: unitPage[0],
        }
      : undefined;
  let activeUnit = defaultUnit;
  let declaration:
      | { page: string; count: number; names: string[]; definitions?: string[] }
      | undefined,
    previousPage: number | undefined;
  for (const [page, content] of pages) {
    const section = content.lines.findIndex((l) =>
      /^[一二三四五六七八九十\d]+、分部报告(?:[（(]续[）)])?$/.test(compact(l)),
    );
    if (previousPage !== Number(page) - 1) declaration = undefined;
    previousPage = Number(page);
    if (section < 0) {
      declaration = undefined;
      continue;
    }
    const end = content.lines.findIndex(
      (l, i) => i > section && /^[一二三四五六七八九十\d]+、/.test(compact(l)),
    );
    const lines = content.lines.slice(section, end < 0 ? undefined : end),
      text = compact(lines.join(""));
    const single = text.match(
      /在报告期内，本集团专注于([^，。]+)，因此只有一个经营分部，无需编制分部信息。/,
    );
    if (single) {
      const year = Number(document.periodEnd.slice(0, 4));
      facts.push({
        id: `${options.sourceId}:${page}:business.segments`,
        field: "business.segments",
        entity: document.entity,
        year,
        period: { start: `${year}-01-01`, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify({
          scope: "reported_segments",
          declaredCount: 1,
          rows: [{ name: single[1], definition: single[0] }],
          totals: {},
        }),
        evidence: [
          { sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text },
        ],
        reason:
          "explicit_single_operating_segment;licensed_entities_and_other_exposures_not_certified",
      });
      declaration = undefined;
      continue;
    }
    const count = text.match(/本集团有如下([一二三四五六七八九十]|\d+)个报告分部[：:]/)?.[1];
    if (count) {
      const tableStart = lines.findIndex((l) => /^20\d{2}\s*年\s+.+\s+合计$/.test(l.trim()));
      const description = compact(lines.slice(0, tableStart < 0 ? undefined : tableStart).join(""));
      const entries = [...description.matchAll(/[（(]\d+[）)]([^（()）]+?)(?:指|包括)/g)],
        names = entries.map((m) => m[1]);
      // Keep the complete numbered definition; semicolons inside a definition
      // must not hide additional activities or exposures later in that item.
      const definitions = entries.map((m, i) =>
        description.slice(m.index! + m[0].length, entries[i + 1]?.index ?? description.length),
      );
      const n = /^\d+$/.test(count) ? Number(count) : "一二三四五六七八九十".indexOf(count) + 1;
      // When the table begins on a later page, this page may truncate an
      // activity definition. Retain numeric segments but do not certify the
      // partial text as a complete definition for method coverage.
      declaration =
        names.length === n && new Set(names).size === n && definitions.every(Boolean)
          ? { page, count: n, names, ...(tableStart >= 0 ? { definitions } : {}) }
          : undefined;
      activeUnit = defaultUnit;
    }
    const localUnit = lines.map(compact).find((l) => /^(?:单位|币种)[：:]/.test(l));
    if (localUnit) {
      const unit = localUnit.match(/^单位[：:](百万元|万元|千元|元)币种[：:]人民币$/);
      activeUnit = unit
        ? { scale: scales[unit[1] as keyof typeof scales], label: unit[1], page }
        : undefined;
    }
    if (!declaration || !activeUnit || Number(activeUnit.page) > Number(page)) continue;
    const scale = activeUnit.scale;
    const header = lines.findIndex((l) => /^20\d{2}\s*年\s+.+\s+合计$/.test(l.trim()));
    if (header < 0) continue;
    const match = lines[header].trim().match(/^(20\d{2})\s*年\s+(.+?)\s+合计$/)!,
      year = Number(match[1]),
      names = match[2].trim().split(/\s+/);
    if (
      year > Number(document.periodEnd.slice(0, 4)) ||
      names.length !== declaration.count ||
      names.some((name, i) => name !== declaration!.names[i])
    )
      continue;
    const rows = names.map(
        (name, i) =>
          ({
            name,
            ...(declaration!.definitions ? { definition: declaration!.definitions[i] } : {}),
          }) as {
            name: string;
            definition: string;
            revenueFactId?: string;
            assetsFactId?: string;
            profitFactId?: string;
          },
      ),
      totals: { revenueFactId?: string; assetsFactId?: string; profitFactId?: string } = {};
    for (let i = header + 1; i < lines.length; i++) {
      const cells = lines[i].trim().split(/\s+/),
        label = cells.shift();
      const item =
        label === "营业收入"
          ? ["business.segmentRevenue", "revenueFactId"]
          : label === "资产总额"
            ? ["business.segmentAssets", "assetsFactId"]
            : label === "分部利润"
              ? ["business.segmentProfit", "profitFactId"]
              : undefined;
      if (!item || cells.length !== names.length + 1) continue;
      for (let col = 0; col < cells.length; col++) {
        const cell = cells[col];
        if (!/^(?:\([\d,]+(?:\.\d+)?\)|-?[\d,]+(?:\.\d+)?)$/.test(cell)) continue;
        const value = Number(cell.replaceAll(",", "").replace(/^\((.*)\)$/, "-$1")) * scale;
        if (!Number.isFinite(value)) continue;
        const field = item[0],
          key = item[1] as "revenueFactId" | "assetsFactId" | "profitFactId",
          line = section + i,
          id = `${options.sourceId}:${page}:${line}:${col}:${field}`;
        (col === names.length ? totals : rows[col])[key] = id;
        facts.push({
          id,
          field,
          entity: document.entity,
          year,
          period: {
            start: field === "business.segmentAssets" ? `${year}-12-31` : `${year}-01-01`,
            end: `${year}-12-31`,
          },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "CNY",
          unitScale: scale,
          state: "observed",
          value,
          evidence: [
            {
              sourceId: options.sourceId,
              locator: `/pages/${page}/lines/${line}`,
              raw: content.lines[line],
            },
          ],
          reason: `reported_segment:${col === names.length ? "total" : names[col]};reported_unit:${activeUnit.label}`,
        });
      }
    }
    const evidence = [...new Set([activeUnit.page, declaration.page, page])].map((p) => ({
      sourceId: options.sourceId,
      locator: `/pages/${p}/text`,
      raw: document.pages[p].text,
    }));
    facts.push({
      id: `${options.sourceId}:${page}:business.segments`,
      field: "business.segments",
      entity: document.entity,
      year,
      period: { start: `${year}-01-01`, end: `${year}-12-31` },
      publishedAt: document.publishedAt,
      basis: options.basis,
      unit: "text",
      state: "observed",
      value: JSON.stringify({
        scope: "reported_segments",
        declaredCount: declaration.count,
        rows,
        totals,
      }),
      evidence,
      reason:
        "complete_reported_segment_columns;licensed_entities_and_other_exposures_not_certified",
    });
  }
  return facts;
}

/** An issuer's own license and applicable business rules identify the legal entity, not every group risk. */
function licensedBusinessFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    year = Number(document.periodEnd.slice(0, 4));
  for (const [page, content] of Object.entries(document.pages)) {
    if (!compact(content.text).includes("财务报表附注")) continue;
    const start = content.lines.findIndex((l) => /^一[、.](?:公司)?基本情况$/.test(compact(l)));
    const end = content.lines.findIndex(
      (l, i) => i > start && /^二[、.]财务报表的编制基础$/.test(compact(l)),
    );
    if (start < 0) continue;
    const text = compact(content.lines.slice(start + 1, end < 0 ? undefined : end).join(""));
    const leaseLicense = text.match(/本公司持有([A-Z0-9]{8,30})号金融许可证/);
    const bankLicense = text.match(/本公司经[^。]*批准领有([A-Z0-9]{8,30})号金融许可证/);
    const leaseTicker = text.match(
      /本公司A股股票在(?:上海|深圳|北京)证券交易所上市交易，股份代号为(\d{6})。/,
    )?.[1];
    const bankTicker = text.match(
      /本公司在(?:上海|深圳|北京)证券交易所上市，股票代码[“"]?(\d{6})[”"]?。/,
    )?.[1];
    const lease =
      leaseLicense &&
      leaseTicker === document.entity &&
      /本公司经[^。]*批准，按照《金融租赁公司管理办法》[^。]*的规定，其经营范围的业务为[：:]融资租赁业务/.test(
        text,
      );
    const charter = text.match(/[^。]*以下简称[“"]本公司[”"][^。]*批准设立的股份制商业银行。/);
    const bank = bankLicense && bankTicker === document.entity && charter;
    if ((!lease && !bank) || (lease && bank)) continue;
    const method = lease ? "financial_lease" : "bank",
      license = lease ? leaseLicense! : bankLicense!;
    for (const [field, value] of [
      ["business.licensedMethod", method],
      ["business.licenseNumber", license[1]],
    ] as const)
      facts.push({
        id: `${options.sourceId}:${page}:${field}`,
        field,
        entity: document.entity,
        year,
        period: { start: `${year}-01-01`, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value,
        evidence: [
          { sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text },
        ],
        reason: `issuer_own_license_and_explicit_${method}_business_regime;group_risk_scope_not_certified`,
      });
  }
  return facts;
}

function fieldFor(kind: Statement, label: string): string | undefined {
  const labels: Record<Statement, Record<string, string>> = {
    balance: {
      资产总计: "assets",
      负债合计: "liabilities",
      所有者权益合计: "equity",
      归属于母公司所有者权益合计: "parentEquity",
      归属于母公司股东权益合计: "parentEquity",
      货币资金: "monetaryFunds",
      短期借款: "shortBorrowings",
      长期借款: "longBorrowings",
      租赁负债: "leaseLiabilities",
      应付票据: "notesPayable",
      应付债券: "bondsPayable",
      一年内到期的非流动负债: "currentNoncurrentLiabilities",
      长期应付款: "longPayables",
      其他流动负债: "otherCurrentLiabilities",
      其他非流动负债: "otherNoncurrentLiabilities",
      其他应付款: "otherPayables",
    },
    income: {
      营业收入: "revenue",
      营业成本: "cost",
      税金及附加: "businessTax",
      销售费用: "sellingExpense",
      管理费用: "adminExpense",
      研发费用: "researchExpense",
      利息费用: "interestExpense",
      信用减值损失: "creditImpairment",
      资产减值损失: "assetImpairment",
      利润总额: "profitBeforeTax",
      净利润: "netProfit",
      归属于母公司股东的净利润: "parentProfit",
      归属于母公司所有者的净利润: "parentProfit",
    },
    cashflow: {
      经营活动产生的现金流量净额: "operatingCashFlow",
      "购建固定资产、无形资产和其他长期资产支付的现金": "capex",
    },
  };
  const normalized = label
    .replace(/^(?:[一二三四五六七八九十]+、|\d+[.．])/, "")
    .replace(/^(?:其中|加|减)[：:]/, "")
    .replace(/（[^）]*）|\([^)]*\)/g, "");
  return labels[kind][normalized];
}

// 非经常损益与收益率需要合并范围、期间和表格结构同时明确。
function ordinaryProfitFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const year = Number(document.periodEnd.slice(0, 4));
  const beginning = new RegExp(`${year}年度(?:本公司|本集团)按中国企业会计准则编制`);
  const statement = new RegExp(
    `${year}年度(?:本公司|本集团)按中国企业会计准则编制的合并财务报表中归属于(?:母公司|上市公司)普通股股东的净利润为人民币(${numberToken})(元|千元|万元)`,
  );
  const facts: FinancialFact[] = [];
  for (const [page, content] of Object.entries(document.pages))
    for (let i = 0; i < content.lines.length; i++) {
      if (!beginning.test(compact(content.lines[i]))) continue;
      let sentence = "";
      for (const raw of content.lines.slice(i, i + 4)) {
        if (!raw.trim()) break;
        sentence += compact(raw);
        if (sentence.includes("。")) {
          sentence = sentence.split("。")[0];
          break;
        }
      }
      const match = sentence.match(statement);
      if (!match) continue;
      const scale = { 元: 1, 千元: 1_000, 万元: 10_000 }[match[2] as "元" | "千元" | "万元"];
      const value = Number(match[1].replace(/,/g, "").replace(/[−－]/g, "-")) * scale;
      const offset = content.lines
        .slice(i, i + 4)
        .findIndex((line) => compact(line).includes(match[1]));
      if (!Number.isFinite(value) || offset < 0) continue;
      const lineIndex = i + offset;
      facts.push({
        id: `${options.sourceId}:${page}:${lineIndex}:ordinaryProfit`,
        field: "ordinaryProfit",
        entity: document.entity,
        year,
        period: { start: `${year}-01-01`, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "CNY",
        unitScale: scale,
        state: "observed",
        value,
        evidence: [
          {
            sourceId: options.sourceId,
            locator: `/pages/${page}/lines/${lineIndex}`,
            raw: content.lines[lineIndex],
          },
        ],
        reason: `explicit_CAS_consolidated_ordinary_profit;reported_unit:${match[2]};statement_start:/pages/${page}/lines/${i}`,
      });
    }
  return facts;
}

/** Read the ordinary-shareholder return table itself, preserving its annual CAS scope. */
function ordinaryReturnFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const year = Number(document.periodEnd.slice(0, 4)),
    facts: FinancialFact[] = [],
    normalize = (s: string) => compact(s.normalize("NFKC"));
  const pages = Object.entries(document.pages);
  const declarationHeading = /^\d+[、.]遵循企业会计准则的声明$/;
  const hasPeriod = (p: DisclosureText["pages"][string]) =>
    p.lines
      .slice(0, 4)
      .some(
        (l) =>
          normalize(l).includes(`${year}年年度报告`) ||
          normalize(l) === `${year}年1月1日至${year}年12月31日`,
      );
  const cas = pages.filter(([, p]) =>
    p.lines.some((l, i) => {
      if (!declarationHeading.test(normalize(l))) return false;
      const text = p.lines
        .slice(i + 1, i + 4)
        .map(normalize)
        .join("");
      return (
        (hasPeriod(p) && /^(?:本)?公司所编制的财务报表符合企业会计准则的要求/.test(text)) ||
        text.startsWith(
          `本财务报表符合企业会计准则的要求,真实、完整地反映了本公司及本集团于${year}年12月31日的财务状况以及${year}年度经营成果和现金流量等有关信息。`,
        )
      );
    }),
  );
  if (cas.length !== 1) return facts;
  const changedScope = (s: string) =>
    /国际财务报告(?:会计)?准则|国际会计准则|IFRS|^(?:[一二三四五六七八九十\d]+、)?母公司(?:财务)?报表/.test(
      s,
    );
  const rowPattern = new RegExp(
    `^(.*?)\\s+(${numberToken})\\s+(${numberToken})\\s+(${numberToken})\\s*$`,
  );
  for (const [page, p] of pages)
    for (const [start, line] of p.lines.entries()) {
      if (!/^\d+[、.]净资产收益率及每股收益$/.test(normalize(line)) || !hasPeriod(p)) continue;
      if (
        Number(cas[0][0]) > Number(page) ||
        (cas[0][0] === page &&
          cas[0][1].lines.findIndex((l) => declarationHeading.test(normalize(l))) >= start)
      )
        continue;
      const priorPage = String(Number(page) - 1),
        prior = document.pages[priorPage];
      const preceding = [...(prior?.lines ?? []), ...p.lines.slice(0, start)].map(normalize);
      const supplementary = preceding
        .map((l) => /^(?:[一二三四五六七八九十]+、补充资料|财务报表补充资料)$/.test(l))
        .lastIndexOf(true);
      if (supplementary < 0 || preceding.slice(supplementary).some(changedScope)) continue;
      const nextPage = String(Number(page) + 1),
        next = document.pages[nextPage];
      let lines = p.lines.slice(start + 1).map((raw, i) => ({ raw, page, index: start + 1 + i }));
      if (next && hasPeriod(next))
        lines.push(...next.lines.map((raw, index) => ({ raw, page: nextPage, index })));
      const end = lines.findIndex((l) => /^\d+[、.][^\d]/.test(normalize(l.raw)));
      if (end >= 0) lines = lines.slice(0, end);
      lines = lines.filter(
        (l) =>
          !normalize(l.raw).includes(`${year}年年度报告`) &&
          !/^\d+(?:\/\d+)?$/.test(normalize(l.raw)),
      );
      if (lines.some((l) => changedScope(normalize(l.raw)))) continue;
      const header =
        /^(?:√适用□不适用)?报告期利润加权平均净资产收益率\(%\)每股收益(?:\(元\/股\))?基本每股收益稀释每股收益$/;
      let consumed = 0,
        combined = "";
      while (consumed < Math.min(lines.length, 8) && !combined.endsWith("稀释每股收益"))
        combined += normalize(lines[consumed++].raw);
      if (!header.test(combined)) continue;
      const bindings: Record<string, string> = {},
        seen = new Set<string>();
      let prefix = "",
        duplicate = false;
      for (const row of lines.slice(consumed)) {
        const values = row.raw.match(rowPattern);
        if (!values) {
          prefix += normalize(row.raw);
          continue;
        }
        const label = prefix + normalize(values[1]);
        prefix = "";
        const field = /^归属于(?:母)?公司普通股股东的净利润$/.test(label)
          ? "weightedRoe"
          : /^扣除非经常性损益后归属于(?:母)?公司普通股股东的净利润$/.test(label)
            ? "adjustedWeightedRoe"
            : undefined;
        if (!field) continue;
        if (seen.has(field)) duplicate = true;
        seen.add(field);
        const id = `${options.sourceId}:${row.page}:${row.index}:ordinary-return:${field}`,
          value = Number(values[2].replaceAll(",", "").replace(/[−－]/g, "-")) * 0.01;
        facts.push({
          id,
          field,
          entity: document.entity,
          year,
          period: { start: `${year}-01-01`, end: document.periodEnd },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "ratio",
          unitScale: 0.01,
          state: "observed",
          value,
          evidence: [
            {
              sourceId: options.sourceId,
              locator: `/pages/${row.page}/lines/${row.index}`,
              raw: row.raw,
            },
          ],
          reason:
            "reported_CAS_ordinary_shareholder_weighted_return;first_numeric_column_is_ROE_not_EPS",
        });
        bindings[field] = id;
      }
      if (duplicate || !bindings.weightedRoe || !bindings.adjustedWeightedRoe) continue;
      const context = {
        accountingStandard: "CAS",
        shareholderScope: "ordinary",
        reportYear: year,
        weightedRoeFactId: bindings.weightedRoe,
        adjustedWeightedRoeFactId: bindings.adjustedWeightedRoe,
      };
      const refs = [
        ...new Set([cas[0][0], ...(prior ? [priorPage] : []), page, ...lines.map((l) => l.page)]),
      ];
      facts.push({
        id: `${options.sourceId}:${page}:${start}:earnings.returnContext`,
        field: "earnings.returnContext",
        entity: document.entity,
        year,
        period: { start: `${year}-01-01`, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify(context),
        evidence: refs.map((page) => ({
          sourceId: options.sourceId,
          locator: `/pages/${page}/text`,
          raw: document.pages[page].text,
        })),
        reason:
          "reported_annual_ordinary_return_scope;not_a_multi_year_comparability_or_profit_allocation_approval",
      });
    }
  return facts;
}

/** A policy note may explicitly bridge one prior consolidated year; it is not a blanket historical restatement. */
function accountingPolicyRestatementFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const reportYear = Number(document.periodEnd.slice(0, 4)),
    restatedYear = reportYear - 1;
  const pages = Object.entries(document.pages).sort(([a], [b]) => Number(a) - Number(b)),
    facts: FinancialFact[] = [];
  const statementUnit = (title: "合并资产负债表" | "合并利润表") => {
    const matches = pages.flatMap(([page, content]) =>
      content.lines.flatMap((line, index) =>
        compact(line) === title
          ? content.lines
              .slice(index + 1, index + 6)
              .flatMap((candidate, offset) =>
                /^单位[：:]元币种[：:]人民币$/.test(compact(candidate))
                  ? [{ page, line: index + 1 + offset }]
                  : [],
              )
          : [],
      ),
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  const balanceUnit = statementUnit("合并资产负债表"),
    incomeUnit = statementUnit("合并利润表");
  if (reportYear !== 2023 || !balanceUnit || !incomeUnit) return facts;
  const fields = {
    递延所得税资产: { metric: "deferredTaxAssets", annual: false },
    递延所得税负债: { metric: "deferredTaxLiabilities", annual: false },
    未分配利润: { metric: "retainedEarnings", annual: false },
    所得税费用: { metric: "incomeTaxExpense", annual: true },
  } as const;
  const parseAmount = (raw: string) => Number(raw.replaceAll(",", "").replace(/[−－]/g, "-"));
  const precision = (raw: string) => raw.match(/\.(\d+)$/)?.[1].length ?? 0;
  const bridgeRow = new RegExp(
    `^(${Object.keys(fields).join("|")})\\s+(${numberToken})\\s+(${numberToken})\\s+(${numberToken})\\s*$`,
  );
  for (const [policyPage, policy] of pages) {
    const policyText = compact(policy.text);
    if (
      !policyText.includes("重要会计政策变更") ||
      !policyText.includes("企业会计准则解释第16号") ||
      !policyText.includes("2023年1月1日起施行") ||
      !policyText.includes("进行追溯")
    )
      continue;
    const tableEntry = pages.find(
      ([page, content]) =>
        Number(page) === Number(policyPage) + 1 &&
        content.lines.some((line) => compact(line) === "合并资产负债表项目"),
    );
    if (!tableEntry) continue;
    const [tablePage, table] = tableEntry;
    const tableText = compact(table.text);
    if (
      !tableText.includes("该会计政策变更对财务报表的影响如下：") ||
      tableText.includes("母公司资产负债表项目") ||
      tableText.includes("母公司利润表项目")
    )
      continue;
    const balanceHeading = table.lines.findIndex((line) => compact(line) === "合并资产负债表项目");
    const incomeHeading = table.lines.findIndex(
      (line, index) => index > balanceHeading && compact(line) === "合并利润表项目",
    );
    if (balanceHeading < 0 || incomeHeading < 0) continue;
    const localUnit = table.lines
      .slice(0, balanceHeading + 1)
      .map(compact)
      .find((line) => /^单位[：:](元|千元|万元)币种[：:](人民币|美元)$/.test(line));
    if (localUnit && !/^单位[：:]元币种[：:]人民币$/.test(localUnit)) continue;
    const headerAfter = (start: number) => {
      let header = "";
      for (const line of table.lines.slice(start + 1, start + 4)) {
        header += compact(line);
        if (header.endsWith("调整数")) break;
      }
      return header;
    };
    const balanceHeader = headerAfter(balanceHeading),
      incomeHeader = headerAfter(incomeHeading);
    if (
      !balanceHeader.includes(`${restatedYear}年12月31日`) ||
      !incomeHeader.includes(`${restatedYear}年度`) ||
      !balanceHeader.endsWith("调整前调整后调整数") ||
      !incomeHeader.endsWith("调整前调整后调整数")
    )
      continue;
    const rows = new Map<
      string,
      { line: number; original: number; restated: number; adjustment: number; precision: number }
    >();
    let invalid = false;
    const incomeEnd = table.lines.findIndex(
      (line, index) => index > incomeHeading && /^\(\d+\)\./.test(compact(line)),
    );
    for (const [line, raw] of table.lines.entries()) {
      const match = raw.match(bridgeRow);
      if (!match) continue;
      const definition = fields[match[1] as keyof typeof fields];
      const inBalance =
        definition.annual === false && line > balanceHeading && line < incomeHeading;
      const inIncome =
        definition.annual === true && line > incomeHeading && (incomeEnd < 0 || line < incomeEnd);
      if (!inBalance && !inIncome) continue;
      if (rows.has(definition.metric)) {
        invalid = true;
        break;
      }
      const original = parseAmount(match[2]),
        restated = parseAmount(match[3]),
        adjustment = parseAmount(match[4]);
      const tolerance =
        0.5 * 10 ** -Math.min(precision(match[2]), precision(match[3]), precision(match[4]));
      if (
        ![original, restated, adjustment].every(Number.isFinite) ||
        Math.abs(restated - original - adjustment) > tolerance + Number.EPSILON
      ) {
        invalid = true;
        break;
      }
      rows.set(definition.metric, {
        line,
        original,
        restated,
        adjustment,
        precision: Math.min(precision(match[2]), precision(match[3]), precision(match[4])),
      });
    }
    if (invalid || rows.size !== Object.keys(fields).length) continue;
    const metrics: Record<
      string,
      {
        periodStart?: string;
        periodEnd: string;
        originalFactId: string;
        restatedFactId: string;
        adjustmentFactId: string;
      }
    > = {};
    for (const definition of Object.values(fields)) {
      const row = rows.get(definition.metric)!;
      const period = definition.annual
        ? { start: `${restatedYear}-01-01`, end: `${restatedYear}-12-31` }
        : { start: `${restatedYear}-12-31`, end: `${restatedYear}-12-31` };
      const ids: Record<"original" | "restated" | "adjustment", string> = {
        original: `${options.sourceId}:${tablePage}:${row.line}:restatement:${definition.metric}:original`,
        restated: `${options.sourceId}:${tablePage}:${row.line}:restatement:${definition.metric}:restated`,
        adjustment: `${options.sourceId}:${tablePage}:${row.line}:restatement:${definition.metric}:adjustment`,
      };
      const unit = definition.annual ? incomeUnit : balanceUnit;
      for (const [kind, value] of [
        ["original", row.original],
        ["restated", row.restated],
        ["adjustment", row.adjustment],
      ] as const)
        facts.push({
          id: ids[kind],
          field: `earnings.restatement.${kind}.${definition.metric}`,
          entity: document.entity,
          year: restatedYear,
          period,
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "CNY",
          state: "observed",
          value,
          evidence: [
            {
              sourceId: options.sourceId,
              locator: `/pages/${tablePage}/lines/${row.line}`,
              raw: table.lines[row.line],
            },
          ],
          reason: `explicit_consolidated_CAS_interpretation_16_restatement_bridge;${kind}_reported;reported_unit:元人民币;unit_source:/pages/${unit.page}/lines/${unit.line};precision:${row.precision}`,
        });
      metrics[definition.metric] = {
        ...(definition.annual ? { periodStart: period.start } : {}),
        periodEnd: period.end,
        originalFactId: ids.original,
        restatedFactId: ids.restated,
        adjustmentFactId: ids.adjustment,
      };
    }
    const context = {
      reportYear,
      restatedYear,
      scope: "consolidated",
      method: "retrospective",
      trigger: {
        kind: "accounting_policy_change",
        standard: "CAS-Interpretation-16",
        effectiveDate: "2023-01-01",
      },
      metrics,
    };
    facts.push({
      id: `${options.sourceId}:${tablePage}:earnings.restatementContext`,
      field: "earnings.restatementContext",
      entity: document.entity,
      year: restatedYear,
      period: { start: `${restatedYear}-01-01`, end: `${restatedYear}-12-31` },
      publishedAt: document.publishedAt,
      basis: options.basis,
      unit: "text",
      state: "observed",
      value: JSON.stringify(context),
      evidence: [
        { sourceId: options.sourceId, locator: `/pages/${policyPage}/text`, raw: policy.text },
        { sourceId: options.sourceId, locator: `/pages/${tablePage}/text`, raw: table.text },
        {
          sourceId: options.sourceId,
          locator: `/pages/${balanceUnit.page}/lines/${balanceUnit.line}`,
          raw: document.pages[balanceUnit.page].lines[balanceUnit.line],
        },
        {
          sourceId: options.sourceId,
          locator: `/pages/${incomeUnit.page}/lines/${incomeUnit.line}`,
          raw: document.pages[incomeUnit.page].lines[incomeUnit.line],
        },
      ],
      reason:
        "explicit_CAS_interpretation_16_retrospective_consolidated_bridge;reported_unit:元人民币;only_listed_metrics_and_rested_year_are_bound",
    });
  }
  return facts;
}

interface NoteContext {
  cas: string;
  consolidated: string;
}
// 附注上下文把融资和转移事项限定在同一合并报表范围，避免跨页误绑定。
function consolidatedNoteContexts(document: DisclosureText): Map<string, Map<number, NoteContext>> {
  const year = Number(document.periodEnd.slice(0, 4));
  const contexts = new Map<string, Map<number, NoteContext>>();
  let previousPage: number | undefined;
  let cas: string | undefined;
  let consolidated: string | undefined;
  for (const [page, content] of Object.entries(document.pages).sort(
    ([a], [b]) => Number(a) - Number(b),
  )) {
    if (previousPage !== undefined && Number(page) !== previousPage + 1) {
      cas = undefined;
      consolidated = undefined;
    }
    previousPage = Number(page);
    if (!content.lines.slice(0, 3).some((line) => compact(line).includes(`${year}年年度报告`))) {
      cas = undefined;
      consolidated = undefined;
      continue;
    }
    const contextAt = new Map<number, NoteContext>();
    for (const [i, raw] of content.lines.entries()) {
      const line = compact(raw);
      if (/国际财务报告(?:会计)?准则|国际会计准则|IFRS/.test(line)) {
        cas = undefined;
        consolidated = undefined;
      }
      if (/^(?:[一二三四五六七八九十]+、)?母公司(?:财务)?报表/.test(line)) consolidated = undefined;
      if (
        /^\d+、遵循企业会计准则的声明$/.test(line) &&
        content.lines
          .slice(i + 1, i + 3)
          .map(compact)
          .join("")
          .startsWith("本公司所编制的财务报表符合企业会计准则的要求")
      ) {
        cas = `/pages/${page}/lines/${i}`;
        consolidated = undefined;
      }
      if (/^[一二三四五六七八九十]+、合并财务报表(?:主要)?项目注释$/.test(line) && cas)
        consolidated = `/pages/${page}/lines/${i}`;
      if (cas && consolidated) contextAt.set(i, { cas, consolidated });
    }
    contexts.set(page, contextAt);
  }
  return contexts;
}

function nonordinaryAbsenceFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
  contexts: ReturnType<typeof consolidatedNoteContexts>,
): FinancialFact[] {
  const year = Number(document.periodEnd.slice(0, 4));
  const facts: FinancialFact[] = [];
  for (const [page, content] of Object.entries(document.pages)) {
    const contextAt = contexts.get(page);
    if (!contextAt) continue;
    const heading = content.lines.findIndex((line) => /^\d+、其他权益工具$/.test(compact(line)));
    const context = contextAt.get(heading);
    if (heading < 0 || !context) continue;
    const nextHeading = content.lines.findIndex(
      (line, i) => i > heading && /^\d+、/.test(compact(line)),
    );
    const end = nextHeading < 0 ? content.lines.length : nextHeading;
    const checkboxAfter = (pattern: RegExp): number | undefined => {
      for (let i = heading + 1; i + 1 < end; i++) {
        const current = contextAt.get(i + 1);
        if (
          pattern.test(compact(content.lines[i])) &&
          compact(content.lines[i + 1]) === "□适用√不适用" &&
          current?.cas === context.cas &&
          current?.consolidated === context.consolidated
        )
          return i + 1;
      }
      return undefined;
    };
    const yearEnd = checkboxAfter(
      /^[（(]1[）)]\.期末发行在外的优先股、永续债等其他金融工具基本情况$/,
    );
    if (yearEnd === undefined) continue;
    const append = (field: string, lineIndex: number, annual: boolean, reason: string) =>
      facts.push({
        id: `${options.sourceId}:${page}:${lineIndex}:${field}`,
        field,
        entity: document.entity,
        year,
        period: { start: annual ? `${year}-01-01` : document.periodEnd, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "boolean",
        state: "observed",
        value: true,
        evidence: [
          {
            sourceId: options.sourceId,
            locator: `/pages/${page}/lines/${lineIndex}`,
            raw: content.lines[lineIndex],
          },
        ],
        reason: `${reason};CAS_declaration:${context.cas};consolidated_notes:${context.consolidated};continuous_pages_to:${page}`,
      });
    append(
      "nonordinaryEquityAbsentAtYearEnd",
      yearEnd,
      false,
      `explicit_other_equity_instruments_not_applicable;note_heading:/pages/${page}/lines/${heading}`,
    );
    const changesTable = checkboxAfter(
      /^[（(]2[）)]\.期末发行在外的优先股、永续债等金融工具变动情况表$/,
    );
    const annualChanges = checkboxAfter(
      /^其他权益工具本期增减变动情况、变动原因说明，以及相关会计处理的依据[：:]$/,
    );
    if (changesTable !== undefined && annualChanges !== undefined) {
      append(
        "nonordinaryClaimsAbsentDuringYear",
        annualChanges,
        true,
        `year_end_absent_and_reported_no_current_year_changes;year_end:/pages/${page}/lines/${yearEnd};changes:/pages/${page}/lines/${changesTable}`,
      );
    }
  }
  return facts;
}

/** First balance table in a named consolidated financing note; amounts keep their accounting role. */
function financingNoteFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
  contexts: ReturnType<typeof consolidatedNoteContexts>,
): FinancialFact[] {
  const totals: Record<string, string> = {
    短期借款: "shortBorrowings",
    长期借款: "longBorrowings",
    应付债券: "bondsPayable",
    租赁负债: "leaseLiabilities",
    一年内到期的非流动负债: "currentNoncurrentLiabilities",
    其他流动负债: "otherCurrentLiabilities",
    应付票据: "notesPayable",
    长期应付款: "longPayables",
  };
  const currentParts: Record<string, string> = {
    一年内到期的长期借款: "currentBorrowings",
    一年内到期的租赁负债: "currentLeaseLiabilities",
    一年内到期的长期应付款: "currentLongPayables",
    一年内到期的应付债券: "currentBondsPayable",
  };
  const facts: FinancialFact[] = [];
  const year = Number(document.periodEnd.slice(0, 4));
  let section: string | undefined,
    scale: number | undefined,
    columns = false,
    consumed = false,
    contextKey = "";
  let preceding = "";
  for (const [page, content] of Object.entries(document.pages).sort(
    ([a], [b]) => Number(a) - Number(b),
  ))
    for (const [i, raw] of content.lines.entries()) {
      const context = contexts.get(page)?.get(i);
      if (!context) {
        section = undefined;
        contextKey = "";
        continue;
      }
      const key = `${context.cas}:${context.consolidated}`;
      if (key !== contextKey) {
        section = undefined;
        contextKey = key;
      }
      const line = compact(raw).replaceAll("1年内", "一年内");
      const heading = line.match(/^\d+、(.+)$/);
      if (heading) {
        section = totals[heading[1]] ? heading[1] : undefined;
        scale = undefined;
        columns = false;
        consumed = false;
        preceding = line;
        continue;
      }
      if (!section || consumed) continue;
      const field = totals[section];
      const reason = `consolidated_financing_note:${section};CAS_declaration:${context.cas};consolidated_notes:${context.consolidated};continuous_pages_to:${page}`;
      // Only the named balance/classification subsection proves absence. A later
      // 'overdue loans: not applicable' cannot erase an existing loan balance.
      if (
        line === "□适用√不适用" &&
        (preceding.replace(/^\d+、/, "") === section ||
          (section === "长期应付款" && preceding === "项目列示") ||
          new RegExp(`^[（(]1[）)]\\.${section}(?:分类|列示)?$`).test(preceding))
      ) {
        facts.push({
          id: `${options.sourceId}:${page}:${i}:${field}:absent`,
          field: `${field}AbsentAtYearEnd`,
          entity: document.entity,
          year,
          period: { start: document.periodEnd, end: document.periodEnd },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "boolean",
          state: "observed",
          value: true,
          evidence: [{ sourceId: options.sourceId, locator: `/pages/${page}/lines/${i}`, raw }],
          reason,
        });
        consumed = true;
        continue;
      }
      preceding = line;
      const unit = line.match(/^单位[：:](元|千元|万元)币种[：:]人民币$/);
      if (/单位[：:]/.test(line)) {
        scale = unit
          ? { 元: 1, 千元: 1000, 万元: 10000 }[unit[1] as "元" | "千元" | "万元"]
          : undefined;
        continue;
      }
      if (/^(项目|种类)/.test(line)) {
        columns = /^(项目|种类)期末余额期初余额$/.test(line);
        continue;
      }
      if (!columns || !scale) continue;
      const values = raw.match(twoValues);
      if (!values) continue;
      const label = compact(values[1]).replaceAll("1年内", "一年内");
      const rowField =
        label === "合计"
          ? field
          : section === "一年内到期的非流动负债"
            ? currentParts[label]
            : undefined;
      if (!rowField) continue;
      for (const column of [0, 1]) {
        const value = Number(values[column + 2].replaceAll(",", "").replace(/[−－]/g, "-")) * scale;
        if (!Number.isFinite(value) || value < 0) continue;
        const fiscalYear = year - column;
        facts.push({
          id: `${options.sourceId}:${page}:${i}:note:${column}`,
          field: rowField,
          entity: document.entity,
          year: fiscalYear,
          period: { start: `${fiscalYear}-12-31`, end: `${fiscalYear}-12-31` },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "CNY",
          unitScale: scale,
          state: "observed",
          value,
          evidence: [{ sourceId: options.sourceId, locator: `/pages/${page}/lines/${i}`, raw }],
          reason,
        });
      }
      if (label === "合计") consumed = true;
    }
  return facts;
}

/** Transfer balances are observations, not proof of recourse or financing treatment. */
function transferredReceivableFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
  contexts: ReturnType<typeof consolidatedNoteContexts>,
): FinancialFact[] {
  const facts: FinancialFact[] = [];
  const year = Number(document.periodEnd.slice(0, 4));
  for (const [page, content] of Object.entries(document.pages)) {
    let active = false,
      scale: number | undefined,
      columns = false;
    for (const [i, raw] of content.lines.entries()) {
      const line = compact(raw),
        context = contexts.get(page)?.get(i);
      if (!context) {
        active = false;
        continue;
      }
      if (/^[（(]\d+[）)]\./.test(line)) {
        active = /期末公司已背书或贴现且在资产负债表日尚未到期的应收(?:款项融资|票据)$/.test(line);
        scale = undefined;
        columns = false;
        continue;
      }
      if (!active) continue;
      const unit = line.match(/^单位[：:](元|千元|万元)币种[：:]人民币$/);
      if (/单位[：:]/.test(line)) {
        scale = unit
          ? { 元: 1, 千元: 1000, 万元: 10000 }[unit[1] as "元" | "千元" | "万元"]
          : undefined;
        continue;
      }
      if (line.startsWith("项目")) {
        columns = line === "项目期末终止确认金额期末未终止确认金额";
        continue;
      }
      if (!columns || !scale) continue;
      const total = raw.match(
        new RegExp(`^合计\\s+(${numberToken}|—|-)\\s+(${numberToken}|—|-)\\s*$`),
      );
      if (!total) continue;
      active = false;
      if (!new RegExp(`^${numberToken}$`).test(total[1])) continue;
      const value = Number(total[1].replaceAll(",", "")) * scale;
      if (!Number.isFinite(value) || value < 0) continue;
      facts.push({
        id: `${options.sourceId}:${page}:${i}:derecognizedBills`,
        field: "derecognizedBills",
        entity: document.entity,
        year,
        period: { start: document.periodEnd, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "CNY",
        unitScale: scale,
        state: "observed",
        value,
        evidence: [{ sourceId: options.sourceId, locator: `/pages/${page}/lines/${i}`, raw }],
        reason: `unmatured_endorsed_or_discounted_receivables;recourse_not_inferred;CAS_declaration:${context.cas};consolidated_notes:${context.consolidated}`,
      });
    }
  }
  return facts;
}

/** The parent-company table explicitly identifies both positions and the restated opening regime. */
function brokerRegulatoryFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    reportYear = Number(document.periodEnd.slice(0, 4));
  const labels = [
    ["风险覆盖率", "riskCoverage"],
    ["资本杠杆率", "capitalLeverage"],
    ["流动性覆盖率", "lcr"],
    ["净稳定资金率", "nsfr"],
  ] as const;
  for (const [page, content] of Object.entries(document.pages)) {
    const heading = content.lines.findIndex((line) =>
      /母公司净资本及(?:有关)?风险控制指标/.test(compact(line)),
    );
    if (heading < 0) continue;
    const header = content.lines.findIndex(
      (line, i) =>
        i > heading && compact(line).startsWith(`项目${reportYear}年末${reportYear}年初`),
    );
    if (header < 0) continue;
    const table = content.lines.slice(header + 1).join(""),
      compactTable = compact(table);
    const regime = compactTable.match(/证监会公告〔(\d{4})〕(\d+)号/);
    // Without an explicit same-basis opening, do not manufacture a comparable regulatory context.
    if (
      !regime ||
      !compactTable.includes(`${reportYear}年初相关数据已根据${reportYear}年1月1日执行`) ||
      !compactTable.includes("口径进行调整")
    )
      continue;
    if (!compactTable.includes("《证券公司风险控制指标计算标准规定》")) continue;
    facts.push({
      id: `${options.sourceId}:${page}:business.licensedMethod`,
      field: "business.licensedMethod",
      entity: document.entity,
      year: reportYear,
      period: { start: `${reportYear}-01-01`, end: document.periodEnd },
      publishedAt: document.publishedAt,
      basis: options.basis,
      unit: "text",
      state: "observed",
      value: "broker",
      evidence: [{ sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text }],
      reason: "issuer_parent_table_under_explicit_securities_company_capital_rules",
    });
    const regimeId = `CSRC-${regime[1]}-${regime[2]}`;
    for (const [column, position] of [
      [1, "closing"],
      [2, "opening"],
    ] as const) {
      const year = position === "closing" ? reportYear : reportYear - 1,
        date = `${year}-12-31`;
      const context: RegulatoryContext = {
        subject: document.entity,
        scope: "legal_entity",
        regime: regimeId,
        reportYear,
        position,
        comparisonBasis: regimeId,
        liquidityMetrics: ["lcr", "nsfr"],
        metrics: {},
      };
      for (const [label, metric] of labels) {
        const candidates = content.lines.flatMap((raw, i) => {
          if (i <= header) return [];
          const match = raw
            .trim()
            .match(new RegExp(`^${label}\\s+(${numberToken})%\\s+(${numberToken})%(?:\\s|$)`));
          return match ? [{ raw, i, match }] : [];
        });
        if (candidates.length !== 1) continue;
        const { raw, i, match } = candidates[0],
          value = Number(match[column].replaceAll(",", "")) / 100;
        if (!Number.isFinite(value) || value < 0) continue;
        const id = `${options.sourceId}:${page}:${i}:regulatory:${position}:${metric}`;
        facts.push({
          id,
          field: `regulatory.actual.${metric}`,
          entity: document.entity,
          year,
          period: { start: date, end: date },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "ratio",
          state: "observed",
          value,
          evidence: [{ sourceId: options.sourceId, locator: `/pages/${page}/lines/${i}`, raw }],
        });
        context.metrics[metric] = {
          definition: regulatoryMetricDefinitions[metric],
          direction: "minimum",
          actualFactId: id,
        };
      }
      if (Object.keys(context.metrics).length)
        facts.push({
          id: `${options.sourceId}:${page}:regulatory-context:${position}`,
          field: "regulatory.context",
          entity: document.entity,
          year,
          period: { start: date, end: date },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "text",
          state: "observed",
          value: JSON.stringify(context),
          evidence: [
            { sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text },
          ],
          reason: "reported_parent_regulatory_table;applicable_requirements_not_inferred",
        });
    }
  }
  return facts;
}

type RegulatoryMetric = keyof typeof regulatoryMetricDefinitions;
const capitalLabels: Record<string, RegulatoryMetric> = {
  核心一级资本充足率: "cet1",
  一级资本充足率: "tier1",
  资本充足率: "totalCapital",
};

/** A raw table observation remains useful even when its regulatory scope is unresolved. */
function regulatoryRatioFact(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
  page: string,
  line: number,
  metric: RegulatoryMetric,
  year: number,
  value: string,
  kind: "actual" | "requirement" = "actual",
  reason = "",
): FinancialFact {
  const date = `${year}-12-31`;
  return {
    id: `${options.sourceId}:${page}:${line}:regulatory:${year}:${kind}:${metric}`,
    field: `regulatory.${kind}.${metric}`,
    entity: document.entity,
    year,
    period: { start: date, end: date },
    publishedAt: document.publishedAt,
    basis: options.basis,
    unit: "ratio",
    state: "observed",
    value: Number(value.replaceAll(",", "")) / 100,
    evidence: [
      {
        sourceId: options.sourceId,
        locator: `/pages/${page}/lines/${line}`,
        raw: document.pages[page].lines[line],
      },
    ],
    reason,
  };
}

function creditRegulatoryTableFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    reportYear = Number(document.periodEnd.slice(0, 4));
  const labels: Record<string, RegulatoryMetric> = {
    ...capitalLabels,
    "流动性比率(本外币)": "liquidityRatio",
    流动性覆盖率: "lcr",
    不良贷款比率: "loanNpl",
    拨备覆盖率: "loanProvisionCoverage",
  };
  for (const [page, content] of Object.entries(document.pages)) {
    const nsfrHeading = content.lines.findIndex((line) =>
      /^\d+、净稳定资金比例$/.test(compact(line)),
    );
    if (nsfrHeading >= 0) {
      const nsfrHeader = content.lines.findIndex(
        (line, i) => i > nsfrHeading && /^项目\d{4}年/.test(compact(line)),
      );
      if (nsfrHeader >= 0) {
        const dates = [
          ...compact(content.lines[nsfrHeader]).matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g),
        ];
        if (dates.length === 2)
          for (let i = nsfrHeader + 1; i < content.lines.length; i++) {
            const raw = content.lines[i];
            if (/^[（(一二三四五六七八九十]|^\d+、/.test(compact(raw))) break;
            const row = raw
              .trim()
              .match(new RegExp(`^净稳定资金比例\\s+(${numberToken})%\\s+(${numberToken})%\\s*$`));
            if (!row) continue;
            for (const [column, date] of dates.entries())
              if (date[2] === "12" && date[3] === "31" && Number(date[1]) <= reportYear)
                facts.push(
                  regulatoryRatioFact(
                    document,
                    options,
                    page,
                    i,
                    "nsfr",
                    Number(date[1]),
                    row[column + 1],
                    "actual",
                    "reported_dated_NSFR_table;scope_and_regime_unresolved",
                  ),
                );
            break;
          }
      }
    }
    const leaseHeader = content.lines.findIndex(
      (line) =>
        compact(line) ===
        `${reportYear}年末${reportYear - 1}年末本期末比上年同期末增减${reportYear - 2}年末`,
    );
    if (leaseHeader >= 0) {
      let section: "" | "capital" | "lease" = "";
      for (let i = leaseHeader + 1; i < content.lines.length; i++) {
        const line = compact(content.lines[i]);
        if (line === "资本充足率和杠杆率指标") {
          section = "capital";
          continue;
        }
        if (line === "融资租赁资产质量指标") {
          section = "lease";
          continue;
        }
        const row = content.lines[i]
          .trim()
          .match(
            new RegExp(
              `^(.*?)\\s+(${numberToken}|—|-)\\s+(${numberToken}|—|-)\\s+(?:减少|增加)\\s+${numberToken}\\s+个百分点\\s+(${numberToken}|—|-)\\s*$`,
            ),
          );
        if (!row) {
          section = "";
          continue;
        }
        const label = compact(row[1]).replaceAll("（", "(").replaceAll("）", ")");
        if (!label.endsWith("(%)")) continue;
        const name = label.slice(0, -3),
          metric =
            section === "capital"
              ? capitalLabels[name]
              : section === "lease"
                ? (
                    {
                      不良融资租赁资产率: "leaseNpl",
                      拨备覆盖率: "leaseProvisionCoverage",
                    } as Record<string, RegulatoryMetric>
                  )[name]
                : undefined;
        if (!metric) continue;
        for (const [column, year] of [reportYear, reportYear - 1, reportYear - 2].entries())
          if (new RegExp(`^${numberToken}$`).test(row[column + 2]))
            facts.push(
              regulatoryRatioFact(
                document,
                options,
                page,
                i,
                metric,
                year,
                row[column + 2],
                "actual",
                "reported_year_end_table;change_column_excluded;scope_and_regime_unresolved",
              ),
            );
      }
    }
    const header = content.lines.findIndex((line) => compact(line).startsWith("监管指标监管标准"));
    if (header < 0) continue;
    const years = [...compact(content.lines[header]).matchAll(/(\d{4})年12月31日/g)].map((m) =>
      Number(m[1]),
    );
    if (years.length !== 3 || new Set(years).size !== 3 || !years.includes(reportYear)) continue;
    for (let i = header + 1; i < content.lines.length; i++) {
      const raw = content.lines[i];
      const row = raw
        .trim()
        .match(
          new RegExp(
            `^(.*?)\\s+(?:(≥|≤)(${numberToken})|—|-|不适用)\\s+(${numberToken}|—|-)\\s+(${numberToken}|—|-)\\s+(${numberToken}|—|-)\\s*$`,
          ),
        );
      if (!row) continue;
      const label = compact(row[1]).replaceAll("（", "(").replaceAll("）", ")");
      if (!label.endsWith("(%)")) continue;
      const metric = labels[label.slice(0, -3)];
      if (!metric) continue;
      const direction = row[2] === "≥" ? "minimum" : "maximum";
      for (const [column, year] of years.entries())
        if (new RegExp(`^${numberToken}$`).test(row[column + 4]))
          facts.push(
            regulatoryRatioFact(
              document,
              options,
              page,
              i,
              metric,
              year,
              row[column + 4],
              "actual",
              "reported_regulatory_table;scope_and_regime_unresolved",
            ),
          );
      if (row[3])
        facts.push(
          regulatoryRatioFact(
            document,
            options,
            page,
            i,
            metric,
            reportYear,
            row[3],
            "requirement",
            `reported_current_standard;direction:${direction};historical_applicability_not_inferred;scope_and_regime_unresolved`,
          ),
        );
    }
  }
  // Credit and bank-liquidity ratios in these already-supported report tables
  // are usable reported observations even when the separate capital
  // scope/regime is unresolved. Keep the original observations as well;
  // neither alias claims a group scope or capital-regime applicability.
  const reported = new Set([
    "loanNpl",
    "loanProvisionCoverage",
    "leaseNpl",
    "leaseProvisionCoverage",
    "lcr",
    "nsfr",
  ]);
  const aliases = facts.flatMap((f) => {
    const match = /^regulatory\.(actual|requirement)\.(.+)$/.exec(f.field);
    if (!match || !reported.has(match[2])) return [];
    return [
      {
        ...f,
        id: `${f.id}:reported`,
        field: `reportedFinancial.${match[1] === "requirement" ? "requirement." : ""}${match[2]}`,
        reason: `${f.reason};reported_${["lcr", "nsfr"].includes(match[2]) ? "bank_liquidity" : "credit"}_ratio;scope_not_asserted`,
      },
    ];
  });
  return [...facts, ...aliases];
}

/** Capital notes identify their regulatory group separately from financial highlights. */
function capitalRegulatoryNoteFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    reportYear = Number(document.periodEnd.slice(0, 4));
  for (const [page, content] of Object.entries(document.pages)) {
    const first = content.lines.findIndex((line) => /^核心一级资本充足率\s+/.test(line.trim()));
    if (first < 0) continue;
    const prefix = compact(content.lines.slice(0, first).join(""));
    const priorPage = String(Number(page) - 1),
      prior =
        /资本管理[（(]续[）)]/.test(prefix) && !/母公司|本公司/.test(prefix)
          ? document.pages[priorPage]
          : undefined;
    const passage = compact((prior?.lines.join("") ?? "") + content.lines.slice(0, first).join(""));
    if (!passage.includes("资本管理") || prefix.includes("并表非并表")) continue;
    const dates = [...prefix.matchAll(/(\d{4})年12月31日/g)].map((m) => Number(m[1]));
    if (
      dates.length !== 2 ||
      new Set(dates).size !== 2 ||
      !dates.includes(reportYear) ||
      !dates.includes(reportYear - 1)
    )
      continue;
    const scopeMatch = passage.match(
      /本(集团|公司)(?:按照|依据)[^。]*《商业银行资本管理办法》[^。]*计算的[^。]*资本充足率如下[：:]/,
    );
    const scope =
      scopeMatch?.[1] === "集团"
        ? "regulatory_consolidated"
        : scopeMatch?.[1] === "公司"
          ? "legal_entity"
          : undefined;
    const version = scopeMatch?.[0].match(/2023年第4号/)
      ? "NFRA-2023-4"
      : /自2024年起，本(?:集团|公司)按照《商业银行资本管理办法》/.test(passage)
        ? "商业银行资本管理办法:2024起"
        : undefined;
    for (const [column, year] of dates.entries()) {
      const context: RegulatoryContext | undefined =
        scope && version
          ? {
              subject: document.entity,
              scope,
              regime: version,
              reportYear: year,
              position: "closing",
              comparisonBasis: version,
              liquidityMetrics: [],
              metrics: {},
            }
          : undefined;
      for (const [label, metric] of Object.entries(capitalLabels)) {
        const rows = content.lines.flatMap((raw, i) => {
          if (i < first) return [];
          const match = raw
            .trim()
            .match(new RegExp(`^${label}\\s+(${numberToken}%|—|-)\\s+(${numberToken}%|—|-)\\s*$`));
          // A percent sign belongs to each numeric cell; currency amounts never become ratios.
          return match ? [{ i, match: match.map((v) => v.replace(/%$/, "")) }] : [];
        });
        if (rows.length !== 1 || !new RegExp(`^${numberToken}$`).test(rows[0].match[column + 1]))
          continue;
        const { i, match } = rows[0],
          actual = regulatoryRatioFact(
            document,
            options,
            page,
            i,
            metric,
            year,
            match[column + 1],
            "actual",
            `reported_capital_note;scope:${scope ?? "unresolved"};regime:${version ?? "unresolved"}`,
          );
        facts.push(actual);
        if (context)
          context.metrics[metric] = {
            definition: regulatoryMetricDefinitions[metric],
            direction: "minimum",
            actualFactId: actual.id,
          };
        // This sentence describes the report period; it does not backdate the minimum.
        const requirement = passage.match(
          new RegExp(`(?:^|[，。；：]|其)${label}不得低于(${numberToken})%`),
        );
        if (year === reportYear && requirement) {
          const sourcePage = prior?.lines.some((l) => compact(l).includes(requirement[1]))
            ? priorPage
            : page;
          const line = document.pages[sourcePage].lines.findIndex((l) =>
            compact(l).includes(requirement[1]),
          );
          if (line >= 0) {
            const fact = regulatoryRatioFact(
              document,
              options,
              sourcePage,
              line,
              metric,
              year,
              requirement[1],
              "requirement",
              "reported_current_capital_requirement;direction:minimum",
            );
            facts.push(fact);
            if (context) context.metrics[metric].requirementFactId = fact.id;
          }
        }
      }
      if (context && Object.keys(context.metrics).length) {
        const date = `${year}-12-31`;
        facts.push({
          id: `${options.sourceId}:${page}:capital-context:${year}`,
          field: "regulatory.context",
          entity: document.entity,
          year,
          period: { start: date, end: date },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "text",
          state: "observed",
          value: JSON.stringify(context),
          evidence: [
            ...(prior
              ? [
                  {
                    sourceId: options.sourceId,
                    locator: `/pages/${priorPage}/text`,
                    raw: prior.text,
                  },
                ]
              : []),
            { sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text },
          ],
          reason: "reported_capital_scope_and_regime;credit_and_liquidity_applicability_unresolved",
        });
      }
    }
  }
  return facts;
}

/** Conservative two-column annual statement reader. Ambiguous or blank cells stay absent. */
// 汇集专项事实后，再读取标准两列表；歧义单元格保持缺失而不是猜测补齐。
export function parseCnDisclosureFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  if (!/^\d{4}-12-31$/.test(document.periodEnd)) return [];
  const reportYear = Number(document.periodEnd.slice(0, 4));
  const contexts = consolidatedNoteContexts(document);
  const facts: FinancialFact[] = [
    ...parseCnInsuranceFacts(document, options),
    ...parseCnOtherFinancialFacts(document, options),
    ...futuresRegulatoryFacts(document, options),
    ...primaryActivityFacts(document, options),
    ...businessBreakdownFacts(document, options),
    ...businessSegmentFacts(document, options),
    ...licensedBusinessFacts(document, options),
    ...ordinaryProfitFacts(document, options),
    ...ordinaryReturnFacts(document, options),
    ...accountingPolicyRestatementFacts(document, options),
    ...nonordinaryAbsenceFacts(document, options, contexts),
    ...financingNoteFacts(document, options, contexts),
    ...transferredReceivableFacts(document, options, contexts),
    ...brokerRegulatoryFacts(document, options),
    ...creditRegulatoryTableFacts(document, options),
    ...capitalRegulatoryNoteFacts(document, options),
  ];
  let table: Table | undefined;
  let previousPage: number | undefined;
  let pendingLabel = "";
  for (const [page, content] of Object.entries(document.pages).sort(
    ([a], [b]) => Number(a) - Number(b),
  )) {
    if (previousPage !== undefined && Number(page) !== previousPage + 1) table = undefined;
    previousPage = Number(page);
    pendingLabel = "";
    for (const [lineIndex, raw] of content.lines.entries()) {
      const line = compact(raw);
      const title = line.match(/^合并(资产负债表|利润表|现金流量表)(?:[（(]续[）)])?$/);
      if (title) {
        table = {
          kind:
            title[1] === "资产负债表" ? "balance" : title[1] === "利润表" ? "income" : "cashflow",
        };
        pendingLabel = "";
        continue;
      }
      if (/^(母公司.*表|合并所有者权益变动表|公司负责人[：:])/.test(line)) {
        table = undefined;
        pendingLabel = "";
        continue;
      }
      if (!table) continue;
      if (/单位[：:]/.test(line)) {
        const unit = line.match(/单位[：:](元|千元|万元)币种[：:]人民币$/);
        table.scale = unit
          ? { 元: 1, 千元: 1_000, 万元: 10_000 }[unit[1] as "元" | "千元" | "万元"]
          : undefined;
        table.originalUnit = unit?.[1];
        continue;
      }
      if (/^项目/.test(line)) {
        table.hasNotes = line.includes("附注");
        const pattern = table.kind === "balance" ? /(\d{4})年12月31日/g : /(\d{4})年度/g;
        const years = [...line.matchAll(pattern)].map((m) => Number(m[1]));
        table.years =
          years.length === 2 &&
          new Set(years).size === 2 &&
          years.includes(reportYear) &&
          years.includes(reportYear - 1)
            ? years
            : undefined;
        continue;
      }
      if (!table.years || !table.scale || !line) {
        pendingLabel = "";
        continue;
      }
      const values = raw.match(twoValues);
      if (!values) {
        pendingLabel = line;
        continue;
      }
      // Numeric notes must not become a data column. Only an explicit Chinese note is removed.
      const explicitNote = /[一二三四五六七八九十]+[（(]\d+[）)]$/;
      const hasExplicitNote = explicitNote.test(compact(values[1]));
      if (table.hasNotes && !hasExplicitNote && /^[1-9]\d*$/.test(values[2])) {
        pendingLabel = "";
        continue;
      }
      const rowLabel = compact(values[1]).replace(explicitNote, "");
      const field = fieldFor(table.kind, rowLabel) ?? fieldFor(table.kind, pendingLabel + rowLabel);
      pendingLabel = "";
      if (!field) continue;
      for (const [column, year] of table.years.entries()) {
        const value =
          Number(values[column + 2].replace(/,/g, "").replace(/[−－]/g, "-")) * table.scale;
        if (!Number.isFinite(value)) continue;
        facts.push({
          id: `${options.sourceId}:${page}:${lineIndex}:${column}`,
          field,
          entity: document.entity,
          year,
          period: {
            start: table.kind === "balance" ? `${year}-12-31` : `${year}-01-01`,
            end: `${year}-12-31`,
          },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "CNY",
          unitScale: table.scale,
          state: "observed",
          value,
          evidence: [
            { sourceId: options.sourceId, locator: `/pages/${page}/lines/${lineIndex}`, raw },
          ],
          reason: `consolidated_${table.kind};reported_unit:${table.originalUnit};column:${column + 1}`,
        });
      }
    }
  }
  return facts;
}

/** Formal issuer risk tables use the own-funds definitions of the named futures risk-indicator rules. */
// 期货监管表只绑定发行人自身、具名规则和报告内期间；历史可比性仍需另行证明。
function futuresRegulatoryFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [],
    year = Number(document.periodEnd.slice(0, 4));
  const normalized = (v: string) => v.normalize("NFKC").replace(/\s/g, "");
  if (!/^\d{6}$/.test(document.entity)) return facts;
  const pages = Object.entries(document.pages);
  let identity = pages.find(
    ([, p]) =>
      normalized(p.text).includes(`股票代码${document.entity}`) &&
      normalized(p.text).includes("公司的中文名称"),
  );
  const short =
    identity &&
    normalized(identity[1].text).match(new RegExp(`股票简称(.+?)股票代码${document.entity}`))?.[1];
  let license = short
    ? pages.find(([, p]) => {
        const text = normalized(p.text),
          start = text.indexOf(`母公司${short}获取的各项业务资格`);
        return (
          start >= 0 && text.slice(start).split("(二)子公司")[0].includes("《经营期货业务许可证》")
        );
      })
    : undefined;
  if (!license)
    for (const info of pages.filter(([page]) => Number(page) <= 10)) {
      const text = normalized(info[1].text),
        name = text.match(/公司的中文名称(.+?)公司的中文简称(.+?)公司的外文名称/);
      if (!name || !text.includes("公司的各单项业务资格情况")) continue;
      const cover = pages.find(
        ([page, p]) =>
          Number(page) <= 10 &&
          normalized(p.text).includes(`${name[1]}${year}年年度报告`) &&
          normalized(p.text).includes(`公司代码:${document.entity}公司简称:${name[2]}`),
      );
      const own = text
        .split("公司的各单项业务资格情况")[1]
        .split(/\(二\)公司境内子公司|子公司业务资质/)[0];
      const scope =
        own.match(/(?:^|[。;])公司经营范围为:([^。]+)/)?.[1] ??
        own.match(/^√适用□不适用公司经营范围为:([^。]+)/)?.[1];
      const ownLicense = /(?:^|。)公司持有中国证监会颁发的《经营(?:证券)?期货业务许可证》/.test(
        own,
      );
      if (
        cover &&
        scope?.includes("商品期货经纪") &&
        scope.includes("金融期货经纪") &&
        ownLicense
      ) {
        identity = cover;
        license = info;
        break;
      }
    }
  if (!identity || !license) return facts;
  const evidence = (numbers: string[]) =>
    [...new Set(numbers)].map((page) => ({
      sourceId: options.sourceId,
      locator: `/pages/${page}/text`,
      raw: document.pages[page].text,
    }));
  facts.push({
    id: `${options.sourceId}:${license[0]}:business.licensedMethod`,
    field: "business.licensedMethod",
    entity: document.entity,
    year,
    period: { start: `${year}-01-01`, end: document.periodEnd },
    publishedAt: document.publishedAt,
    basis: options.basis,
    unit: "text",
    state: "observed",
    value: "futures",
    evidence: evidence([identity[0], license[0]]),
    reason: "issuer_identity_and_own_futures_license;subsidiary_risks_not_certified",
  });
  for (const [page, content] of pages) {
    const text = normalized(content.text);
    if (
      !text.includes("《期货公司风险监管指标管理办法》") ||
      !text.includes("报告期内,公司各月末各项风险指标情况如下") ||
      !text.includes(`${year}年年度报告`)
    )
      continue;
    const expected = [
      "项目",
      "监管指标",
      "预警指标",
      ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
    ];
    const matchingTables =
      content.tables?.flatMap((table, index) =>
        JSON.stringify(table[0]?.map(normalized)) === JSON.stringify(expected) ? [index] : [],
      ) ?? [];
    if (matchingTables.length !== 1) continue;
    const tableIndex = matchingTables[0];
    const rows = content
      .tables![tableIndex].slice(1)
      .map((row, i) => ({ row, page, table: tableIndex, index: i + 1 }));
    const next = String(Number(page) + 1),
      continuation = document.pages[next]?.tables?.[0];
    if (continuation?.length === 1 && normalized(continuation[0][0]) === "结算准备金金额(万元)")
      rows.push({ row: continuation[0], page: next, table: 0, index: 0 });
    const context: RegulatoryContext = {
      subject: document.entity,
      scope: "legal_entity",
      assetScope: "own_funds_excluding_client_assets",
      regime: `issuer-disclosed-futures-capital-requirements:${year}`,
      reportYear: year,
      position: "closing",
      comparisonBasis: "report-specific-futures-capital",
      liquidityMetrics: ["ownLiquidityRatio"],
      metrics: {},
    };
    const labels: Record<
      string,
      {
        metric: keyof typeof regulatoryMetricDefinitions;
        amount?: boolean;
        warning?: boolean;
        maximum?: boolean;
      }
    > = {
      "净资本(万元)": { metric: "netCapital", amount: true, warning: true },
      "净资本/风险资本总额(%)": { metric: "futuresRiskCoverage" },
      "净资本/净资产(%)": { metric: "netCapitalEquity", warning: true },
      "流动资产/流动负债(%)": { metric: "ownLiquidityRatio", warning: true },
      "负债/净资产(%)": { metric: "ownDebtEquity", warning: true, maximum: true },
      "结算准备金金额(万元)": { metric: "ownSettlementReserve", amount: true },
    };
    let duplicate = false;
    const seenMetrics = new Set<string>();
    for (const r of rows) {
      const item = labels[normalized(r.row[0])];
      if (!item) continue;
      if (seenMetrics.has(item.metric)) duplicate = true;
      seenMetrics.add(item.metric);
      if (r.row.length !== 15) continue;
      const direction = item.maximum ? "maximum" : "minimum",
        operator = item.maximum ? "≤" : "≥";
      if (!normalized(r.row[1]).startsWith(operator)) continue;
      if (context.metrics[item.metric]) {
        duplicate = true;
        continue;
      }
      const ids: string[] = [];
      for (const [kind, column] of [
        ["actual", 14],
        ["requirement", item.warning ? 2 : 1],
      ] as const) {
        const raw = r.row[column],
          cell = normalized(raw);
        // A bound on an actual observation is not an exact value. Requirements may
        // carry only the comparator consistent with this indicator's direction.
        const valueText =
          kind === "requirement" && cell.startsWith(operator) ? cell.slice(1) : cell;
        if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(valueText)) continue;
        const scale = item.amount ? 10000 : 0.01,
          value = Number(valueText.replaceAll(",", "")) * scale,
          id = `${options.sourceId}:${r.page}:${r.table}:${r.index}:${column}:${kind}:${item.metric}`;
        facts.push({
          id,
          field: `regulatory.${kind}.${item.metric}`,
          entity: document.entity,
          year,
          period: { start: document.periodEnd, end: document.periodEnd },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: item.amount ? "CNY" : "ratio",
          unitScale: scale,
          state: "observed",
          value,
          evidence: [
            {
              sourceId: options.sourceId,
              locator: `/pages/${r.page}/tables/${r.table}/${r.index}/${column}`,
              raw,
            },
          ],
          reason:
            "reported_December_regulatory_table_cell;own_funds_by_named_regulatory_indicator_definition",
        });
        ids.push(id);
      }
      if (ids.length === 2)
        context.metrics[item.metric] = {
          definition: regulatoryMetricDefinitions[item.metric],
          direction,
          actualFactId: ids[0],
          requirementFactId: ids[1],
          requirementKind: item.warning ? "warning" : "regulatory",
        };
    }
    if (Object.keys(context.metrics).length && !duplicate)
      facts.push({
        id: `${options.sourceId}:${page}:futures-regulatory.context`,
        field: "regulatory.context",
        entity: document.entity,
        year,
        period: { start: document.periodEnd, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify(context),
        evidence: evidence([identity[0], license[0], page, ...rows.map((r) => r.page)]),
        reason:
          "formal_issuer_risk_table_under_named_futures_rules;legislative_revision_not_identified;no_historical_comparability_assertion",
      });
  }
  // An annual mother-company table is useful even when it omits the regulatory
  // and warning columns. Its observations do not establish client-asset scope.
  if (pages.some(([, p]) => normalized(p.text).includes(`报告期末指${year}年12月31日`)))
    for (const [page, content] of pages) {
      const title = content.lines.findIndex((l) =>
        /^\(三\)母公司的净资本及风险控制指标$/.test(normalized(l)),
      );
      if (title < 0 || !normalized(content.text).includes(`${year}年年度报告`)) continue;
      const header = content.lines.findIndex(
        (l, i) => i > title && normalized(l) === "项目本报告期末上年度末",
      );
      if (
        header < 0 ||
        !content.lines.slice(title, header).some((l) => normalized(l) === "单位:元币种:人民币")
      )
        continue;
      const labels: Record<
        string,
        { metric: keyof typeof regulatoryMetricDefinitions; amount?: boolean; maximum?: boolean }
      > = {
        净资本: { metric: "netCapital", amount: true },
        "(净资本/风险资本准备总额)(%)": { metric: "futuresRiskCoverage" },
        "净资本与净资产的比例(%)": { metric: "netCapitalEquity" },
        "流动资产与流动负债的比例(%)": { metric: "ownLiquidityRatio" },
        "负债与净资产的比例(%)": { metric: "ownDebtEquity", maximum: true },
        结算准备金额: { metric: "ownSettlementReserve", amount: true },
      };
      const bindings: RegulatoryContext["metrics"][] = [{}, {}],
        seen = new Set<string>();
      let duplicate = false;
      for (let i = header + 1; i < content.lines.length; i++) {
        const raw = content.lines[i];
        if (/^[一二三四五六七八九十]+、/.test(normalized(raw))) break;
        const values = raw.match(twoValues),
          item = values && labels[normalized(values[1])];
        if (!values || !item) continue;
        if (seen.has(item.metric)) duplicate = true;
        seen.add(item.metric);
        for (const column of [0, 1]) {
          const actualYear = year - column,
            scale = item.amount ? 1 : 0.01,
            value = Number(values[column + 2].replaceAll(",", "").replace(/[−－]/g, "-")) * scale,
            id = `${options.sourceId}:${page}:${i}:${column}:annual-futures:${item.metric}`;
          facts.push({
            id,
            field: `regulatory.actual.${item.metric}`,
            entity: document.entity,
            year: actualYear,
            period: { start: `${actualYear}-12-31`, end: `${actualYear}-12-31` },
            publishedAt: document.publishedAt,
            basis: options.basis,
            unit: item.amount ? "CNY" : "ratio",
            unitScale: scale,
            state: "observed",
            value,
            evidence: [{ sourceId: options.sourceId, locator: `/pages/${page}/lines/${i}`, raw }],
            reason:
              "reported_parent_annual_risk_table;client_asset_scope_and_applicable_requirements_not_established",
          });
          bindings[column][item.metric] = {
            definition: regulatoryMetricDefinitions[item.metric],
            direction: item.maximum ? "maximum" : "minimum",
            actualFactId: id,
          };
        }
      }
      const regime = pages.flatMap(([number, p]) => {
        const match = normalized(p.text).match(
          new RegExp(
            `${year}年度本公司按照中国证券监督管理委员会《期货公司风险监管指标管理办法》\\(证监会令〔第(\\d+)号〕\\)的要求计算净资本,母公司净资本为([\\d,.]+)元`,
          ),
        );
        return match
          ? [{ page: number, version: match[1], netCapital: Number(match[2].replaceAll(",", "")) }]
          : [];
      });
      const actual = facts.find((f) => f.id === bindings[0].netCapital?.actualFactId);
      if (duplicate || regime.length !== 1 || actual?.value !== regime[0].netCapital) continue;
      for (const column of [0, 1]) {
        const actualYear = year - column,
          context: RegulatoryContext = {
            subject: document.entity,
            scope: "legal_entity",
            regime: `CSRC-${regime[0].version}`,
            reportYear: year,
            position: column === 0 ? "closing" : "opening",
            comparisonBasis: `report-specific-futures-capital:${year}`,
            liquidityMetrics: ["ownLiquidityRatio"],
            metrics: bindings[column],
          };
        facts.push({
          id: `${options.sourceId}:${page}:annual-futures-context:${actualYear}`,
          field: "regulatory.context",
          entity: document.entity,
          year: actualYear,
          period: { start: `${actualYear}-12-31`, end: `${actualYear}-12-31` },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "text",
          state: "observed",
          value: JSON.stringify(context),
          evidence: evidence([identity[0], license[0], page, regime[0].page]),
          reason:
            "issuer_parent_annual_table_and_named_net_capital_regime;client_asset_scope_and_applicable_requirements_unresolved;prior_comparison_not_original_prior_regime",
        });
      }
    }
  return facts;
}
