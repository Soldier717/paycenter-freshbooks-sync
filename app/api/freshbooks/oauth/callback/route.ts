import { appUrl } from "@/lib/config";
import { verify } from "@/lib/crypto";
import { oauthApp, storeFor } from "@/lib/deps";
import { listAccounts, requestTokens } from "@/lib/freshbooks";
import { getMerchant, merchantByAcctAccount, updateMerchant } from "@/lib/merchants";
import { registerWebhooks } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:4rem auto;padding:0 16px;line-height:1.5">
<h1 style="font-size:1.4rem">${title}</h1>${body}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = verify(url.searchParams.get("state") ?? "");
  if (!code || !state?.m) return page("Link expired", "<p>This sign-in link has expired or is invalid. Please start again.</p>", 400);

  const m = await getMerchant(state.m);
  if (!m) return page("Unknown merchant", "<p>This connect link does not match a merchant.</p>", 404);
  if (m.accounting !== "freshbooks") return page("Wrong system", `<p><b>${m.name}</b> is set up for QuickBooks, not FreshBooks.</p>`, 400);
  const who = state.who === "merchant" ? "merchant" : "admin";
  const adminLink = `${appUrl()}/admin/merchants/${m.id}`;

  const tokens = await requestTokens(oauthApp(), { grant_type: "authorization_code", code });
  const accounts = await listAccounts(tokens.accessToken);

  // Bind the merchant to exactly one FreshBooks account, and never silently to a different one.
  let accountId = m.acctAccountId;
  if (accountId) {
    if (!accounts.some((a) => a.accountId === accountId))
      return page("Wrong FreshBooks login",
        `<p>This login does not have access to the FreshBooks account set up for <b>${m.name}</b>.</p>
         <p>Please sign out of FreshBooks and try again with the right login.</p>`, 403);
  } else if (accounts.length === 1) {
    accountId = accounts[0].accountId;
    const other = await merchantByAcctAccount("freshbooks", accountId);
    if (other && other.id !== m.id)
      return page("Already connected elsewhere",
        `<p>This FreshBooks account (<code>${accountId}</code>, ${accounts[0].name}) is already connected to <b>${other.name}</b>.</p>
         <p>${who === "admin"
           ? `Sign in with a different FreshBooks login for <b>${m.name}</b>, or clear the FreshBooks account id on <a href="${appUrl()}/admin/merchants/${other.id}">${other.name}</a> first and try again.`
           : "Please tell Priority Business Solutions; this login is already in use for another business."}</p>`, 409);
    await updateMerchant(m.id, { acctAccountId: accountId });
  } else {
    const list = accounts.map((a) => `<li><code>${a.accountId}</code> — ${a.name}</li>`).join("");
    return page("Which business?",
      `<p>This FreshBooks login has several businesses. ${who === "admin" ? "Enter the right account id on the merchant page, then connect again." : "Please tell PBS which business this is for."}</p><ul>${list}</ul>`, 409);
  }

  const s = storeFor(m);
  await s.saveTokens(tokens);
  await s.log("info", "FreshBooks connected", { accountId, by: who });

  let webhookNote = "";
  try {
    if ((await s.countCallbacks()) === 0) await registerWebhooks({ ...m, acctAccountId: accountId });
  } catch (err) {
    webhookNote = `<p style="color:#b00">Connected, but the invoice webhooks could not be registered: ${String(err)}. Use "Register webhooks" on the merchant page.</p>`;
    await s.log("error", "Webhook registration failed after connect", { error: String(err) });
  }

  if (who === "admin") return Response.redirect(adminLink, 302);
  return page("Connected",
    `<p>FreshBooks is now connected for <b>${m.name}</b>. You can close this window.</p>${webhookNote}`);
}
