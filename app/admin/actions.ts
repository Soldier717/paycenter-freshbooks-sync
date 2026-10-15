"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { depsFor, settingsFor, storeFor } from "@/lib/deps";
import { addUpdateSite, agency } from "@/lib/paycenter-agency";
import { ADMIN_COOKIE, adminCookieValue, hasAdminCookie, isAdminSecret } from "@/lib/guard";
import { createMerchant, getMerchant, issueConnectToken, updateMerchant } from "@/lib/merchants";
import { registerWebhooks } from "@/lib/onboarding";
import { reconcile, syncInvoice } from "@/lib/sync";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const pick = <T extends string>(v: string, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

async function guard() {
  if (!(await hasAdminCookie())) redirect("/admin/login");
}
const back = (id: string, msg: string, bad = false): never =>
  redirect(`/admin/merchants/${id}?${bad ? "err" : "msg"}=${encodeURIComponent(msg)}`);

export async function login(form: FormData) {
  if (!isAdminSecret(str(form, "secret"))) redirect("/admin/login?error=1");
  (await cookies()).set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600,
  });
  redirect("/admin");
}

export async function logout() {
  (await cookies()).delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

export async function addMerchant(form: FormData) {
  await guard();
  const name = str(form, "name");
  const ag = agency();
  const create = !!ag && str(form, "siteMode") !== "existing";
  const pcSiteId = str(form, "pcSiteId");
  if (!name) redirect("/admin/merchants/new?error=" + encodeURIComponent("Merchant name is required"));
  if (!create && !pcSiteId) redirect("/admin/merchants/new?error=" + encodeURIComponent("Enter the Pay Center site id, or choose to create a new site"));
  const m = await createMerchant({
    name,
    pcBaseUrl: create ? ag!.baseUrl : str(form, "pcBaseUrl") || "https://api.paycenter.app",
    pcSiteId: create ? "pending" : pcSiteId,
    pcAccessToken: create ? null : str(form, "pcAccessToken") || null,
    fbAccountId: str(form, "fbAccountId") || null,
    notifyMode: pick(str(form, "notifyMode"), ["link", "customer"] as const, "customer"),
    recordOn: pick(str(form, "recordOn"), ["settled", "captured"] as const, "settled"),
    reversals: pick(str(form, "reversals"), ["review", "auto"] as const, "review"),
  });
  if (!create) redirect(`/admin/merchants/${m.id}?msg=${encodeURIComponent("Merchant created. Next: connect FreshBooks.")}`);

  // Create the Pay Center site now that we have an id and a webhook secret for it.
  let site;
  try {
    site = await addUpdateSite({
      externalId: `pbs:${m.id}`,
      name,
      merchantId: str(form, "merchantId") || undefined,
      webhookUrl: settingsFor(m).webhookUrl!,
      location: { addressLine1: str(form, "addressLine1"), city: str(form, "city"), stateCode: str(form, "stateCode").toUpperCase(), zipCode: str(form, "zipCode"), phone: str(form, "phone") },
    });
  } catch (err) {
    await storeFor(m).log("error", "Pay Center site could not be created", { error: String(err) });
    back(m.id, `Merchant saved, but Pay Center did not create the site: ${(err as Error).message}. Enter a site id in Settings or try again.`, true);
  }
  await updateMerchant(m.id, { pcSiteId: site!.id });
  await storeFor(m).log("info", `Pay Center site ${site!.action}`, { pcSiteId: site!.id, agency: ag!.id });
  redirect(`/admin/merchants/${m.id}?msg=${encodeURIComponent(`Merchant created with Pay Center site ${site!.id}. Next: connect FreshBooks.`)}`);
}

export async function saveMerchant(form: FormData) {
  await guard();
  const id = str(form, "id");
  await updateMerchant(id, {
    name: str(form, "name"),
    pcBaseUrl: str(form, "pcBaseUrl"),
    pcSiteId: str(form, "pcSiteId"),
    pcAccessToken: str(form, "pcAccessToken") || null,
    fbAccountId: str(form, "fbAccountId") || null,
    notifyMode: pick(str(form, "notifyMode"), ["link", "customer"] as const, "customer"),
    recordOn: pick(str(form, "recordOn"), ["settled", "captured"] as const, "settled"),
    reversals: pick(str(form, "reversals"), ["review", "auto"] as const, "review"),
    status: pick(str(form, "status"), ["setup", "active", "paused"] as const, "setup"),
  });
  back(id, "Saved.");
}

export async function makeConnectLink(form: FormData) {
  await guard();
  const id = str(form, "id");
  await issueConnectToken(id);
  back(id, "Connect link created. Send it to the merchant; it works for 7 days.");
}

export async function registerMerchantWebhooks(form: FormData) {
  await guard();
  const id = str(form, "id");
  const m = await getMerchant(id);
  if (!m) redirect("/admin");
  try {
    const out = await registerWebhooks(m);
    back(id, `Registered ${Object.keys(out).length} webhooks. FreshBooks verifies them within a few seconds.`);
  } catch (err) {
    if ((err as any)?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
    back(id, `Could not register webhooks: ${String(err)}`, true);
  }
}

export async function recheckPayments(form: FormData) {
  await guard();
  const id = str(form, "id");
  const m = await getMerchant(id);
  if (!m) redirect("/admin");
  try {
    const r = await reconcile(depsFor(m), { full: true });
    const counts = Object.entries((r.counts as Record<string, number>) ?? {}).map(([k, v]) => `${v} ${k}`).join(", ") || "no payments in the last 7 days";
    back(id, `Re-check done: ${counts}.`);
  } catch (err) {
    if ((err as any)?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
    back(id, `Re-check failed: ${String(err)}`, true);
  }
}

export async function resolveItem(form: FormData) {
  await guard();
  const id = str(form, "id");
  const m = await getMerchant(id);
  if (!m) redirect("/admin");
  const note = str(form, "note") || "Handled manually";
  await storeFor(m).resolveLedger(str(form, "pcPaymentId"), note);
  await storeFor(m).log("info", "Held item marked resolved", { pcPaymentId: str(form, "pcPaymentId"), note });
  back(id, "Marked as resolved.");
}

export async function pushInvoice(form: FormData) {
  await guard();
  const id = str(form, "id");
  const invoiceId = str(form, "invoiceId").replace(/\D/g, "");
  const m = await getMerchant(id);
  if (!m) redirect("/admin");
  if (!invoiceId) back(id, "Enter the FreshBooks invoice id (the number in the invoice's web address).", true);
  try {
    const r = await syncInvoice(depsFor(m), invoiceId);
    back(id, `Invoice ${invoiceId}: ${r.status}${r.reason ? ` (${r.reason})` : ""}.`, r.status === "needs_review");
  } catch (err) {
    if ((err as any)?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
    back(id, `Invoice ${invoiceId}: ${String(err)}`, true);
  }
}
