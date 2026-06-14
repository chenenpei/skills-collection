import { ProxyAgent, fetch as undiciFetch } from "undici";

let cachedProxy: ProxyAgent | undefined;
let cachedProxyUrl: string | undefined;

/** Read HTTPS/HTTP proxy from env (Node fetch ignores these by default). */
export function resolveProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  );
}

function proxyAgent(url: string): ProxyAgent {
  if (cachedProxy && cachedProxyUrl === url) return cachedProxy;
  cachedProxyUrl = url;
  cachedProxy = new ProxyAgent(url);
  return cachedProxy;
}

/** Network fetch that honors HTTPS_PROXY / HTTP_PROXY via undici. */
export async function httpFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) {
    return fetch(input, init);
  }

  const res = await undiciFetch(input, {
    ...init,
    dispatcher: proxyAgent(proxyUrl),
  } as Parameters<typeof undiciFetch>[1]);

  return res as unknown as Response;
}
