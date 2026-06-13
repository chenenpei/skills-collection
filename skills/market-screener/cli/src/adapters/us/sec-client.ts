import { withHostLimit } from "../../lib/host-limit.js";
import { httpFetch } from "../../lib/http-fetch.js";
import { SEC_UA } from "./sec-tickers.js";

const SEC_HOST = "data.sec.gov";
/** SEC fair-access guidance: stay near ~10 req/s; 4 concurrent is conservative. */
const SEC_MAX_CONCURRENT = 4;

export async function secFetch(path: string): Promise<Response> {
  return withHostLimit(SEC_HOST, SEC_MAX_CONCURRENT, () =>
    httpFetch(`https://${SEC_HOST}${path}`, {
      headers: { "User-Agent": SEC_UA },
    })
  );
}
