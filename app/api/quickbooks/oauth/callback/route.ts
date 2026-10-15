import { appUrl } from "@/lib/config";
import { verify } from "@/lib/crypto";
import { quickBooksApp, storeFor } from "@/lib/deps";
import { getMerchant, merchantByAcctAccount, updateMerchant } from "@/lib/merchants";
import { companyName, qbClient, requestTokens } from "@/lib/quickbooks";

export const dynamic = "force-dynamic";

const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:4rem auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:1.4rem">${title}</h1>${body}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });

// Intuit sends back ?code=&state=&realmId=. The realm is the QuickBooks company the person chose.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const realmId = url.searchParams.get("realmId") ?? "";
  const state = verify(url.searchParams.get("state") ?? "");
  if (url.searchParams.get("error")) return page("Not connected", `<p>QuickBooks reported: ${url.searchParams.get("error")}. Nothing was changed.</p>`, 400);
  if (!code || !realmId || !state?.m) return page("Link expired", "<p>This sign-in link has expired or is invalid. Please start again.</p>", 400);

  const m = await getMerchant(state.m);
  if (!m) return page("Unknown merchant", "<p>This connect link does not match a merchant.</p>", 404);
  if (m.accounting !== "quickbooks") return page("Wrong system", `<p><b>${m.name}</b> is set up for FreshBooks, not QuickBooks.</p>`, 400);
  const who = state.who === "merchant" ? "merchant" : "admin";
  const adminLink = `${appUrl()}/admin/merchants/${m.id}`;

  // Bind the merchant to exactly one QuickBooks company, and never silently to a different one.
  if (m.acctAccountId && m.acctAccountId !== realmId)
    return page("Wrong QuickBooks company",
      `<p>This login chose a different QuickBooks company than the one set up for <b>${m.name}</b>.</p>
       <p>Please try again and pick the right company${who === "admin" ? ", or clear the company id on the merchant page first" : ""}.</p>`, 403);
  const other = await merchantByAcctAccount("quickbooks", realmId);
  if (other && other.id !== m.id)
    return page("Already connected elsewhere",
      `<p>This QuickBooks company (<code>${realmId}</code>) is already connected to <b>${other.name}</b>.</p>
       <p>${who === "admin"
         ? `Clear the company id on <a href="${appUrl()}/admin/merchants/${other.id}">${other.name}</a> first and try again.`
         : "Please tell Priority Business Solutions; this company is already in use for another business."}</p>`, 409);

  const app = quickBooksApp(m.qbEnv);
  const tokens = await requestTokens(app, { grant_type: "authorization_code", code });
  const s = storeFor(m);
  await s.saveTokens(tokens);
  if (!m.acctAccountId) await updateMerchant(m.id, { acctAccountId: realmId });

  let name = "";
  try { name = await companyName(qbClient(s, app, realmId), realmId); } catch { /* cosmetic */ }
  await s.log("info", "QuickBooks connected", { realmId, company: name, env: m.qbEnv, by: who });

  if (who === "admin") return Response.redirect(`${adminLink}?msg=${encodeURIComponent(`QuickBooks connected${name ? ` (${name})` : ""}. Next: choose the deposit account and fee item below.`)}`, 302);
  return page("Connected",
    `<p>QuickBooks${name ? ` (${name})` : ""} is now connected for <b>${m.name}</b>. You can close this window.</p>`);
}
