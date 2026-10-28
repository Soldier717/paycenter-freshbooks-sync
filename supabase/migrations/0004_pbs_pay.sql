-- PBS Pay: payments taken on MX Merchant through our own hosted pay page, as an alternative to Hyfin Pay Center.

alter table merchants add column if not exists payments text not null default 'paycenter' check (payments in ('paycenter', 'pbspay'));
alter table merchants add column if not exists mx_merchant_id text;
-- Card fee the customer pays on top of the invoice, in basis points (300 = 3%). ACH carries no fee.
alter table merchants add column if not exists fee_rate_bps int not null default 300 check (fee_rate_bps >= 0 and fee_rate_bps <= 400);
alter table merchants add column if not exists ach_enabled boolean not null default true;

-- A payment request: what Pay Center calls an invoice. One per accounting invoice.
create table if not exists pay_requests (
  id             text primary key,                       -- short random token; the pay link is /pay/<id>
  merchant_id    uuid not null references merchants(id) on delete cascade,
  external_id    text not null,                          -- e.g. quickbooks:<realm>:<invoiceId>
  invoice_number text not null,
  description    text,
  total_cents    bigint not null,
  due_date       date,
  customer       jsonb,                                  -- {firstName,lastName,email,mobilePhone}
  status         text not null default 'open' check (status in ('open', 'paid', 'void')),
  notified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (merchant_id, external_id)
);
alter table pay_requests enable row level security;

-- Every MX payment or refund we know about, in the shape the sync core reads.
create table if not exists pay_payments (
  id              text primary key,                      -- 'mx:<mx payment id>'
  merchant_id     uuid not null references merchants(id) on delete cascade,
  request_id      text references pay_requests(id) on delete set null,
  kind            text not null check (kind in ('payment', 'refund')),
  method          text not null check (method in ('card', 'ach')),
  status          text not null,                         -- captured | settled | declined | voided | returned | chargebacked | refunded
  invoice_cents   bigint not null,                       -- allocated to the invoice
  fee_cents       bigint not null default 0,             -- the customer fee we showed and charged
  total_cents     bigint not null,                       -- what the customer paid (invoice + fee)
  mx_payment_id   text not null,
  mx_batch        text,
  orig_payment_id text,                                  -- for refunds: the pay_payments id refunded
  paid_on         timestamptz not null default now(),
  raw             jsonb,
  updated_at      timestamptz not null default now()
);
alter table pay_payments enable row level security;
create index if not exists pay_payments_merchant_updated on pay_payments (merchant_id, updated_at);
create index if not exists pay_payments_request on pay_payments (request_id);
