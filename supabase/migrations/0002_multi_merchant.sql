-- Multi-merchant: every record belongs to a merchant.
-- The existing rows (the FreshBooks trial + Pay Center demo site) become the first merchant.

create table if not exists merchants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  status              text not null default 'setup' check (status in ('setup', 'active', 'paused')),
  fb_account_id       text unique,
  pc_base_url         text not null,
  pc_site_id          text not null,
  pc_access_token_enc text,
  pc_webhook_secret   text not null unique,
  notify_mode         text not null default 'customer' check (notify_mode in ('link', 'customer')),
  record_on           text not null default 'settled' check (record_on in ('settled', 'captured')),
  reversals           text not null default 'review' check (reversals in ('review', 'auto')),
  connect_token       text unique,
  connect_expires_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
alter table merchants enable row level security;

insert into merchants (id, name, status, fb_account_id, pc_base_url, pc_site_id, pc_webhook_secret, notify_mode, record_on, reversals)
values ('00000000-0000-4000-8000-000000000001', 'PBS test (FreshBooks trial / Pay Center demo)', 'active', 'Yp0LZ5',
        'https://stage-api.paycenter.app', '69a73edc717beada3d3f1a83',
        'd5e286935fb0c595522e1ea96ebe3fcd665beac566c2c6de', 'customer', 'settled', 'review')
on conflict (id) do nothing;

-- fb_tokens: one row per merchant
alter table fb_tokens add column if not exists merchant_id uuid references merchants(id) on delete cascade;
update fb_tokens set merchant_id = '00000000-0000-4000-8000-000000000001' where merchant_id is null;
alter table fb_tokens drop constraint if exists fb_tokens_pkey;
alter table fb_tokens drop constraint if exists fb_tokens_id_check;
alter table fb_tokens drop column if exists id;
alter table fb_tokens alter column merchant_id set not null;
alter table fb_tokens add primary key (merchant_id);

-- fb_callbacks
alter table fb_callbacks add column if not exists merchant_id uuid references merchants(id) on delete cascade;
update fb_callbacks set merchant_id = '00000000-0000-4000-8000-000000000001' where merchant_id is null;
alter table fb_callbacks alter column merchant_id set not null;
create index if not exists fb_callbacks_merchant on fb_callbacks (merchant_id, event);

-- invoice_map
alter table invoice_map add column if not exists merchant_id uuid references merchants(id) on delete cascade;
update invoice_map set merchant_id = '00000000-0000-4000-8000-000000000001' where merchant_id is null;
alter table invoice_map alter column merchant_id set not null;
alter table invoice_map drop constraint if exists invoice_map_pkey;
alter table invoice_map drop constraint if exists invoice_map_pc_invoice_id_key;
alter table invoice_map add primary key (merchant_id, fb_invoice_id);
alter table invoice_map add constraint invoice_map_pc_unique unique (merchant_id, pc_invoice_id);

-- payment_ledger
alter table payment_ledger add column if not exists merchant_id uuid references merchants(id) on delete cascade;
update payment_ledger set merchant_id = '00000000-0000-4000-8000-000000000001' where merchant_id is null;
alter table payment_ledger alter column merchant_id set not null;
alter table payment_ledger drop constraint if exists payment_ledger_pkey;
alter table payment_ledger add primary key (merchant_id, pc_payment_id);
alter table payment_ledger drop constraint if exists payment_ledger_state_check;
alter table payment_ledger add constraint payment_ledger_state_check
  check (state in ('posting', 'posted', 'uncertain', 'review', 'reversed', 'applied', 'resolved'));
alter table payment_ledger add column if not exists resolved_note text;

-- sync_state
alter table sync_state add column if not exists merchant_id uuid references merchants(id) on delete cascade;
update sync_state set merchant_id = '00000000-0000-4000-8000-000000000001' where merchant_id is null;
alter table sync_state alter column merchant_id set not null;
alter table sync_state drop constraint if exists sync_state_pkey;
alter table sync_state add primary key (merchant_id, key);

-- sync_log
alter table sync_log add column if not exists merchant_id uuid references merchants(id) on delete set null;
update sync_log set merchant_id = '00000000-0000-4000-8000-000000000001' where merchant_id is null;
create index if not exists sync_log_merchant on sync_log (merchant_id, id desc);
