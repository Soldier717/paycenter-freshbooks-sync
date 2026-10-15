import { requireAdmin } from "@/lib/admin-session";
import { agency } from "@/lib/paycenter-agency";
import { addMerchant } from "../../actions";
import { SettingsFields } from "../settings-fields";

export const dynamic = "force-dynamic";

export default async function NewMerchant({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireAdmin();
  const { error } = await searchParams;
  const ag = agency();
  return (
    <main style={{ maxWidth: 640 }}>
      <h1>Add merchant</h1>
      <p className="sub">
        {ag ? "A Pay Center site is created under the PBS agency automatically, or paste an existing site id." : "Pay Center details come from the merchant's Pay Center site."}{" "}
        FreshBooks is connected in the next step.
      </p>
      {error && <div className="flash bad">{error}</div>}
      <form action={addMerchant} className="card">
        <label htmlFor="name">Merchant name</label>
        <input id="name" name="name" required placeholder="Diane's Bookkeeping LLC" />

        <h2>Pay Center</h2>
        {ag && (
          <>
            <label htmlFor="siteMode">Site</label>
            <select id="siteMode" name="siteMode" defaultValue="create">
              <option value="create">Create a new production site under the PBS agency</option>
              <option value="existing">Use an existing site (enter id and token below)</option>
            </select>
            <div className="small muted">New sites are created on <code>{ag.baseUrl}</code> with card and ACH enabled, webhooks pointed at this app, and no Hyfin login (API only). Hyfin still attaches the gateway/processor.</div>
            <label htmlFor="merchantId">Processor MID (optional, recommended)</label>
            <input id="merchantId" name="merchantId" className="mono" />
            <div className="row">
              <div><label htmlFor="addressLine1">Address</label><input id="addressLine1" name="addressLine1" /></div>
              <div><label htmlFor="city">City</label><input id="city" name="city" /></div>
            </div>
            <div className="row">
              <div><label htmlFor="stateCode">State</label><input id="stateCode" name="stateCode" maxLength={2} placeholder="FL" /></div>
              <div><label htmlFor="zipCode">ZIP</label><input id="zipCode" name="zipCode" /></div>
              <div><label htmlFor="phone">Phone</label><input id="phone" name="phone" /></div>
            </div>
            <h3>Existing site (only if selected above)</h3>
          </>
        )}
        <label htmlFor="pcBaseUrl">API base URL</label>
        <input id="pcBaseUrl" name="pcBaseUrl" defaultValue="https://api.paycenter.app" />
        <div className="small muted">Use <code>https://stage-api.paycenter.app</code> for a demo site.</div>
        <label htmlFor="pcSiteId">Site id</label>
        <input id="pcSiteId" name="pcSiteId" className="mono" />
        <label htmlFor="pcAccessToken">Site access token</label>
        <input id="pcAccessToken" name="pcAccessToken" type="password" autoComplete="off" className="mono" />
        <div className="small muted">Stored encrypted. {ag ? "Not needed for sites under the PBS agency." : "Can be added later."}</div>

        <h2>FreshBooks</h2>
        <label htmlFor="fbAccountId">Account id (optional)</label>
        <input id="fbAccountId" name="fbAccountId" className="mono" placeholder="Filled in automatically when the merchant connects" />
        <h2>Rules</h2>
        <SettingsFields />
        <div style={{ marginTop: 18 }}><button className="btn primary" type="submit">Create merchant</button></div>
      </form>
    </main>
  );
}
