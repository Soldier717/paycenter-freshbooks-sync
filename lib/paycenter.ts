import { PayCenterApi, PcPayment, ProviderError } from "./types";

export function payCenter(baseUrl: string, siteId: string, token: string): PayCenterApi {
  const root = `${baseUrl.replace(/\/+$/, "")}/api/v4/site/${encodeURIComponent(siteId)}`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(root + path, {
        method,
        headers: { "x-access-token": token, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch (err: any) {
      const cause = err?.cause?.code ?? err?.cause?.message ?? err?.name ?? String(err);
      throw new ProviderError(`Pay Center did not respond (${cause}) at ${root}${path}`, false);
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* handled below */ }
    if (!res.ok) throw new ProviderError(`Pay Center HTTP ${res.status}`, res.status >= 400 && res.status < 500, res.status);
    if (!json) throw new ProviderError("Pay Center returned an unreadable response", false);
    if (json.success === false) throw new ProviderError(`Pay Center rejected the request: ${(json.errors ?? []).join("; ")}`, true);
    return json as T;
  }

  return {
    siteId,
    addUpdateInvoice: (body) => call("POST", "/invoice/addUpdate", body),
    getPayment: (id) => call<PcPayment>("GET", `/payment/${encodeURIComponent(id)}`),
    listPayments: (after) => call("GET", `/payments${after ? `?updated_after=${encodeURIComponent(after)}` : ""}`),
  };
}
