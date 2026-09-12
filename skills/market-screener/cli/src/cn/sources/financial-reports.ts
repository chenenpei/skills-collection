/**
 * 金融年报来源：提取保险经营、偿付能力及其他金融监管表中的可靠事实。
 * 保险、信托、期货各自保持原披露口径；券商监管参考与公司实际值分别绑定来源。
 */
import {
  type FinancialFact,
  regulatoryMetricDefinitions,
  insuranceOperatingDefinitions,
  type RegulatoryContext,
  type InsuranceContext,
  type CompanyFacts,
  regulatoryContextSchema,
} from "../../shared/financial-model.js";
import { type DisclosureText } from "./annual-reports.js";

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { type EvidenceInput } from "../evidence.js";
import { CLI_ROOT } from "../../shared/runtime.js";

// 保险经营与偿付能力：仅解析已识别且口径完整的披露表格。

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
const compact = (text: string) => text.replace(/\s/g, "");
const decimal = "[−－-]?\\d+(?:\\.\\d+)?";
const ratioRows = [
  ["coreSolvency", "Core solvency margin ratio"],
  ["comprehensiveSolvency", "Comprehensive solvency margin ratio"],
] as const;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const insuranceServiceRows = [
  ["保险服务收入", "insurance.serviceRevenue"],
  ["保险服务费用", "insurance.serviceExpense"],
  ["分出保费的分摊", "insurance.reinsuranceAllocation"],
  ["减：摊回保险服务费用", "insurance.reinsuranceRecovery"],
] as const;
const cnyMillions = "（除特别注明外，金额单位为人民币百万元）";

function amount(text: string): number | undefined {
  if (!/^(?:\([\d,]+(?:\.\d+)?\)|[−－-]?[\d,]+(?:\.\d+)?)$/.test(text)) return;
  const value = Number(
    text
      .replaceAll(",", "")
      .replace(/^\((.*)\)$/, "-$1")
      .replace(/[−－]/g, "-"),
  );
  return Number.isFinite(value) ? value : undefined;
}

/** A complete consolidated income-statement quartet, never a liability roll-forward or company-only statement. */
// 仅接受标题、单位和年度列完整匹配的合并利润表四项。
function insuranceServiceStatementFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [];
  for (const [page, content] of Object.entries(document.pages)) {
    const lines = content.lines,
      title = lines.findIndex(
        (line) => /^20\d{2}年度合并利润表$/.test(compact(line)) || compact(line) === "合并利润表",
      );
    const unit = lines.findIndex((line) => compact(line) === cnyMillions);
    if (title < 0 || unit < 0 || unit < title || unit - title > 3) continue;
    const header = lines.findIndex(
      (line, index) =>
        index > unit && index <= unit + 3 && /20\d{2}年度\s+20\d{2}年度/.test(normalized(line)),
    );
    if (header < 0) continue;
    const years = [...normalized(lines[header]).matchAll(/(20\d{2})年度/g)].map((match) =>
      Number(match[1]),
    );
    if (
      ![2, 3].includes(years.length) ||
      new Set(years).size !== years.length ||
      years.some((year) => year > Number(document.periodEnd.slice(0, 4)))
    )
      continue;
    const rows = new Map<string, { line: number; values: number[] }>();
    let duplicate = false;
    for (let i = header + 1; i < lines.length; i++) {
      const raw = lines[i],
        line = normalized(raw).replace(/\s*：\s*/g, "："),
        compactLine = compact(raw);
      if (/^三、|^三\.|^三\s/.test(compactLine)) break;
      for (const [label, field] of insuranceServiceRows) {
        if (!compactLine.startsWith(label)) continue;
        const tail = line.slice(label.length).trim();
        const tokens = tail.split(/\s+/).filter(Boolean);
        const valueTokens =
          tokens.length === years.length + 1 && /^\d+(?:\(\d+\))?$/.test(tokens[0])
            ? tokens.slice(1)
            : tokens;
        const values = valueTokens
          .map(amount)
          .filter((value): value is number => value !== undefined);
        // The optional note token precedes exactly the explicitly headed annual columns.
        if (valueTokens.length !== years.length || values.length !== years.length) continue;
        if (rows.has(field)) duplicate = true;
        rows.set(field, { line: i, values });
      }
    }
    if (duplicate || rows.size !== insuranceServiceRows.length) continue;
    for (const [field, { line, values }] of rows)
      for (const [column, year] of years.entries()) {
        const value = values[column] * 1_000_000;
        facts.push({
          id: `${options.sourceId}:${page}:${line}:${year}:${field}`,
          field,
          entity: document.entity,
          year,
          period: { start: `${year}-01-01`, end: `${year}-12-31` },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "CNY",
          unitScale: 1_000_000,
          state: "observed",
          value,
          evidence: [
            {
              sourceId: options.sourceId,
              locator: `/pages/${page}/lines/${line}`,
              raw: lines[line],
            },
          ],
          reason:
            "reported_consolidated_income_statement_insurance_service_operand;reported_unit:RMB_million",
        });
      }
  }
  return facts;
}

/** A three-year summary explicitly says the issuer restated its insurance-contract information under CAS 25. */
function issuerCas25RestatementFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [];
  const reportYear = Number(document.periodEnd.slice(0, 4));
  // This observed declaration covers the 2023 restatement in the 2025
  // three-year summary; it cannot certify an earlier or rolling future window.
  if (document.periodEnd !== "2025-12-31") return facts;
  for (const [page, content] of Object.entries(document.pages)) {
    const text = compact(content.text);
    const declaration = content.lines.findIndex(
      (line) =>
        compact(line).includes(
          "对于2023年保险合同相关信息，本公司根据《企业会计准则第25号－保险合同》（财会〔2020〕20号）",
        ) && compact(line).includes("重述列报"),
    );
    if (declaration < 0 || !text.includes("近三年主要财务数据和财务指标")) continue;
    const years = [...text.matchAll(/20\d{2}年/g)].map((match) => Number(match[0].slice(0, 4)));
    const expected = [reportYear - 2, reportYear - 1, reportYear];
    if (!expected.every((year) => years.includes(year))) continue;
    for (const year of expected)
      facts.push({
        id: `${options.sourceId}:${page}:${declaration}:${year}:insurance.accountingBasis`,
        field: "insurance.accountingBasis",
        entity: document.entity,
        year,
        period: { start: `${year}-01-01`, end: `${year}-12-31` },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: "CAS25-2023",
        evidence: [
          {
            sourceId: options.sourceId,
            locator: `/pages/${page}/lines/${declaration}`,
            raw: content.lines[declaration],
          },
        ],
        reason:
          "issuer_three_year_summary_explicitly_restated_2023_insurance_contract_information_under_CAS25_2020",
      });
  }
  return facts;
}

