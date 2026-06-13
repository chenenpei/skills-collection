import { withHostLimit } from "../../lib/host-limit.js";
import { httpFetch } from "../../lib/http-fetch.js";

export const EASTMONEY_DATACENTER_BASE =
  "https://datacenter-web.eastmoney.com/api/data/v1/get";

export const EASTMONEY_DATACENTER_HOST = "datacenter-web.eastmoney.com";

/** Each enriched ticker fires 2 datacenter calls; cap host-wide in-flight requests. */
const EASTMONEY_MAX_CONCURRENT = 8;

export const EASTMONEY_F10_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://emweb.securities.eastmoney.com/",
};

export async function fetchEastMoneyDatacenter(params: URLSearchParams): Promise<Response> {
  return withHostLimit(EASTMONEY_DATACENTER_HOST, EASTMONEY_MAX_CONCURRENT, () =>
    httpFetch(`${EASTMONEY_DATACENTER_BASE}?${params.toString()}`, {
      headers: EASTMONEY_F10_HEADERS,
    })
  );
}
