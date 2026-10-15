# Pay Center accounting sync (FreshBooks and QuickBooks Online)

Connects a merchant's accounting system to Priority Pay Center: invoices become Pay Center payment
requests, and payments are recorded back on the invoice. One service, many merchants, each on
FreshBooks or QuickBooks Online.

Status: FreshBooks proven end to end on a trial account and a Pay Center demo site, and live on a
production Pay Center site (card payments). QuickBooks is built and unit-tested against Intuit's API
shapes; it still needs its first run on an Intuit sandbox company (see "QuickBooks setup"). ACH,
returns and refunds are still to be exercised live on either system.

## What it does

1. An invoice is created, sent or edited. FreshBooks calls `/api/freshbooks/webhook`;
   Intuit calls `/api/quickbooks/webhook` (one address for the whole app, in batches, ids only).
2. If the invoice is ready (FreshBooks: sent; QuickBooks: any open invoice, or only emailed ones,
   per merchant), in USD and wholly unpaid, the service creates the matching Pay Center invoice
   (API v4) and stores the returned pay link.
3. The customer pays in Pay Center. Pay Center calls `/api/paycenter/webhook/<secret>`.
4. The service re-reads the payment from Pay Center and posts the invoice allocation to the
   accounting system. For QuickBooks it can also book the customer's card/ACH fee separately.
5. A daily job re-checks recent Pay Center payments in case a webhook was missed.

## Rules

| Situation | What happens |
| --- | --- |
| Checkout fee or tip | Never part of the invoice payment. Only the amount allocated to the invoice is posted against the invoice. |
| Customer fee (QuickBooks, when turned on) | Booked as its own sales receipt on the merchant's fee item, same deposit account, same date. The figure is the one Pay Center reports (what the customer paid beyond the invoice, in whole cents); nothing is calculated from a percentage, so the invoice payment plus the fee always equals the gross the processor settles. If Pay Center's figures don't add up, the whole payment is held and nothing is written. |
| Card or ACH not yet settled | Waits. (A merchant can be set to post on approval instead.) |
| Same payment notified twice | Posted once. The ledger's primary key blocks a second post. |
| Partial payment | Posted for the amount paid. |
| ACH return, void, chargeback, refund | Held for a person by default. A merchant can be set to adjust FreshBooks automatically. |
| Payment larger than the FreshBooks balance | Held for review. |
| Accounting write times out | Marked `uncertain`. Never retried automatically. |
| Fee write fails after the payment posted | Payment stays posted; the item is held with the fee amount so a person adds it. |
| Invoice edited before any payment | Pay Center invoice is updated. |
| Invoice edited or deleted after a payment | Held for review. |
| Draft, partly paid or non-USD invoice | Skipped. |

Held items are listed on each merchant's admin page.

By default Pay Center texts or emails the customer the payment request. The alternative keeps the
pay link private, for merchants who put it on their own invoice.

## Merchants

Every merchant has its own row in the `merchants` table: Pay Center site and token, which
accounting system and account/company, and the rules above. The admin pages at `/admin` manage
them; nothing per merchant lives in environment settings. (Column names `fb_account_id`,
`fb_invoice_id` and `fb_payment_id` predate QuickBooks and hold the realm id, Invoice Id and
Payment Id for a QuickBooks merchant.)

Adding a merchant:

1. `/admin` → Add merchant. With `PAYCENTER_AGENCY_TOKEN` set, a production Pay Center site is created under the PBS agency (card + ACH enabled, webhook pointed here, API-only access); Hyfin attaches the gateway/processor. Otherwise enter an existing site id and token.
2. Choose FreshBooks or QuickBooks. On the merchant page, either click "Connect … (I have the
   login)" or "Create a link for the merchant" and send the link. They sign in and approve; a
   QuickBooks user also picks which company.
3. FreshBooks: the four invoice webhooks register automatically after connecting; the Setup list
   shows when FreshBooks has verified them. QuickBooks: nothing to register per merchant.