/** A group policy statement identifies the CAS 25 insurance-contract basis, not a subsidiary result. */
// 会计政策必须同时指向集团、CAS 25 版本和采用语境，不能由相近措辞推断。
function groupInsuranceAccountingBasis(
  document: DisclosureText,
): { page: string; line: number; transition?: { page: string; line: number } } | undefined {
  const lines = Object.entries(document.pages).flatMap(([page, content]) =>
    content.lines.map((line, index) => ({
      page,
      line,
      index,
      value: compact(line),
      continued: compact(content.lines[index + 1] ?? ""),
    })),
  );
  const mentions = lines.filter(
    ({ value }) =>
      value.includes("本集团") &&
      (value.includes("企业会计准则第25号") || value.includes("新保险合同准则")),
  );
  const futureOrUnadopted = mentions.some(({ value }) =>
    /计划|拟|将于|尚未|未采用|未执行|不再采用/.test(value),
  );
  const policyReferences = mentions.filter(
    ({ value }) => value.includes("企业会计准则第25号") && value.includes("保险合同"),
  );
  const cas25Version = /财会(?:\[|〔)2020(?:\]|〕)20号/;
  const hasConflictingVersion = policyReferences.some(({ value }) => !cas25Version.test(value));
  // PDF text can wrap “保险合同相关的会计政策” after the source line that names CAS 25.
  const policies = policyReferences.filter(
    ({ value, continued }) =>
      cas25Version.test(value) &&
      value.includes("制定了") &&
      `${value}${continued}`.includes("会计政策") &&
      !value.includes("原保险合同"),
  );
  const adoptionDates = new Set(
    mentions
      .filter(({ value }) => /开始执行|开始采用|执行新保险合同准则|采用新保险合同准则/.test(value))
      .map(({ value }) => value.match(/20\d{2}年\d{1,2}月\d{1,2}日/)?.[0])
      .filter((date): date is string => !!date),
  );
  if (futureOrUnadopted || hasConflictingVersion || adoptionDates.size > 1 || !policies.length)
    return;
  const policy = policies[0];
  const transition = mentions.find(({ value }) =>
    value.includes("本集团于2023年1月1日开始执行新保险合同准则"),
  );
  return {
    page: policy.page,
    line: policy.index,
    ...(transition ? { transition: { page: transition.page, line: transition.index } } : {}),
  };
}

/** A direct insurer's own capital table. The precise management table and the
 * rounded regulatory note must identify the same date and capital amounts. */
function directInsuranceCapitalFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const year = Number(document.periodEnd.slice(0, 4)),
    pages = Object.entries(document.pages);
  const canon = (s: string) => compact(s.normalize("NFKC"));
  const header = `${year}年12月31日${year - 1}年12月31日`;
  const rows = (content: DisclosureText["pages"][string]) => {
    const start = content.lines.findIndex((l) => canon(l) === header);
    if (start < 0) return;
    const labels = ["核心资本", "实际资本", "最低资本", "核心偿付能力充足率", "综合偿付能力充足率"];
    const result = labels.map((label) =>
      content.lines.slice(start + 1, start + 8).flatMap((raw, i) => {
        const m = normalized(raw).match(new RegExp(`^${label} ([\\d,.]+)(%?) ([\\d,.]+)(%?)$`));
        return m
          ? [
              {
                line: start + 1 + i,
                values: [Number(m[1].replaceAll(",", "")), Number(m[3].replaceAll(",", ""))],
                tokens: [m[1], m[3]],
                percent: m[2] === "%" && m[4] === "%",
              },
            ]
          : [];
      }),
    );
    if (
      result.some((r) => r.length !== 1) ||
      result.slice(0, 3).some((r) => r[0].percent) ||
      result.slice(3).some((r) => !r[0].percent)
    )
      return;
    return result.map((r) => r[0]);
  };
  const regimes = pages.filter(([, p]) => {
    const t = canon(p.text);
    return (
      t.includes("《保险公司偿付能力监管规则(II)》") &&
      new RegExp(
        `本公司已按照上述要求计算${year}年12月31日的核心及综合偿付能力充足率、核心资本、实际资本和最低资本`,
      ).test(t)
    );
  });
  const facts: FinancialFact[] = [];
  for (const [page, content] of pages) {
    const text = canon(content.text),
      table = rows(content);
    if (
      !table ||
      !text.includes("偿付能力状况") ||
      !text.includes("核心偿付能力充足率,指核心资本与最低资本的比率") ||
      !text.includes("核心资本和附属资本之和与最低资本的比率")
    )
      continue;
    const own = text.match(
      /截至本报告期末,本公司综合偿付能力充足率为([\d.]+)%,核心偿付能力充足率为([\d.]+)%/,
    );
    if (!own || Number(own[1]) !== table[4].values[0] || Number(own[2]) !== table[3].values[0])
      continue;
    const anchors = regimes.flatMap(([p, c]) => {
      const r = rows(c);
      return r ? [{ page: p, content: c, rows: r }] : [];
    });
    if (!anchors.length) continue;
    // Coarser figures only corroborate; they never become competing exact facts.
    const compatible = anchors.every((a) =>
      a.rows.every((row, i) =>
        row.values.every((value, col) => {
          if (i < 3) return value === table[i].values[col];
          const precision = (row.tokens[col].split(".")[1] ?? "").length,
            power = 10 ** precision;
          return Math.round(table[i].values[col] * power) / power === value;
        }),
      ),
    );
    const evidence = [
      { sourceId: options.sourceId, locator: `/pages/${page}/text`, raw: content.text },
      ...anchors.map((a) => ({
        sourceId: options.sourceId,
        locator: `/pages/${a.page}/text`,
        raw: a.content.text,
      })),
    ];
    for (const [column, y] of [year, year - 1].entries()) {
      const metrics: RegulatoryContext["metrics"] = {};
      for (const [i, [metric]] of ratioRows.entries()) {
        const row = table[i + 3],
          id = `${options.sourceId}:${page}:${y}:direct:${metric}`;
        facts.push({
          id,
          field: `regulatory.actual.${metric}`,
          entity: document.entity,
          year: y,
          period: { start: `${y}-12-31`, end: `${y}-12-31` },
          publishedAt: document.publishedAt,
          basis: options.basis,
          unit: "ratio",
          unitScale: 0.01,
          state: compatible ? "observed" : "conflicting",
          value: row.values[column] / 100,
          evidence: [
            {
              sourceId: options.sourceId,
              locator: `/pages/${page}/lines/${row.line}`,
              raw: content.lines[row.line],
            },
          ],
          reason: compatible
            ? "precise_own_insurer_capital;rounded_note_corroborates_only"
            : "conflicting_own_insurer_capital_tables",
        });
        metrics[metric] = {
          definition: regulatoryMetricDefinitions[metric],
          direction: "minimum",
          actualFactId: id,
        };
      }
      const context: RegulatoryContext = {
        subject: document.entity,
        scope: "legal_entity",
        regime: "C-ROSS-II",
        reportYear: year,
        position: column === 0 ? "closing" : "opening",
        comparisonBasis: "C-ROSS-II:reported-legal-entity-solvency",
        liquidityMetrics: [],
        metrics,
      };
      facts.push({
        id: `${options.sourceId}:${page}:${y}:direct:regulatory.context`,
        field: "regulatory.context",
        entity: document.entity,
        year: y,
        period: { start: `${y}-12-31`, end: `${y}-12-31` },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify(context),
        evidence,
        reason: "own_company_regulatory_computation_not_group_management_narrative",
      });
    }
  }
  return facts;
}

