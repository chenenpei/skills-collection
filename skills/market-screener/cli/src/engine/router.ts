import type { RoutingMapSpec } from "../spec/types.js";

export interface RoutedTemplate {
  id: string;
  subTemplate?: string;
}

export interface RouteInput {
  gicsCode?: string;
  industryProxy?: string;
}

export interface RouteResult {
  templates: RoutedTemplate[];
  routingConfidence: "high" | "ambiguous_union";
  auditHints: string[];
}

function matchGicsPrefix(code: string, prefix: string): boolean {
  return code.startsWith(prefix);
}

export function routeSecurity(
  routingMap: RoutingMapSpec,
  input: RouteInput
): RouteResult {
  if (input.gicsCode) {
    for (const mapping of routingMap.mappings) {
      const prefix = mapping.gics_prefix as string;
      if (!matchGicsPrefix(input.gicsCode, prefix)) continue;

      const primary: RoutedTemplate = {
        id: mapping.template as string,
        subTemplate: mapping.sub_template as string | undefined,
      };
      const confidence = mapping.confidence as string;
      if (confidence === "ambiguous_union" && mapping.also_run) {
        return {
          templates: [primary, { id: mapping.also_run as string }],
          routingConfidence: "ambiguous_union",
          auditHints: [
            (routingMap.ambiguous_union_rules as { audit_hint_on_union?: string })
              ?.audit_hint_on_union ?? "ambiguous_union",
          ],
        };
      }
      return { templates: [primary], routingConfidence: "high", auditHints: [] };
    }
  }

  const proxy = (input.industryProxy ?? "").toLowerCase();
  const proxyMap = routingMap.industry_proxy_map ?? [];
  for (const entry of proxyMap) {
    const keywords = (entry.keywords as string[]).map((k) => k.toLowerCase());
    if (keywords.some((k) => proxy.includes(k))) {
      const templates: RoutedTemplate[] = [
        {
          id: entry.template as string,
          subTemplate: entry.sub_template as string | undefined,
        },
      ];
      const also = entry.also_run as string[] | undefined;
      if (also?.length) {
        for (const id of also) templates.push({ id });
        return {
          templates,
          routingConfidence: "ambiguous_union",
          auditHints: ["Routed via industry proxy ambiguous_union"],
        };
      }
      return { templates, routingConfidence: "high", auditHints: [] };
    }
  }

  return {
    templates: [{ id: "manufacturing" }],
    routingConfidence: "high",
    auditHints: ["Default fallback template: manufacturing"],
  };
}
