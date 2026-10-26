-- Runs the daily backup every night at 03:00 in Brasília (06:00 UTC), using Supabase's pg_cron.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'wf-daily-backup';
  perform cron.schedule('wf-daily-backup', '0 6 * * *', 'select public.wf_backup_all()');
end;
$$;
