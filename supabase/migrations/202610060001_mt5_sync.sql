-- MT5取引の識別情報と同期用のサーバー専用テーブルを追加する。
alter table public.trades
  add column if not exists source text not null default 'manual',
  add column if not exists mt5_account text,
  add column if not exists mt5_deal_ticket text,
  add column if not exists mt5_position_id text,
  add column if not exists mt5_profit numeric not null default 0,
  add column if not exists commission numeric not null default 0,
  add column if not exists swap numeric not null default 0,
  add column if not exists fee numeric not null default 0;

create unique index if not exists trades_mt5_unique_deal
  on public.trades (user_id, mt5_account, mt5_deal_ticket);

create table if not exists public.mt5_sync_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_seen_at timestamptz
);

create table if not exists public.mt5_sync_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  summary jsonb,
  error text
);

alter table public.mt5_sync_tokens enable row level security;
alter table public.mt5_sync_requests enable row level security;
revoke all on public.mt5_sync_tokens, public.mt5_sync_requests from anon, authenticated;
grant all on public.mt5_sync_tokens, public.mt5_sync_requests to service_role;
grant select, insert, update on public.trades to service_role;
