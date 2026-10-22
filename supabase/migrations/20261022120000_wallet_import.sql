-- Apple Wallet import: an iPhone Shortcuts automation posts each Apple Pay purchase to
-- public.wf_import(); purchases land in an inbox the user reviews in the app.
-- The shortcut authenticates with a per-user import code that can only ADD inbox items.

create extension if not exists pgcrypto with schema extensions;

-- One import code per user. Only its SHA-256 hash is stored.
create table public.wf_import_tokens (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create table public.wf_inbox (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount       numeric(14, 2) not null check (amount > 0),
  merchant     text not null default '' check (char_length(merchant) <= 200),
  card         text not null default '' check (char_length(card) <= 100),
  occurred_on  date not null,
  source       text not null default 'wallet' check (source in ('wallet')),
  status       text not null default 'pending' check (status in ('pending', 'done', 'discarded')),
  entry_id     uuid references public.wf_entries (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index wf_inbox_user_status_idx on public.wf_inbox (user_id, status, created_at);

-- "Always file PADARIA X as Dia a dia / Mercado": remembered per merchant.
create table public.wf_merchant_rules (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  merchant_key  text not null check (char_length(merchant_key) between 1 and 200),
  type          text not null check (type in ('out', 'daily', 'save', 'card')),
  tag_id        uuid,
  card_id       uuid,
  updated_at    timestamptz not null default now(),
  primary key (user_id, merchant_key),
  foreign key (tag_id, user_id) references public.wf_tags (id, user_id) on delete set null (tag_id),
  foreign key (card_id, user_id) references public.wf_cards (id, user_id) on delete set null (card_id)
);

alter table public.wf_import_tokens  enable row level security;
alter table public.wf_inbox          enable row level security;
alter table public.wf_merchant_rules enable row level security;

-- the owner may see whether a code exists (and revoke it); codes are only created by the function below
create policy "own token read"   on public.wf_import_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy "own token delete" on public.wf_import_tokens for delete to authenticated using (user_id = (select auth.uid()));
-- inbox items arrive through wf_import(); the owner reviews, updates and deletes them
create policy "own inbox read"   on public.wf_inbox for select to authenticated using (user_id = (select auth.uid()));
create policy "own inbox update" on public.wf_inbox for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own inbox delete" on public.wf_inbox for delete to authenticated using (user_id = (select auth.uid()));
create policy "own rules" on public.wf_merchant_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.wf_import_tokens, public.wf_inbox, public.wf_merchant_rules from anon;
grant select, delete on public.wf_import_tokens to authenticated;
grant select, update, delete on public.wf_inbox to authenticated;
grant select, insert, update, delete on public.wf_merchant_rules to authenticated;

-- Creates (or replaces) the caller's import code and returns it once, in clear text.
create function public.wf_rotate_import_token() returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  token text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  token := 'wfi_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.wf_import_tokens (user_id, token_hash) values (uid, encode(extensions.digest(token, 'sha256'), 'hex'))
    on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  return token;
end;
$$;
revoke all on function public.wf_rotate_import_token() from public, anon;
grant execute on function public.wf_rotate_import_token() to authenticated;

-- Called by the Shortcuts automation with the publishable key. It can only add a pending
-- inbox item for the code's owner; it never returns any stored data.
-- p_amount is text because Shortcuts may send "R$ 1.234,56", "1234.56" or "45,9".
create function public.wf_import(p_token text, p_amount text, p_merchant text default null, p_card text default null, p_date text default null)
returns json
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  s text;
  amt numeric;
  day date;
  new_id uuid;
begin
  select t.user_id into uid from public.wf_import_tokens t
   where t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if uid is null then raise exception 'invalid import code' using errcode = '28000'; end if;

  if (select count(*) from public.wf_inbox i where i.user_id = uid and i.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many imports, try again later' using errcode = '54000';
  end if;

  -- normalise the amount: keep digits and separators, then work out which separator is decimal
  s := regexp_replace(coalesce(p_amount, ''), '[^0-9,.]', '', 'g');
  if s ~ ',[0-9]{1,2}$' then s := replace(replace(s, '.', ''), ',', '.');          -- 1.234,56 / 45,9
  elsif s ~ '\.[0-9]{1,2}$' then s := replace(s, ',', '');                          -- 1,234.56 / 45.90
  else s := replace(replace(s, '.', ''), ',', '');                                  -- 1.234 / 45
  end if;
  if s !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'could not read the amount' using errcode = '22023'; end if;
  amt := s::numeric;
  if amt <= 0 or amt >= 1000000000 then raise exception 'amount out of range' using errcode = '22023'; end if;

  begin
    day := coalesce(nullif(left(p_date, 10), '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  exception when others then
    day := (now() at time zone 'America/Sao_Paulo')::date;
  end;

  insert into public.wf_inbox (user_id, amount, merchant, card, occurred_on)
  values (uid, amt, left(btrim(coalesce(p_merchant, '')), 200), left(btrim(coalesce(p_card, '')), 100), day)
  returning id into new_id;
  update public.wf_import_tokens set last_used_at = now() where user_id = uid;
  return json_build_object('ok', true, 'amount', amt, 'date', day);
end;
$$;
revoke all on function public.wf_import(text, text, text, text, text) from public;
grant execute on function public.wf_import(text, text, text, text, text) to anon, authenticated;