/** Original group capital tables; these cannot certify financial returns or complete group scope. */
// 监管、经营和会计基础事实共享证据，但各自保留适用范围的不确定性。
export function parseCnInsuranceFacts(
  document: DisclosureText,
  options: { sourceId: string; basis: string },
): FinancialFact[] {
  const facts: FinancialFact[] = [
      ...insuranceServiceStatementFacts(document, options),
      ...issuerCas25RestatementFacts(document, options),
    ],
    reportYear = Number(document.periodEnd.slice(0, 4));
  if (document.periodEnd !== `${reportYear}-12-31`) return facts;
  facts.push(...directInsuranceCapitalFacts(document, options));
  const pages = Object.entries(document.pages);
  const accountingBasis = groupInsuranceAccountingBasis(document);
  const accountingBasisFactId = accountingBasis
    ? `${options.sourceId}:${accountingBasis.page}:${accountingBasis.line}:${reportYear}:insurance.accountingBasis`
    : undefined;
  let accountingBasisAdded = false;
  const regimePage =
    pages.find(
      ([, p]) =>
        normalized(p.text).includes(
          "under the Regulatory Rules on Solvency of Insurance Companies (II) (the “C-ROSS Phase II”)",
        ) && normalized(p.text).includes(`December 31, ${reportYear}`),
    ) ??
    pages.find(
      ([, p]) =>
        compact(p.text).includes("《保险公司偿付能力监管规则(II)》") &&
        compact(p.text).includes("保险业自2022年起实施偿二代二期规则") &&
        compact(p.text).includes(`截至${reportYear}年12月31日`),
    ) ??
    pages.find(([, p]) => {
      const value = compact(p.text);
      return (
        value.includes("本集团根据《保险公司偿付能力监管规则(II)》") &&
        value.includes(`于${reportYear}年12月31日，本集团符合监管机构的偿付能力充足率要求。`)
      );
    });
  for (const [page, content] of pages) {
    const cnGroupPattern = new RegExp(
      `^截至${reportYear}年12月31日，(.+?集团)(?:的)?偿付能力充足率`,
    );
    const cnGroupLine = content.lines.findIndex((l) => cnGroupPattern.test(compact(l))),
      isChinese = cnGroupLine >= 0;
    const title = isChinese
      ? cnGroupLine
      : content.lines.findIndex((l) => normalized(l) === "GROUP SOLVENCY MARGIN");
    if (title < 0) continue;
    const text = normalized(content.lines.slice(title).join(" "));
    const group = isChinese
      ? [
          content.lines[title],
          compact(content.lines[title]).match(cnGroupPattern)![1],
          String(reportYear),
        ]
      : text.match(
          /^GROUP SOLVENCY MARGIN (.+?)’s solvency margin ratios were .+?as of December 31, (\d{4})\./,
        );
    if (!group || Number(group[2]) !== reportYear) continue;
    const table = content.lines.slice(title),
      header = table.findIndex((l) =>
        isChinese ? compact(l) === "（人民币百万元）" : normalized(l) === "(in RMB million)",
      );
    const columnYears = table.slice(header + 1, header + 5).join(" ");
    if (
      header < 0 ||
      (isChinese
        ? compact(columnYears) !== `${reportYear}年12月31日${reportYear - 1}年12月31日`
        : normalized(columnYears) !== `December 31, ${reportYear} December 31, ${reportYear - 1}`)
    )
      continue;
    const parsed = new Map<string, { line: number; values: number[] }>();
    let duplicateCapitalRow = false;
    for (const [metric, englishLabel] of ratioRows) {
      const label = isChinese
        ? metric === "coreSolvency"
          ? "核心偿付能力充足率"
          : "综合偿付能力充足率"
        : englishLabel;
      const prefix = `${label}${isChinese ? "(%)" : " (%)"} `;
      for (let i = header + 5; i < table.length; i++) {
        const row = normalized(table[i]);
        if (!row.startsWith(prefix)) continue;
        const values = row.slice(prefix.length).match(new RegExp(`^(${decimal}) (${decimal})$`));
        if (values) {
          if (parsed.has(metric)) duplicateCapitalRow = true;
          parsed.set(metric, {
            line: title + i,
            values: values.slice(1).map((v) => Number(v.replace(/[−－]/g, "-")) / 100),
          });
        }
      }
    }
    if (parsed.size !== 2 || duplicateCapitalRow) continue;
    const definitions = isChinese
      ? compact(text)
          .replace(/[／/]/g, "╱")
          .includes("核心偿付能力充足率=核心资本╱最低资本；综合偿付能力充足率=实际资本╱最低资本。")
      : text.includes(
          "Core solvency margin ratio = core capital / minimum capital. Comprehensive solvency margin ratio = actual capital / minimum capital.",
        );
    const minimum = isChinese
      ? compact(text).match(
          /上表中核心偿付能力充足率和综合偿付能力充足率的最低监管要求分别为(\d+(?:\.\d+)?)%、(\d+(?:\.\d+)?)%。/,
        )
      : text.match(
          /The minimum regulatory requirements for the core solvency margin ratio and comprehensive solvency margin ratio(?: in the table above)? are (\d+(?:\.\d+)?)% and (\d+(?:\.\d+)?)% respectively\./,
        );
    const push = (
      field: string,
      year: number,
      value: number,
      unit: string,
      line: number,
      unitScale = 1,
    ) => {
      const id = `${options.sourceId}:${page}:${line}:${year}:${field}`;
      facts.push({
        id,
        field,
        entity: document.entity,
        year,
        period: { start: `${year}-12-31`, end: `${year}-12-31` },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit,
        unitScale,
        state: "observed",
        value,
        evidence: [
          {
            sourceId: options.sourceId,
            locator: `/pages/${page}/lines/${line}`,
            raw: content.lines[line],
          },
        ],
        reason: "reported_group_regulatory_table;not_accounting_return_evidence",
      });
      return id;
    };
    const contextEvidence = [...new Set([page, ...(regimePage ? [regimePage[0]] : [])])].map(
      (p) => ({
        sourceId: options.sourceId,
        locator: `/pages/${p}/text`,
        raw: document.pages[p].text,
      }),
    );
    let closingId: string | undefined;
    for (const [column, year] of [reportYear, reportYear - 1].entries()) {
      const metrics: RegulatoryContext["metrics"] = {};
      for (const [index, [metric]] of ratioRows.entries()) {
        const row = parsed.get(metric)!;
        const actualFactId = push(
          `regulatory.actual.${metric}`,
          year,
          row.values[column],
          "ratio",
          row.line,
          0.01,
        );
        const minimumStart = content.lines.findIndex((l) =>
          l.includes(isChinese ? "最低监管要求" : "minimum regulatory requirements"),
        );
        const numberOffset =
          minimum && minimumStart >= 0
            ? content.lines
                .slice(minimumStart, minimumStart + 3)
                .findIndex((l) => new RegExp(`\\b${escapeRegex(minimum[index + 1])}%`).test(l))
            : -1;
        const requirementLine = numberOffset >= 0 ? minimumStart + numberOffset : -1;
        const requirementFactId =
          minimum && requirementLine >= 0
            ? push(
                `regulatory.requirement.${metric}`,
                year,
                Number(minimum[index + 1]) / 100,
                "ratio",
                requirementLine,
                0.01,
              )
            : undefined;
        metrics[metric] = {
          definition: regulatoryMetricDefinitions[metric],
          direction: "minimum",
          actualFactId,
          ...(requirementFactId ? { requirementFactId } : {}),
        };
      }
      if (!regimePage || !definitions) continue;
      const context: RegulatoryContext = {
        subject: document.entity,
        scope: "regulatory_consolidated",
        regime: "C-ROSS-II",
        reportYear,
        position: column === 0 ? "closing" : "opening",
        comparisonBasis: "C-ROSS-II:reported-group-solvency",
        liquidityMetrics: [],
        metrics,
      };
      const id = `${options.sourceId}:${page}:${year}:regulatory.context`;
      facts.push({
        id,
        field: "regulatory.context",
        entity: document.entity,
        year,
        period: { start: `${year}-12-31`, end: `${year}-12-31` },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: JSON.stringify(context),
        evidence: contextEvidence,
        reason: "group_capital_table_and_explicit_regime;opening_column_retains_report_version",
      });
      if (column === 0) closingId = id;
    }
    if (!closingId) continue;
    if (accountingBasis && accountingBasisFactId && !accountingBasisAdded) {
      facts.push({
        id: accountingBasisFactId,
        field: "insurance.accountingBasis",
        entity: document.entity,
        year: reportYear,
        period: { start: `${reportYear}-01-01`, end: document.periodEnd },
        publishedAt: document.publishedAt,
        basis: options.basis,
        unit: "text",
        state: "observed",
        value: "CAS25-2023",
        evidence: [
          {
            sourceId: options.sourceId,
            locator: `/pages/${accountingBasis.page}/lines/${accountingBasis.line}`,
            raw: document.pages[accountingBasis.page].lines[accountingBasis.line],
          },
        ],
        reason: `group_insurance_contract_policy_CAS25_2020;${accountingBasis.transition ? "group_transition_explicit_from_2023-01-01;comparative_information_represented" : "applicable_to_report_year_from_group_policy;transition_date_not_repeated_on_this_page"}`,
      });
      accountingBasisAdded = true;
    }
    const context: InsuranceContext = {
      subject: document.entity,
      scope: "group",
      kind: "group",
      reportYear,
      accountingStandard: accountingBasis ? "CAS25-2023" : "regulatory-only",
      comparisonBasis: accountingBasis
        ? "CAS25-2023:group-insurance-contract-policy"
        : "C-ROSS-II:reported-group-solvency",
      ...(accountingBasisFactId ? { accountingBasisFactId } : {}),
      operating: {},
      regulatoryContextFactId: closingId,
    };
    const stressHeader = content.lines.findIndex(
      (l) =>
        normalized(l) ===
        (isChinese
          ? "核心偿付能力充足率 综合偿付能力充足率"
          : "Core solvency margin ratio Comprehensive solvency margin ratio"),
    );
    const columnHeader = stressHeader >= 0 ? normalized(content.lines[stressHeader + 1] ?? "") : "";
    const dateInHeader = isChinese ? columnHeader.startsWith(`${reportYear}年12月31日 `) : true;
    const dated = isChinese
      ? dateInHeader || compact(content.lines[stressHeader - 1] ?? "") === `${reportYear}年12月31日`
      : true;
    const repeatedSubjects = new RegExp(
      `^${isChinese ? (dateInHeader ? `${reportYear}年12月31日 ` : "") : `December 31, ${reportYear} `}${escapeRegex(group[1])} (.+?) (.+?) ${escapeRegex(group[1])} \\1 \\2$`,
    );
    const declaration = isChinese
      ? compact(text).includes(`本公司已测算利率下行和权益资产下跌对${group[1]}、`) &&
        compact(text).includes(`于${reportYear}年12月31日偿付能力充足率的影响，结果如下：`)
      : text.includes(
          `Test results showing the impacts of declines in interest rates and equity assets on solvency margin ratios of ${group[1]},`,
        ) && text.includes(`as at December 31, ${reportYear} are disclosed below:`);
    if (declaration && dated && repeatedSubjects.test(columnHeader)) {
      const closing = JSON.parse(
        String(facts.find((f) => f.id === closingId)!.value),
      ) as RegulatoryContext;
      const scenarios = isChinese
        ? [
            ["interest_rate_minus_50bp", "当期利率下降50个基点", ""],
            ["equity_minus_10pct", "权益资产公允价值下跌10%", ""],
          ]
        : [
            ["interest_rate_minus_50bp", "50 bps decline in current", "interest rates"],
            ["equity_minus_10pct", "10% decrease in fair value of", "equity assets"],
          ];
      for (const [scenario, first, second] of scenarios)
        for (let i = stressHeader + 2; i < content.lines.length; i++) {
          const firstRow = normalized(content.lines[i]);
          if (isChinese ? !firstRow.startsWith(`${first} `) : firstRow !== first) continue;
          const row = isChinese ? firstRow : normalized(content.lines[i + 1] ?? "");
          if (!isChinese && !row.startsWith(`${second} `)) continue;
          const body = row.slice((isChinese ? first : second).length + 1);
          const direct = isChinese
            ? body.match(new RegExp(`^${Array(6).fill(`(${decimal})%`).join(" ")}$`))
            : null;
          const values = body.match(
            new RegExp(
              `^${Array(6)
                .fill(isChinese ? "((?:下降|上升)\\d+(?:\\.\\d+)?)个百分点" : `(${decimal}) pps`)
                .join(" ")}$`,
            ),
          );
          if (!values && !direct) continue;
          const bindings: NonNullable<InsuranceContext["stress"]>[string] = {};
          for (const [index, [metric]] of ratioRows.entries()) {
            const value = Number(
              (direct ?? values)![index * 3 + 1]
                .replace(/[−－]/g, "-")
                .replace("下降", "-")
                .replace("上升", ""),
            );
            const factId = push(
              `insurance.stress.${scenario}.${metric}`,
              reportYear,
              direct ? value / 100 : value,
              direct ? "ratio" : "percentage_points",
              isChinese ? i : i + 1,
              direct ? 0.01 : 1,
            );
            bindings[metric] = direct
              ? { mode: "scenario_ratio", factId }
              : {
                  mode: "percentage_point_change",
                  factId,
                  baseFactId: closing.metrics[metric].actualFactId,
                };
          }
          context.stress ??= {};
          context.stress[scenario] = bindings;
        }
    }
    const insuranceEvidence = [
      ...contextEvidence,
      ...(accountingBasis
        ? [
            {
              sourceId: options.sourceId,
              locator: `/pages/${accountingBasis.page}/text`,
              raw: document.pages[accountingBasis.page].text,
            },
          ]
        : []),
      ...(accountingBasis?.transition
        ? [
            {
              sourceId: options.sourceId,
              locator: `/pages/${accountingBasis.transition.page}/text`,
              raw: document.pages[accountingBasis.transition.page].text,
            },
          ]
        : []),
    ];
    facts.push({
      id: `${options.sourceId}:${page}:insurance.context`,
      field: "insurance.context",
      entity: document.entity,
      year: reportYear,
      period: { start: `${reportYear}-01-01`, end: document.periodEnd },
      publishedAt: document.publishedAt,
      basis: options.basis,
      unit: "text",
      state: "observed",
      value: JSON.stringify(context),
      evidence: insuranceEvidence,
      reason: accountingBasis
        ? "group_CAS25_insurance_contract_policy;group_operating_result_rating_disclosed_material_business_evidence_and_audited_notes_unresolved"
        : "report_regulatory_only;accounting_return_basis_rating_disclosed_material_business_evidence_and_audited_notes_unresolved",
    });
  }
  return mergeAgreeingContexts(facts);
}

