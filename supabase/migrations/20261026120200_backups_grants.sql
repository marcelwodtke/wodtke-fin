-- Supabase grants every new table to anon and authenticated by default; like the other planner tables,
-- backups are not reachable by anon at all, and signed-in people may only read their own (RLS).
revoke all on public.wf_backups from anon, authenticated;
grant select on public.wf_backups to authenticated;
