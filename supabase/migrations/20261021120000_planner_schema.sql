-- Wodtke Finanças: per-user planner data.
-- Every table is owned by auth.users and locked down with row-level security,
-- so the public anon key can only ever reach the signed-in user's own rows.

create table public.wf_settings (
  user_id         uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  start_balance   numeric(14, 2) not null default 0,
  start_date      date not null default date_trunc('month', now())::date,
  budget_monthly  numeric(14, 2) not null default 0 check (budget_monthly >= 0),
  budget_divisor  text not null default 'month' check (budget_divisor in ('month', '28', '30', '31')),
  theme           text not null default 'system' check (theme in ('light', 'dark', 'system')),
  updated_at      timestamptz not null default now()
);

create table public.wf_tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  unique (id, user_id)
);

create table public.wf_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  close_day   smallint not null check (close_day between 1 and 31),
  due_day     smallint not null check (due_day between 1 and 31),
  created_at  timestamptz not null default now(),
  unique (id, user_id)
);

create table public.wf_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type          text not null check (type in ('in', 'out', 'daily', 'save', 'card')),
  amount        numeric(14, 2) not null check (amount > 0),
  description   text not null default '' check (char_length(description) <= 200),
  date          date not null,
  repeat        text not null default 'none' check (repeat in ('none', 'monthly', 'weekly', 'daily', 'installments')),
  installments  smallint not null default 1 check (installments between 1 and 120),
  tag_id        uuid,
  card_id       uuid,
  created_at    timestamptz not null default now(),
  -- card purchases must name a card; nothing else may
  check ((type = 'card') = (card_id is not null)),
  -- composite keys stop a row from pointing at another user's tag or card
  foreign key (tag_id, user_id) references public.wf_tags (id, user_id) on delete set null (tag_id),
  foreign key (card_id, user_id) references public.wf_cards (id, user_id) on delete cascade
);

create index wf_entries_user_date_idx on public.wf_entries (user_id, date);
create index wf_tags_user_idx on public.wf_tags (user_id);
create index wf_cards_user_idx on public.wf_cards (user_id);

-- keep settings.updated_at current
create function public.wf_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger wf_settings_touch before update on public.wf_settings
  for each row execute function public.wf_touch_updated_at();

-- row-level security: owner-only access on every table
alter table public.wf_settings enable row level security;
alter table public.wf_tags     enable row level security;
alter table public.wf_cards    enable row level security;
alter table public.wf_entries  enable row level security;

create policy "own settings" on public.wf_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own tags" on public.wf_tags for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own cards" on public.wf_cards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own entries" on public.wf_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- signed-out visitors get nothing
revoke all on public.wf_settings, public.wf_tags, public.wf_cards, public.wf_entries from anon;
grant select, insert, update, delete on public.wf_settings, public.wf_tags, public.wf_cards, public.wf_entries to authenticated;
