-- Backups: a snapshot of a person's whole planner (settings, categories, cards, entries, per-occurrence
-- changes and remembered merchants) kept as JSON. One "daily" snapshot per day is taken by a scheduled
-- job (next migration); people can also take one by hand and restore any of them from Ajustes.
-- Restoring first saves the current state ("before_restore"), so a restore can itself be undone.

create table public.wf_backups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day         date not null default (now() at time zone 'America/Sao_Paulo')::date,
  kind        text not null default 'daily' check (kind in ('daily', 'manual', 'before_restore')),
  data        jsonb not null,
  entries     integer not null default 0,
  created_at  timestamptz not null default now()
);
create unique index wf_backups_one_daily on public.wf_backups (user_id, day) where kind = 'daily';
create index wf_backups_user_idx on public.wf_backups (user_id, created_at desc);

alter table public.wf_backups enable row level security;
create policy "own backups" on public.wf_backups for select to authenticated using (user_id = (select auth.uid()));
-- reading the list is direct; taking and restoring backups only through the functions below
grant select on public.wf_backups to authenticated;

-- everything that makes up one person's planner, as JSON
create function public.wf_snapshot(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'version', 1,
    'settings',   (select to_jsonb(s) from public.wf_settings s where s.user_id = p_user),
    'tags',       coalesce((select jsonb_agg(to_jsonb(t)) from public.wf_tags t where t.user_id = p_user), '[]'::jsonb),
    'cards',      coalesce((select jsonb_agg(to_jsonb(c)) from public.wf_cards c where c.user_id = p_user), '[]'::jsonb),
    'entries',    coalesce((select jsonb_agg(to_jsonb(e)) from public.wf_entries e where e.user_id = p_user), '[]'::jsonb),
    'exceptions', coalesce((select jsonb_agg(to_jsonb(x)) from public.wf_entry_exceptions x where x.user_id = p_user), '[]'::jsonb),
    'rules',      coalesce((select jsonb_agg(to_jsonb(r)) from public.wf_merchant_rules r where r.user_id = p_user), '[]'::jsonb)
  );
$$;

-- store a snapshot; a daily one replaces that day's earlier daily one. Old ones are pruned:
-- daily kept 60 days, hand-made and before-restore copies kept to the latest 20.
create function public.wf_backup_user(p_user uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  snap jsonb := public.wf_snapshot(p_user);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  new_id uuid;
begin
  if p_kind = 'daily' then
    delete from public.wf_backups where user_id = p_user and kind = 'daily' and day = today;
  end if;
  insert into public.wf_backups (user_id, day, kind, data, entries)
  values (p_user, today, p_kind, snap, jsonb_array_length(snap -> 'entries'))
  returning id into new_id;
  delete from public.wf_backups where user_id = p_user and kind = 'daily' and day < today - 60;
  delete from public.wf_backups where id in (
    select id from public.wf_backups where user_id = p_user and kind <> 'daily' order by created_at desc offset 20);
  return new_id;
end;
$$;

-- the nightly job: a daily snapshot for everyone who uses the planner
create function public.wf_backup_all() returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid; n integer := 0;
begin
  for u in select user_id from public.wf_settings loop
    perform public.wf_backup_user(u, 'daily'); n := n + 1;
  end loop;
  return n;
end;
$$;

-- "Fazer backup agora" (at most 30 a day)
create function public.wf_backup_now() returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); new_id uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if (select count(*) from public.wf_backups where user_id = uid and kind = 'manual' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many backups today' using errcode = '54000';
  end if;
  new_id := public.wf_backup_user(uid, 'manual');
  return json_build_object('id', new_id);
end;
$$;

-- put the planner back exactly as it was in one backup (the inbox and import code are left alone)
create function public.wf_restore_backup(p_id uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); d jsonb; s public.wf_settings;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select data into d from public.wf_backups where id = p_id and user_id = uid;
  if d is null then raise exception 'backup not found' using errcode = 'P0002'; end if;

  perform public.wf_backup_user(uid, 'before_restore');

  delete from public.wf_entry_exceptions where user_id = uid;
  delete from public.wf_entries where user_id = uid;
  delete from public.wf_merchant_rules where user_id = uid;
  delete from public.wf_cards where user_id = uid;
  delete from public.wf_tags where user_id = uid;

  insert into public.wf_tags select * from jsonb_populate_recordset(null::public.wf_tags, d -> 'tags') where user_id = uid;
  insert into public.wf_cards select * from jsonb_populate_recordset(null::public.wf_cards, d -> 'cards') where user_id = uid;
  insert into public.wf_entries select * from jsonb_populate_recordset(null::public.wf_entries, d -> 'entries') where user_id = uid;
  insert into public.wf_entry_exceptions select * from jsonb_populate_recordset(null::public.wf_entry_exceptions, d -> 'exceptions') where user_id = uid;
  insert into public.wf_merchant_rules select * from jsonb_populate_recordset(null::public.wf_merchant_rules, d -> 'rules') where user_id = uid;

  if d -> 'settings' is not null and d -> 'settings' <> 'null'::jsonb then
    s := jsonb_populate_record(null::public.wf_settings, d -> 'settings');
    update public.wf_settings set start_balance = s.start_balance, start_date = s.start_date,
      budget_monthly = s.budget_monthly, budget_divisor = s.budget_divisor, theme = s.theme
    where user_id = uid;
  end if;

  return json_build_object('entries', jsonb_array_length(d -> 'entries'), 'tags', jsonb_array_length(d -> 'tags'), 'cards', jsonb_array_length(d -> 'cards'));
end;
$$;

revoke all on function public.wf_snapshot(uuid), public.wf_backup_user(uuid, text), public.wf_backup_all(),
  public.wf_backup_now(), public.wf_restore_backup(uuid) from public, anon, authenticated;
grant execute on function public.wf_backup_now(), public.wf_restore_backup(uuid) to authenticated;
