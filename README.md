# Pay Center / FreshBooks sync

Hosted version of the FreshBooks + Priority Pay Center staging pilot. It does automatically
what the pilot's `connector.py` did by hand, and keeps the pilot's safety rules.

Status: built and tested against mocks (22 tests). Not deployed. No live call has been made
to either provider, so provider behaviour is unverified until the first sandbox run.

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
| Card or ACH not yet settled | Waits. (`RECORD_ON=captured` posts earlier.) |
| Same payment notified twice | Posted once. The ledger's primary key blocks a second post. |
| Partial payment | Posted for the amount paid. |
| ACH return, void, chargeback, refund | Held for a person by default. `REVERSALS=auto` removes or reduces the FreshBooks payment. |
| Payment larger than the FreshBooks balance | Held for review. |
| FreshBooks write times out | Marked `uncertain`. Never retried automatically. |
| Invoice edited before any payment | Pay Center invoice is updated. |
| Invoice edited or deleted after a payment | Held for review. |
| Draft, partly paid or non-USD invoice | Skipped. |

Held items are listed at `GET /api/admin/status`.

By default nobody is contacted: Pay Center returns a pay link and the service stores it
(`PAYCENTER_NOTIFY_MODE=link`). `customer` mode has Pay Center text or email the request.

## Setup

1. Create a Supabase project and run `supabase/schema.sql`.
2. In a FreshBooks **test** account, create a developer app at `my.freshbooks.com/#/developer`.
   Redirect URI: `https://<your-app>/api/freshbooks/oauth/callback`.
   Scopes: `user:profile:read user:invoices:read user:clients:read user:payments:read user:payments:write`.
3. Deploy to Vercel and set the variables in `.env.example`. The Pay Center token goes only there.
4. Open `https://<your-app>/api/freshbooks/oauth/start?key=<ADMIN_SECRET>` and approve.
5. `curl -X POST -H "x-admin-secret: <ADMIN_SECRET>" https://<your-app>/api/admin/register-webhooks`

## First test

1. Create a test client and a $1.00 invoice in FreshBooks, and mark it sent.
2. `GET /api/admin/status` should show "Linked FreshBooks invoice to Pay Center".
   The pay link is in the `invoice_map` table.
3. Pay with the staging test card from Pay Center support.
4. Once the payment settles, the FreshBooks invoice should show paid.

`POST /api/admin/sync` with `{"invoice":"<id>"}` or `{"payment":"<id>"}` runs either step by hand.

## To confirm in the sandbox

- The site has the `integrations.hyfin_api_access` feature and its webhook version is 4.0.
- Pay Center webhooks carry no signature in the docs. The secret URL plus the re-read covers this.
- How quickly a staging payment moves from `captured` to `settled`.
- FreshBooks payment type is `Other` with the Pay Center id in the note. Confirm with the bookkeeper.
- Whether a refund also changes the original payment's status. The service acts on the refund record only.
- Fees are excluded from FreshBooks. They are not booked anywhere else yet.
- A payment recorded directly in FreshBooks (a mailed check) does not reduce the Pay Center request.

## Development

    npm install
    npm test
    npm run typecheck