/** Repeated tables keep every numeric observation; identical context bindings share their original pages. */
// 只合并内容一致的上下文，并重写内部事实引用；相互矛盾的观察保持并列。
function mergeAgreeingContexts(facts: FinancialFact[]): FinancialFact[] {
  const aliases = new Map<string, string>(),
    canonical = new Map<string, string>();
  const signature = (f: FinancialFact) =>
    JSON.stringify([f.field, f.entity, f.year, f.period, f.basis, f.unit, f.state, f.value]);
  const numeric = facts.filter((f) => !f.field.endsWith(".context"));
  for (const f of numeric) {
    const key = signature(f),
      id = canonical.get(key) ?? f.id;
    canonical.set(key, id);
    aliases.set(f.id, id);
  }
  const result = [...numeric];
  for (const field of ["regulatory.context", "insurance.context"]) {
    const contexts = new Map<string, FinancialFact>();
    for (const original of facts.filter((f) => f.field === field)) {
      const f = {
        ...original,
        value: JSON.stringify(JSON.parse(String(original.value)), (key, value) =>
          typeof value === "string" && (key === "factId" || key.endsWith("FactId"))
            ? (aliases.get(value) ?? value)
            : value,
        ),
      };
      const key = signature(f),
        existing = contexts.get(key);
      if (existing) {
        aliases.set(f.id, existing.id);
        for (const ref of f.evidence)
          if (
            !existing.evidence.some((e) => e.sourceId === ref.sourceId && e.locator === ref.locator)
          )
            existing.evidence.push(ref);
      } else {
        contexts.set(key, f);
        aliases.set(f.id, f.id);
      }
    }
    result.push(...contexts.values());
  }
  return result;
}

