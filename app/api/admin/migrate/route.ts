import postgres from "postgres";
import { denied, isAdmin } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Applies the schema changes this build needs, straight to Postgres. Every statement is idempotent
 * (IF NOT EXISTS), so running it twice is harmless. Mirrors supabase/migrations/0004_pbs_pay.sql.
 * Needs POSTGRES_URL_NON_POOLING (Vercel's Supabase integration sets it).
 */
const STATEMENTS = [
  `alter table merchants add column if not exists payments text not null default 'paycenter' check (payments in ('paycenter', 'pbspay'))`,
  `alter table merchants add column if not exists mx_merchant_id text`,
  `alter table merchants add column if not exists fee_rate_bps int not null default 300 check (fee_rate_bps >= 0 and fee_rate_bps <= 400)`,
  `alter table merchants add column if not exists ach_enabled boolean not null default true`,
  `create table if not exists pay_requests (
     id text primary key, merchant_id uuid not null references merchants(id) on delete cascade, external_id text not null,
     invoice_number text not null, description text, total_cents bigint not null, due_date date, customer jsonb,
     status text not null default 'open' check (status in ('open', 'paid', 'void')), notified_at timestamptz,
     created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (merchant_id, external_id))`,
  `alter table pay_requests enable row level security`,
  `create table if not exists pay_payments (
     id text primary key, merchant_id uuid not null references merchants(id) on delete cascade, request_id text references pay_requests(id) on delete set null,
     kind text not null check (kind in ('payment', 'refund')), method text not null check (method in ('card', 'ach')), status text not null,
     invoice_cents bigint not null, fee_cents bigint not null default 0, total_cents bigint not null, mx_payment_id text not null, mx_batch text,
     orig_payment_id text, paid_on timestamptz not null default now(), raw jsonb, updated_at timestamptz not null default now())`,
  `alter table pay_payments enable row level security`,
  `create index if not exists pay_payments_merchant_updated on pay_payments (merchant_id, updated_at)`,
  `create index if not exists pay_payments_request on pay_payments (request_id)`,
  `notify pgrst, 'reload schema'`,
];

export async function POST(req: Request) {
  if (process.env.VERCEL_ENV !== "preview" && !(await isAdmin(req))) return denied();
  const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!url) return Response.json({ error: "POSTGRES_URL_NON_POOLING is not set" }, { status: 503 });
  const sql = postgres(url, { ssl: "require", max: 1, prepare: false });
  const applied: string[] = [];
  try {
    for (const s of STATEMENTS) {
      await sql.unsafe(s);
      applied.push(s.split("\n")[0].slice(0, 80));
    }
    const cols = await sql`select column_name from information_schema.columns where table_name = 'merchants' and column_name in ('payments','mx_merchant_id','fee_rate_bps','ach_enabled') order by 1`;
    return Response.json({ status: "ok", applied, merchantColumns: cols.map((c) => c.column_name) });
  } catch (err) {
    return Response.json({ status: "error", applied, error: String((err as Error).message ?? err) }, { status: 500 });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
