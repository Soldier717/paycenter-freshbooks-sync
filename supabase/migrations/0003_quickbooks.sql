-- QuickBooks Online as a second accounting system, and customer fees booked separately.
-- Column names fb_account_id / fb_invoice_id / fb_payment_id are kept: for a QuickBooks merchant they
-- hold the realm id, the Invoice Id and the Payment Id.

alter table merchants add column if not exists accounting text not null default 'freshbooks'
  check (accounting in ('freshbooks', 'quickbooks'));
alter table merchants add column if not exists book_fees boolean not null default false;
alter table merchants add column if not exists qb_trigger text not null default 'open' check (qb_trigger in ('open', 'sent'));
alter table merchants add column if not exists qb_env text not null default 'production' check (qb_env in ('production', 'sandbox'));
alter table merchants add column if not exists qb_deposit_account_id text;
alter table merchants add column if not exists qb_fee_item_id text;

-- A FreshBooks account id and a QuickBooks realm id can never collide in practice, but the pair is what is unique.
alter table merchants drop constraint if exists merchants_fb_account_id_key;
create unique index if not exists merchants_accounting_account on merchants (accounting, fb_account_id) where fb_account_id is not null;

-- QuickBooks refresh tokens expire (about 100 days); FreshBooks ones do not.
alter table fb_tokens add column if not exists refresh_expires_at timestamptz;

-- The customer fee booked next to a payment.
alter table payment_ledger add column if not exists fee_cents bigint not null default 0;
alter table payment_ledger add column if not exists fee_txn_id text;

-- QuickBooks webhooks arrive in batches; the realm id routes each one to its merchant.
create index if not exists merchants_account on merchants (fb_account_id);
