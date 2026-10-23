-- Codes pasted into iPhone Shortcuts often pick up surrounding spaces or a trailing newline,
-- and some keyboards capitalise the first letter. Codes are lowercase hex with a "wfi_" prefix,
-- so normalising before hashing accepts those pastes without weakening the 48-hex-digit secret.
create or replace function public.wf_import(p_token text, p_amount text, p_merchant text default null, p_card text default null, p_date text default null)
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
   where t.token_hash = encode(extensions.digest(lower(btrim(coalesce(p_token, ''), E' \t\r\n')), 'sha256'), 'hex');
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
