-- Card credits: a card entry may be negative, which takes that amount off its invoice
-- (a refund, or the part of an invoice that was not paid and moves to the next one).
-- Every other type stays strictly positive.
alter table public.wf_entries drop constraint wf_entries_amount_check;
alter table public.wf_entries add constraint wf_entries_amount_check
  check (amount > 0 or (type = 'card' and amount < 0));

-- an occurrence's changed value follows its entry: never zero (skipping is its own action)
alter table public.wf_entry_exceptions drop constraint wf_entry_exceptions_amount_check;
alter table public.wf_entry_exceptions add constraint wf_entry_exceptions_amount_check
  check (amount is null or amount <> 0);
