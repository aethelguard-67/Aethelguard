do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'url_reputation_scan_results'
  ) then
    alter publication supabase_realtime add table public.url_reputation_scan_results;
  end if;
end;
$$;
