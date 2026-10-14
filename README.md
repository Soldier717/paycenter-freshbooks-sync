# Pay Center / FreshBooks sync

Hosted version of the FreshBooks + Priority Pay Center staging pilot. It does automatically
what the pilot's `connector.py` did by hand, and keeps the pilot's safety rules.

Status: deployed and proven end to end on a FreshBooks trial account and a Pay Center demo site
(invoice → payment request → card payment → FreshBooks marked paid). ACH, returns and refunds are
still to be exercised live. Multi-merchant: each merchant is configured at `/admin`.

## What it does

1. An invoice is created, sent or edited in FreshBooks. FreshBooks calls `/api/freshbooks/webhook`.
2. If the invoice is sent, in USD and wholly unpaid, the service creates the matching Pay Center
   invoice (API v4) and stores the returned pay link.
3. The customer pays in Pay Center. Pay Center calls `/api/paycenter/webhook/<secret>`.
4. The service re-reads the payment from Pay Center and posts the invoice allocation to FreshBooks.
5. A daily job re-checks recent Pay Center payments in case a webhook was missed.

## Rules

| Situation | What happens |
| --- | --- |
| Checkout fee or tip | Never posted. Only the amount allocated to the invoice goes to FreshBooks. |
| Card or ACH not yet settled | Waits. (A merchant can be set to post on approval instead.) |
| Same payment notified twice | Posted once. The ledger's primary key blocks a second post. |
| Partial payment | Posted for the amount paid. |
| ACH return, void, chargeback, refund | Held for a person by default. A merchant can be set to adjust FreshBooks automatically. |
| Payment larger than the FreshBooks balance | Held for review. |
| FreshBooks write times out | Marked `uncertain`. Never retried automatically. |
| Invoice edited before any payment | Pay Center invoice is updated. |
| Invoice edited or deleted after a payment | Held for review. |
| Draft, partly paid or non-USD invoice | Skipped. |

Held items are listed on each merchant's admin page.

By default Pay Center texts or emails the customer the payment request. The alternative keeps the
pay link private, for merchants who put it on their own invoice.

## Merchants

Every merchant has its own row in the `merchants` table: Pay Center site and token, FreshBooks
account, and the three rules above. The admin pages at `/admin` manage them; nothing per merchant
lives in environment settings.

Adding a merchant:

1. `/admin` → Add merchant. Enter the name and their Pay Center site id and token.
2. On the merchant page, either click "Connect FreshBooks myself" (if you have their login) or
   "Create a connect link" and send the link to the merchant. They sign in to FreshBooks and approve.
3. The four invoice webhooks register automatically after connecting. The Setup list shows when
   FreshBooks has verified them.
4. Set the status to Active. Invoices from that account are now picked up.

Items held for review (ACH returns, refunds, overpayments) appear on the merchant page with a
"Mark resolved" box for whoever handles them in FreshBooks.

## One-time setup of the service

1. Supabase project; run the files in `supabase/migrations/` in order.
2. One FreshBooks developer app at `my.freshbooks.com/#/developer`.
   Redirect URI: `https://<your-app>/api/freshbooks/oauth/callback`.
   Scopes: `user:profile:read user:invoices:read user:clients:read user:payments:read user:payments:write`.
3. Deploy to Vercel with the settings in `.env.example`.

## To confirm per Pay Center site

- The site has the `integrations.hyfin_api_access` feature and its webhook version is 4.0.
- Pay Center webhooks carry no signature in the docs. The per-merchant secret URL plus the re-read covers this.
- How quickly payments move from `captured` to `settled`.
- FreshBooks payment type is `Other` with the Pay Center id in the note. Confirm with the bookkeeper.
- Fees are excluded from FreshBooks. They are not booked anywhere else yet.
- A payment recorded directly in FreshBooks (a mailed check) does not reduce the Pay Center request.

## Development

    npm install
    npm test
    npm run typecheck
