-- Pay Center <-> FreshBooks sync tables.
-- Row level security is on with no policies: only the service role can read or write.

create table if not exists fb_tokens (
  id            int primary key default 1 check (id = 1),
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null
);

create table if not exists fb_callbacks (
  callback_id text primary key,
  event       text not null,
  verifier    text,
  verified    boolean not null default false
);

create table if not exists invoice_map (
  fb_invoice_id  text primary key,
  pc_invoice_id  text not null unique,
  invoice_number text,
  total_cents    bigint not null,
  fingerprint    text not null,
  pay_link       text,
  updated_at     timestamptz not null default now()
);

-- One row per Pay Center payment or refund. The primary key is what prevents double posting.
create table if not exists payment_ledger (
  pc_payment_id text primary key,
  pc_invoice_id text,
  kind          text not null check (kind in ('payment', 'refund')),
  state         text not null check (state in ('posting', 'posted', 'uncertain', 'review', 'reversed', 'applied')),
  fb_payment_id text,
  cents         bigint not null default 0,
  reason        text,
  updated_at    timestamptz not null default now()
);
create index if not exists payment_ledger_invoice on payment_ledger (pc_invoice_id);

create table if not exists sync_state (
  key   text primary key,
  value text not null
);

create table if not exists sync_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  level   text not null,
  message text not null,
  detail  jsonb
);

alter table fb_tokens      enable row level security;
alter table fb_callbacks   enable row level security;
alter table invoice_map    enable row level security;
alter table payment_ledger enable row level security;
alter table sync_state     enable row level security;
alter table sync_log       enable row level security;