4. QuickBooks: pick the deposit account (default Undeposited Funds) and, if fees are to be booked,
   click "Create fee item" (makes a "Card Processing Fee" service item and a "Card Processing Fee
   Income" account, or reuses them) or pick an existing service item.
5. Set the status to Live. Invoices from that account are now picked up.

### How the books come out (QuickBooks, fees on)

A $100.00 invoice paid by card with a 3% fee: the customer pays $103.00. QuickBooks gets a $100.00
Payment against the invoice and a $3.00 sales receipt on the fee item, both in Undeposited Funds
with the same date. On the bank deposit screen the bookkeeper selects both and adds a negative line
for the processor's cost from the statement ($3.02, say); the deposit matches the $99.98 that landed,
the invoice is paid in full, and the fee sits in its own income account. The processor cost is per
batch, not per payment, so that line stays the bookkeeper's; a later step could pull it from the
processor's batch report.

Items held for review (ACH returns, refunds, overpayments) appear on the merchant page with a
"Mark resolved" box for whoever handles them in FreshBooks.

## One-time setup of the service

1. Supabase project; run the files in `supabase/migrations/` in order.
2. One FreshBooks developer app at `my.freshbooks.com/#/developer`.
   Redirect URI: `https://<your-app>/api/freshbooks/oauth/callback`.
   Scopes: `user:profile:read user:invoices:read user:clients:read user:payments:read user:payments:write`.
3. Deploy to Vercel with the settings in `.env.example`.

### QuickBooks setup

1. Intuit developer account at developer.intuit.com (free) → Create an app → QuickBooks Online and
   Payments → scope `com.intuit.quickbooks.accounting`.
2. Keys & credentials: the app has **Development** keys (work with the sandbox company Intuit gives
   every developer) and **Production** keys. Put the Development pair in `QUICKBOOKS_SANDBOX_CLIENT_ID`
   / `QUICKBOOKS_SANDBOX_CLIENT_SECRET` and the Production pair in `QUICKBOOKS_CLIENT_ID` /
   `QUICKBOOKS_CLIENT_SECRET`. Each key set needs the redirect URI
   `https://<your-app>/api/quickbooks/oauth/callback`.
3. Webhooks (per key set): endpoint `https://<your-app>/api/quickbooks/webhook`, entity **Invoice**
   (all operations). Intuit shows a verifier token; put it in `QUICKBOOKS_WEBHOOK_VERIFIER` /
   `QUICKBOOKS_SANDBOX_WEBHOOK_VERIFIER`. Deliveries are batched and can lag a few minutes; the daily
   re-check covers anything lost.
4. First run: add a merchant with accounting = QuickBooks and keys = Sandbox, connect it with the
   developer login (choose the sandbox company), create an invoice in the sandbox, and watch the
   merchant page.
5. Before other companies can connect with the Production keys, Intuit requires the app to go through
   its review (privacy policy, EULA, security questionnaire). Your own company can use Production keys
   before that. Budget a couple of weeks.
6. Intuit refresh tokens stop working after 100 days without use; each API call renews them, and the
   merchant page shows the renew-by date. A merchant that goes quiet for 100 days has to connect again.

## To confirm per Pay Center site

- The site has the `integrations.hyfin_api_access` feature and its webhook version is 4.0.
- Pay Center webhooks carry no signature in the docs. The per-merchant secret URL plus the re-read covers this.
- How quickly payments move from `captured` to `settled`.
- FreshBooks payment type is `Other` with the Pay Center id in the note. Confirm with the bookkeeper.
- Fees are excluded from FreshBooks and not booked anywhere else for FreshBooks merchants yet.
- The Pay Center payment record's fee field name. The service uses `extraFees` / `extra_fees` when
  present and otherwise the difference between the amount paid and the invoice allocation; the
  "Posted payment" log line lists the fields each payment actually carried.
- A payment recorded directly in FreshBooks (a mailed check) does not reduce the Pay Center request.

## Development

    npm install
    npm test
    npm run typecheck
