import { cleanToken } from "./merchants";
import { ProviderError } from "./types";

/**
 * Agency-level access to Pay Center. One token, issued by Hyfin for the PBS agency,
 * creates production sites and can call any site-level endpoint on a site under the agency.
 * Optional: when the env vars are absent the app falls back to per-site tokens.
 */
export interface Agency { id: string; baseUrl: string; token: string }

export function agency(): Agency | null {
  const token = process.env.PAYCENTER_AGENCY_TOKEN;
  const id = process.env.PAYCENTER_AGENCY_ID;
  if (!token || !id) return null;
  return {
    id,
    token: cleanToken(token),
    baseUrl: (process.env.PAYCENTER_AGENCY_BASE_URL ?? "https://api.paycenter.app").replace(/\/+$/, ""),
  };
}

/** The agency token applies to a merchant only on the agency's own environment (prod vs stage). */
export function agencyTokenFor(baseUrl: string): string | null {
  const a = agency();
  if (!a) return null;
  return a.baseUrl === baseUrl.replace(/\/+$/, "") ? a.token : null;
}

export interface NewSite {
  externalId: string;       // our merchant id; Pay Center dedupes on it
  name: string;
  merchantId?: string;      // processor MID
  webhookUrl: string;
  location?: { addressLine1?: string; addressLine2?: string; city?: string; stateCode?: string; zipCode?: string; phone?: string; website?: string };
  primaryContact?: { firstName: string; lastName: string; email: string; mobilePhone?: string };
  paymentCard?: boolean;
  ach?: boolean;
}

export interface SiteResult { id: string; action: "added" | "updated" }

export async function addUpdateSite(input: NewSite): Promise<SiteResult> {
  const a = agency();
  if (!a) throw new ProviderError("Pay Center agency access is not configured", true);
  const body: Record<string, unknown> = {
    externalId: input.externalId,
    name: input.name,
    agency: { _id: a.id },
    accessType: "api_only",
    paymentTypes: {
      paymentCard: { active: input.paymentCard ?? true },
      ach: { active: input.ach ?? true },
    },
    webhook: { active: true, url: input.webhookUrl },
  };
  if (input.merchantId) body.merchantId = input.merchantId;
  if (input.location && Object.values(input.location).some(Boolean)) body.location = input.location;
  if (input.primaryContact?.email) body.primaryContact = input.primaryContact;

  const url = `${a.baseUrl}/api/v4/site/addUpdate`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-access-token": a.token, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch (err: any) {
    const cause = err?.cause?.code ?? err?.cause?.message ?? err?.name ?? String(err);
    throw new ProviderError(`Pay Center did not respond (${cause}) at ${url}`, false);
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* below */ }
  if (!res.ok) throw new ProviderError(`Pay Center HTTP ${res.status}: ${text.slice(0, 300)}`, res.status < 500, res.status);
  if (!json) throw new ProviderError("Pay Center returned an unreadable response", false);
  if (json.success === false) throw new ProviderError(`Pay Center rejected the site: ${(json.errors ?? []).join("; ")}`, true);
  if (!json._id) throw new ProviderError("Pay Center did not return a site id", false);
  return { id: String(json._id), action: json.action === "updated" ? "updated" : "added" };
}