// 信托、期货与券商：区分自有资金、客户资产和适用监管标准。

type Options = { sourceId: string; basis: string };
const normalizeFinancialText = (text: string) => text.normalize("NFKC").replace(/\s/g, "");
const number = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";

function issuerIdentity(document: DisclosureText): { name: string; page: string } | undefined {
  const matches = Object.entries(document.pages).flatMap(([page, content]) => {
    if (Number(page) > 10 || !normalizeFinancialText(content.text).includes("一、公司信息"))
      return [];
    const text = normalizeFinancialText(content.text),
      name = content.lines
        .map(normalizeFinancialText)
        .find((line) => line.startsWith("公司的中文名称"))
        ?.slice("公司的中文名称".length);
    const codes = [...text.matchAll(/股票代码[：:]?[“"]?(\d{6})/g)].map((m) => m[1]);
    return name &&
      codes.length === 1 &&
      codes[0] === document.entity &&
      text.startsWith(`${name}${document.periodEnd.slice(0, 4)}年年度报告`)
      ? [{ name, page }]
      : [];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function pageEvidence(document: DisclosureText, options: Options, pages: string[]) {
  return [...new Set(pages)].map((page) => ({
    sourceId: options.sourceId,
    locator: `/pages/${page}/text`,
    raw: document.pages[page].text,
  }));
}

function fact(
  document: DisclosureText,
  options: Options,
  page: string,
  field: string,
  value: FinancialFact["value"],
  unit: string,
  evidence: FinancialFact["evidence"],
  reason: string,
): FinancialFact {
  const year = Number(document.periodEnd.slice(0, 4));
  return {
    id: `${options.sourceId}:${page}:${field}`,
    field,
    entity: document.entity,
    year,
    period: { start: document.periodEnd, end: document.periodEnd },
    publishedAt: document.publishedAt,
    basis: options.basis,
    unit,
    state: "observed",
    value,
    evidence,
    reason,
  };
}

function ownTrustLicence(
  document: DisclosureText,
  issuer: { name: string; page: string },
  options: Options,
): FinancialFact[] {
  const year = document.periodEnd.slice(0, 4);
  const ownPages = Object.entries(document.pages).filter(([, content]) =>
    normalizeFinancialText(content.lines[0] ?? "").startsWith(`${issuer.name}${year}年年度报告`),
  );
  const business = ownPages.filter(([, content]) => {
    const text = normalizeFinancialText(content.text);
    // Annual reports use more than one faithful description of the issuer's
    // trustee business.  Keep this tied to the issuer's own business section
    // and its stated trust operating range; a bare subsidiary licence is not
    // a substitute.
    const trusteeDescription =
      text.includes(
        normalizeFinancialText(
          "信托业务是指公司以营业和收取报酬为目的，以受托人身份承诺信托和处理信托事务",
        ),
      ) ||
      text.includes(
        normalizeFinancialText(
          "信托业务是指公司作为受托人，按照委托人意愿以公司名义对受托的货币资金或其他财产进行管理或处分",
        ),
      );
    return (
      trusteeDescription &&
      (text.includes(
        normalizeFinancialText(
          "报告期内，公司经营的主要业务包括信托业务、固有业务和投资顾问等中介业务。",
        ),
      ) ||
        (text.includes(normalizeFinancialText("二、报告期内公司从事的主要业务")) &&
          text.includes(normalizeFinancialText("（一）经营范围")) &&
          text.includes(normalizeFinancialText("公司经营范围包括：资金信托"))))
    );
  });
  if (business.length !== 1) return [];
  const licenceCandidates = ownPages.flatMap(([page, content]) => {
    const text = normalizeFinancialText(content.text);
    if (text.includes("子公司现持有") || text.includes("本公司的子公司现持有")) return [];
    // A licence outside the already-qualified business passage must also be
    // the issuer's own company-information note and repeat its stock code.
    // This prevents an incidental licence in another report section from
    // becoming the issuer's licence.
    if (page !== business[0][0]) {
      if (!text.includes("三、公司的基本情况") || !text.includes(`${issuer.name}(以下简称本公司,`))
        return [];
      const codes = [...text.matchAll(/股票代码[“"](\d{6})[”"]/g)].map((m) => m[1]);
      if (codes.length !== 1 || codes[0] !== document.entity) return [];
    }
    // The issuer's own annual-report business section and financial-note
    // company-information section respectively say "颁发的 K…号" and
    // "颁发的号码为 K…的".  Both are direct licence statements, while the
    // report header has already been bound to the issuer above.
    const match = text.match(
      /公司现持有[^。]{0,260}?于(\d{4})年(\d{1,2})月(\d{1,2})日颁发的(?:号码为)?([A-Z0-9]{8,30})(?:号)?《金融许可证》/,
    );
    if (!match) return [];
    const issuedAt = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    return issuedAt <= document.periodEnd ? [{ page, number: match[4], issuedAt }] : [];
  });
  const businessLicences = licenceCandidates.filter((licence) => licence.page === business[0][0]);
  const licences = businessLicences.length ? businessLicences : licenceCandidates;
  if (licences.length !== 1) return [];
  const licence = licences[0],
    evidence = pageEvidence(document, options, [issuer.page, business[0][0], licence.page]);
  return [
    ["business.licensedMethod", "trust"],
    ["business.licenseNumber", licence.number],
  ].map(([field, value]) =>
    fact(
      document,
      options,
      licence.page,
      field,
      value,
      "text",
      evidence,
      `issuer_own_financial_licence_and_current_trust_business;issued_at:${licence.issuedAt};group_risk_scope_not_certified`,
    ),
  );
}

function trustAssetSeparation(
  document: DisclosureText,
  issuer: { name: string; page: string },
  options: Options,
): FinancialFact | undefined {
  const year = document.periodEnd.slice(0, 4),
    matches: FinancialFact[] = [];
  for (const [page, content] of Object.entries(document.pages)) {
    if (
      !normalizeFinancialText(content.lines[0] ?? "").startsWith(`${issuer.name}${year}年年度报告`)
    )
      continue;
    const start = content.lines.findIndex((line) =>
      /^\([一二三四五六七八九十]+\)信托业务核算方法$/.test(normalizeFinancialText(line)),
    );
    if (start < 0) continue;
    const end = content.lines.findIndex(
      (line, i) => i > start && /^\([一二三四五六七八九十]+\)/.test(normalizeFinancialText(line)),
    );
    let passage = normalizeFinancialText(
      content.lines.slice(start + 1, end < 0 ? undefined : end).join(""),
    );
    const pages = [page];
    if (end < 0 && passage.endsWith("其资产、负债及")) {
      const nextPage = String(Number(page) + 1),
        next = document.pages[nextPage];
      if (
        !next ||
        !normalizeFinancialText(next.lines[0] ?? "").startsWith(`${issuer.name}${year}年年度报告`)
      )
        continue;
      // Only the immediate continuation may finish this sentence; later sections cannot fill it.
      if (normalizeFinancialText(next.lines[2] ?? "") !== "损益不列入本财务报表。") continue;
      passage += normalizeFinancialText(next.lines[2]);
      pages.push(nextPage);
    }
    if (
      !/(?:^|[。”])公司将固有财产与信托财产分开管理、分别核算。/.test(passage) ||
      !passage.includes(normalizeFinancialText("以每个信托项目作为独立的会计核算主体")) ||
      !passage.includes(
        normalizeFinancialText(
          "各信托项目单独记账，单独核算，并编制财务报表。其资产、负债及损益不列入本财务报表。",
        ),
      )
    )
      continue;
    matches.push(
      fact(
        document,
        options,
        page,
        "business.trustAssetSeparation",
        "proprietary_excluding_trust_assets",
        "text",
        pageEvidence(document, options, [issuer.page, ...pages]),
        "explicit_proprietary_and_trust_separate_accounting;trust_assets_liabilities_and_profit_excluded;legislative_version_unidentified",
      ),
    );
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Bounded source reader: named trust-company tables, without guessed legislative versions. */
export function parseCnOtherFinancialFacts(
  document: DisclosureText,
  options: Options,
): FinancialFact[] {
  if (!/^\d{4}-12-31$/.test(document.periodEnd)) return [];
  const issuer = issuerIdentity(document);
  if (!issuer) return [];
  const facts: FinancialFact[] = [...ownTrustLicence(document, issuer, options)];
  const licence = facts.find((f) => f.field === "business.licensedMethod");
  const separation = trustAssetSeparation(document, issuer, options);
  if (separation) facts.push(separation);
  const year = Number(document.periodEnd.slice(0, 4));
  for (const [page, content] of Object.entries(document.pages)) {
    if (
      !normalizeFinancialText(content.lines[0] ?? "").startsWith(`${issuer.name}${year}年年度报告`)
    )
      continue;
    const heading = content.lines.findIndex((line) =>
      /^[（(][一二三四五六七八九十]+[）)]信托公司风险控制指标监管报表$/.test(
        normalizeFinancialText(line),
      ),
    );
    if (heading < 0) continue;
    const header = content.lines.findIndex(
      (line, i) =>
        i > heading && normalizeFinancialText(line) === "项目(信托公司)期末余额监管标准备注",
    );
    if (
      header < 0 ||
      !content.lines
        .slice(heading, header)
        .some((line) => normalizeFinancialText(line) === "单位:万元")
    )
      continue;
    const next = content.lines.findIndex(
      (line, i) =>
        i > header && /^[（(][一二三四五六七八九十]+[）)]/.test(normalizeFinancialText(line)),
    );
    const end = next < 0 ? content.lines.length : next;
    const context: RegulatoryContext = {
      subject: document.entity,
      scope: "legal_entity",
      assetScope: "proprietary_excluding_trust_assets",
      regime: `issuer-disclosed-trust-capital-requirements:${year}`,
      comparisonBasis: "report-specific-trust-capital",
      reportYear: year,
      position: "closing",
      liquidityMetrics: [],
      metrics: {},
    };
    for (const [label, metric] of [
      ["净资本/各项业务风险资本之和", "trustRiskCoverage"],
      ["净资本/净资产", "netCapitalEquity"],
    ] as const) {
      const rows = content.lines.flatMap((raw, i) => {
        if (i <= header || i >= end) return [];
        const match = normalizeFinancialText(raw).match(
          new RegExp(`^${label}(?:(${number})%|—|-)(?:≥(${number})%|—|-)?$`),
        );
        return match ? [{ i, raw, match }] : [];
      });
      if (rows.length !== 1) continue;
      const { i, raw, match } = rows[0];
      const evidence = [{ sourceId: options.sourceId, locator: `/pages/${page}/lines/${i}`, raw }];
      for (const [kind, value] of [
        ["actual", match[1]],
        ["requirement", match[2]],
      ] as const)
        if (value !== undefined) {
          const observation = fact(
            document,
            options,
            page,
            `regulatory.${kind}.${metric}`,
            Number(value.replaceAll(",", "")) / 100,
            "ratio",
            evidence,
            "issuer_disclosed_current_trust_capital_table;requirement_kind:regulatory;direction:minimum;legislative_version_unidentified",
          );
          facts.push(observation);
          if (kind === "actual")
            context.metrics[metric] = {
              definition: regulatoryMetricDefinitions[metric],
              direction: "minimum",
              requirementKind: "regulatory",
              actualFactId: observation.id,
            };
          else if (context.metrics[metric])
            context.metrics[metric].requirementFactId = observation.id;
        }
    }
    if (licence && separation && Object.keys(context.metrics).length) {
      const refs = [
        ...licence.evidence,
        ...separation.evidence,
        ...pageEvidence(document, options, [page]),
      ];
      const evidence = refs.filter(
        (ref, i) =>
          refs.findIndex((r) => r.sourceId === ref.sourceId && r.locator === ref.locator) === i,
      );
      facts.push(
        fact(
          document,
          options,
          page,
          "regulatory.context",
          JSON.stringify(context),
          "text",
          evidence,
          "issuer_disclosed_applicable_current_capital_requirements;legislative_version_unidentified;cross_year_restatement_comparability_not_asserted",
        ),
      );
    }
  }
  return facts;
}

export const brokerRegulatoryReferenceSourceId =
  "developer-reviewed:broker-risk-controls:CSRC-2024-13:v1";
const sourceUrl = "https://www.csrc.gov.cn/csrc/c106256/c1653957/content.shtml";
const metrics = ["riskCoverage", "capitalLeverage", "lcr", "nsfr"] as const;

const metricSchema = z
  .object({
    definition: z.string(),
    direction: z.literal("minimum"),
    unit: z.literal("ratio"),
    minimum: z.number().nonnegative(),
  })
  .strict();
const referenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    referenceId: z.literal("developer-reviewed-csrc-broker-risk-controls-2024-13-v1"),
    kind: z.literal("developer-reviewed-structured-regulatory-reference"),
    notHttpResponse: z.literal(true),
    reviewedAt: z.string(),
    references: z
      .array(
        z
          .object({
            method: z.literal("broker"),
            subjectScope: z.literal("legal_entity"),
            regime: z.literal("CSRC-2024-13"),
            effectiveReportYear: z
              .object({ start: z.literal(2025), end: z.literal(2026) })
              .strict(),
            officialAnnouncementDate: z.literal("2024-09-13"),
            officialSources: z
              .array(
                z
                  .object({ url: z.string().url(), article: z.string(), description: z.string() })
                  .strict(),
              )
              .length(2),
            metrics: z
              .object({
                riskCoverage: metricSchema,
                capitalLeverage: metricSchema,
                lcr: metricSchema,
                nsfr: metricSchema,
              })
              .strict(),
          })
          .strict(),
      )
      .length(1),
  })
  .strict();
type BrokerReference = z.infer<typeof referenceSchema>["references"][number];

// 监管标准是随代码冻结的来源资料；编译运行同样读取源码中的同一份原文。
const regulatoryReferencePath = path.join(
  CLI_ROOT,
  "src",
  "cn",
  "sources",
  "broker-regulations.json",
);
async function referenceBytes(): Promise<Buffer> {
  return fs.readFile(regulatoryReferencePath);
}
const contentHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The reviewed reference is versioned configuration, never an HTTP-response cache. */
export async function loadBrokerRegulatoryReference(): Promise<unknown> {
  return referenceSchema.parse(JSON.parse((await referenceBytes()).toString("utf8")));
}

/** Register only after parser-approved facts actually use the reference. */
export async function ensureBrokerRegulatoryReferenceSource(
  input: EvidenceInput,
): Promise<EvidenceInput["sources"][number]> {
  const bytes = await referenceBytes(),
    hash = contentHash(bytes),
    existing = input.sources.find((source) => source.id === brokerRegulatoryReferenceSourceId);
  if (existing) {
    if (
      existing.sha256 !== hash ||
      existing.url !== sourceUrl ||
      existing.mapping !== "regulatory-reference-v1" ||
      existing.mediaType !== "application/json"
    )
      throw new Error(
        "Broker regulatory reference source does not match the developer-reviewed version",
      );
    return existing;
  }
  const source = {
    id: brokerRegulatoryReferenceSourceId,
    path: regulatoryReferencePath,
    url: sourceUrl,
    mediaType: "application/json" as const,
    mapping: "regulatory-reference-v1" as const,
    fetchedAt: "2026-09-10",
    sha256: hash,
  };
  input.sources.push(source);
  return source;
}

function matchingReference(
  context: unknown,
  company: CompanyFacts,
  document: unknown,
): BrokerReference | undefined {
  const parsed = regulatoryContextSchema.safeParse(context);
  if (
    !parsed.success ||
    parsed.data.subject !== company.companyId ||
    parsed.data.scope !== "legal_entity" ||
    parsed.data.regime !== "CSRC-2024-13" ||
    parsed.data.comparisonBasis !== "CSRC-2024-13"
  )
    return;
  const reference = referenceSchema.safeParse(document);
  if (!reference.success) return;
  const candidate = reference.data.references[0];
  if (
    parsed.data.reportYear < candidate.effectiveReportYear.start ||
    parsed.data.reportYear > candidate.effectiveReportYear.end
  )
    return;
  return candidate;
}

function actualBound(
  context: z.infer<typeof regulatoryContextSchema>,
  facts: Map<string, FinancialFact>,
  company: CompanyFacts,
  date: string,
  metric: (typeof metrics)[number],
  reference: BrokerReference,
): boolean {
  const binding = context.metrics[metric],
    id = binding?.actualFactId,
    f = id ? facts.get(id) : undefined;
  return (
    binding?.definition === reference.metrics[metric].definition &&
    binding.direction === reference.metrics[metric].direction &&
    !!f &&
    f.entity === company.companyId &&
    f.basis === company.basis &&
    f.field === `regulatory.actual.${metric}` &&
    f.state === "observed" &&
    f.unit === "ratio" &&
    typeof f.value === "number" &&
    Number.isFinite(f.value) &&
    f.period.start === date &&
    f.period.end === date &&
    f.year === Number(date.slice(0, 4)) &&
    f.evidence.length > 0
  );
}

/**
 * Bind each usable CSRC-2024-13 minimum to a parser-approved broker context.
 * A company-disclosed requirement remains authoritative for its own metric;
 * a missing or incompatible sibling metric cannot suppress the others.
 */
export function applyBrokerRegulatoryReference(
  company: CompanyFacts,
  facts: Map<string, FinancialFact>,
  document: unknown,
): FinancialFact[] {
  const reference = referenceSchema.safeParse(document);
  if (!reference.success) return [];
  const additions: FinancialFact[] = [];
  for (const original of [...facts.values()].filter(
    (fact) =>
      fact.field === "regulatory.context" &&
      fact.entity === company.companyId &&
      fact.basis === company.basis &&
      fact.state === "observed" &&
      typeof fact.value === "string",
  )) {
    let raw: unknown;
    try {
      raw = JSON.parse(original.value as string);
    } catch {
      continue;
    }
    const context = regulatoryContextSchema.safeParse(raw),
      selected = matchingReference(
        context.success ? context.data : undefined,
        company,
        reference.data,
      );
    if (!context.success || !selected) continue;
    const date = original.period.end;
    if (
      original.period.start !== date ||
      date !==
        `${context.data.position === "opening" ? context.data.reportYear - 1 : context.data.reportYear}-12-31`
    )
      continue;
    const amended = structuredClone(context.data);
    let used = false;
    for (const metric of metrics) {
      if (
        amended.metrics[metric]?.requirementFactId !== undefined ||
        !actualBound(context.data, facts, company, date, metric, selected)
      )
        continue;
      const entry = selected.metrics[metric],
        id = `${original.id}:developer-reference:${metric}`;
      additions.push({
        id,
        field: `regulatory.requirement.${metric}`,
        entity: company.companyId,
        year: Number(date.slice(0, 4)),
        period: { start: date, end: date },
        publishedAt: selected.officialAnnouncementDate,
        basis: company.basis,
        unit: "ratio",
        state: "observed",
        value: entry.minimum,
        evidence: [
          {
            sourceId: brokerRegulatoryReferenceSourceId,
            locator: `/references/0/metrics/${metric}/minimum`,
            raw: entry.minimum,
          },
        ],
        reason: `developer_reviewed_CSRC_2024_13:${selected.officialSources[0].article};effective_report_year:${context.data.reportYear}`,
      });
      amended.metrics[metric] = {
        ...amended.metrics[metric]!,
        requirementFactId: id,
        requirementKind: "regulatory",
      };
      used = true;
    }
    if (used)
      additions.push({
        ...original,
        value: JSON.stringify(amended),
        evidence: [
          ...original.evidence,
          {
            sourceId: brokerRegulatoryReferenceSourceId,
            locator: "/referenceId",
            raw: reference.data.referenceId,
          },
        ],
        reason: `${original.reason ?? "reported_broker_regulatory_context"};developer_reviewed_requirement_reference:CSRC-2024-13`,
      });
  }
  return additions;
}
