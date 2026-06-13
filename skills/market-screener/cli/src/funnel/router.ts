import type { CnIndustryMapSpec, RoutingMapSpec } from "../spec/types.js";
import type { Market } from "./types.js";

export interface RoutedTemplate {
  id: string;
  subTemplate?: string;
}

export type RoutingMethod = "gics" | "cn_industry_map" | "industry_proxy" | "fallback";

export interface RouteInput {
  market?: Market;
  gicsCode?: string;
  industryProxy?: string;
}

export interface RouteResult {
  templates: RoutedTemplate[];
  routingConfidence: "high" | "ambiguous_union" | "low";
  routingMethod: RoutingMethod;
  auditHints: string[];
  matchedRule?: string;
}

interface CnIndustryParts {
  l1?: string;
  l2?: string;
}

interface TemplateRule {
  template: string;
  sub_template?: string;
  confidence?: string;
  also_run?: string[];
}

function matchGicsPrefix(code: string, prefix: string): boolean {
  return code.startsWith(prefix);
}

function parseCnIndustry(raw?: string): CnIndustryParts {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  const parts = text.split("-").map((p) => p.trim()).filter(Boolean);
  return { l1: parts[0], l2: parts[1] };
}

function normalizeCnL1(
  l1: string | undefined,
  aliases: Record<string, string> | undefined
): string | undefined {
  if (!l1) return undefined;
  return aliases?.[l1] ?? l1;
}

function buildRouteFromRule(
  rule: TemplateRule,
  matchedRule: string,
  routingMethod: RoutingMethod
): RouteResult {
  const primary: RoutedTemplate = {
    id: rule.template,
    subTemplate: rule.sub_template,
  };
  const alsoRun = rule.also_run ?? [];
  const isUnion = rule.confidence === "ambiguous_union" && alsoRun.length > 0;
  if (isUnion) {
    return {
      templates: [primary, ...alsoRun.map((id) => ({ id }))],
      routingConfidence: "ambiguous_union",
      routingMethod,
      auditHints: ["Routed via ambiguous_union; verify sector classification in Deep audit"],
      matchedRule,
    };
  }
  return {
    templates: [primary],
    routingConfidence: "high",
    routingMethod,
    auditHints: [],
    matchedRule,
  };
}

function routeViaCnIndustryMap(
  cnIndustryMap: CnIndustryMapSpec,
  industryProxy?: string
): RouteResult | undefined {
  const parts = parseCnIndustry(industryProxy);
  const l1 = normalizeCnL1(parts.l1, cnIndustryMap.legacy_l1_aliases);
  if (!l1) return undefined;

  for (const override of cnIndustryMap.l2_overrides ?? []) {
    const match = override.match as { l1?: string; l2?: string } | undefined;
    if (!match?.l1 || match.l1 !== l1) continue;
    if (match.l2 && match.l2 !== parts.l2) continue;
    return buildRouteFromRule(
      override as TemplateRule,
      `l2:${l1}/${parts.l2 ?? ""}`,
      "cn_industry_map"
    );
  }

  const l1Rule = cnIndustryMap.l1_defaults?.[l1] as TemplateRule | undefined;
  if (!l1Rule) return undefined;
  return buildRouteFromRule(l1Rule, `l1:${l1}`, "cn_industry_map");
}

function keywordBlocked(
  proxy: string,
  keyword: string,
  excludes: CnIndustryMapSpec["proxy_keyword_excludes"]
): boolean {
  if (!proxy.includes(keyword)) return true;
  for (const rule of excludes ?? []) {
    if (String(rule.keyword).toLowerCase() !== keyword) continue;
    for (const fragment of (rule.exclude_if_contains as string[]) ?? []) {
      if (proxy.includes(String(fragment).toLowerCase())) return true;
    }
  }
  return false;
}

function routeViaIndustryProxy(
  routingMap: RoutingMapSpec,
  cnIndustryMap: CnIndustryMapSpec | undefined,
  industryProxy?: string
): RouteResult | undefined {
  const proxy = (industryProxy ?? "").toLowerCase();
  if (!proxy) return undefined;

  const entries = [
    ...(routingMap.industry_proxy_map ?? []),
    ...(cnIndustryMap?.proxy_keyword_additions ?? []),
  ];

  for (const entry of entries) {
    const keywords = (entry.keywords as string[]).map((k) => k.toLowerCase());
    const matched = keywords.some((k) => !keywordBlocked(proxy, k, cnIndustryMap?.proxy_keyword_excludes) && proxy.includes(k));
    if (!matched) continue;

    const rule: TemplateRule = {
      template: entry.template as string,
      sub_template: entry.sub_template as string | undefined,
      also_run: entry.also_run as string[] | undefined,
    };
    if (entry.also_run) rule.confidence = "ambiguous_union";
    return buildRouteFromRule(rule, `proxy:${keywords[0]}`, "industry_proxy");
  }

  return undefined;
}

function fallbackRoute(routingMap: RoutingMapSpec): RouteResult {
  const classifier = routingMap.classifier as Record<string, unknown> | undefined;
  const template = String(classifier?.fallback_template ?? "manufacturing");
  return {
    templates: [{ id: template }],
    routingConfidence: "low",
    routingMethod: "fallback",
    auditHints: ["routing_fallback_unmapped_industry"],
    matchedRule: "fallback",
  };
}

export function routeSecurity(
  routingMap: RoutingMapSpec,
  cnIndustryMap: CnIndustryMapSpec | undefined,
  input: RouteInput
): RouteResult {
  if (input.gicsCode) {
    for (const mapping of routingMap.mappings) {
      const prefix = mapping.gics_prefix as string;
      if (!matchGicsPrefix(input.gicsCode, prefix)) continue;

      const rule: TemplateRule = {
        template: mapping.template as string,
        sub_template: mapping.sub_template as string | undefined,
        confidence: mapping.confidence as string | undefined,
        also_run: mapping.also_run ? [mapping.also_run as string] : undefined,
      };
      return buildRouteFromRule(rule, `gics:${prefix}`, "gics");
    }
  }

  if (input.market === "CN" && cnIndustryMap) {
    const cnRoute = routeViaCnIndustryMap(cnIndustryMap, input.industryProxy);
    if (cnRoute) return cnRoute;
  }

  const proxyRoute = routeViaIndustryProxy(routingMap, cnIndustryMap, input.industryProxy);
  if (proxyRoute) return proxyRoute;

  return fallbackRoute(routingMap);
}

export function routeFromIndustryProxy(
  routingMap: RoutingMapSpec,
  cnIndustryMap: CnIndustryMapSpec | undefined,
  market: Market,
  industryProxy?: string
): RouteResult {
  return routeSecurity(routingMap, cnIndustryMap, { market, industryProxy });
}
