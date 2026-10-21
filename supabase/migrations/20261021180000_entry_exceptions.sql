-- Per-occurrence changes to recurring entries, and an end date so a series can be
-- split into "before" and "from here on".

alter table public.wf_entries
  add column end_date date,
  add constraint wf_entries_end_after_start check (end_date is null or end_date >= date),
  add constraint wf_entries_id_user_key unique (id, user_id);

-- One row per changed occurrence, keyed by the date the occurrence originally fell on.
-- action 'skip' removes that occurrence; 'modify' overrides its amount, date and/or description.
create table public.wf_entry_exceptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id         uuid not null,
  occurrence_date  date not null,
  action           text not null check (action in ('skip', 'modify')),
  amount           numeric(14, 2) check (amount is null or amount > 0),
  date             date,
  description      text check (description is null or char_length(description) <= 200),
  created_at       timestamptz not null default now(),
  unique (entry_id, occurrence_date),
  -- a modify must change something; a skip carries no overrides
  check ((action = 'skip' and amount is null and date is null and description is null)
      or (action = 'modify' and (amount is not null or date is not null or description is not null))),
  foreign key (entry_id, user_id) references public.wf_entries (id, user_id) on delete cascade
);

create index wf_entry_exceptions_user_idx on public.wf_entry_exceptions (user_id);

alter table public.wf_entry_exceptions enable row level security;
create policy "own exceptions" on public.wf_entry_exceptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.wf_entry_exceptions from anon;
grant select, insert, update, delete on public.wf_entry_exceptions to authenticated;
