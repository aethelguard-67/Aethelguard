alter table public.block_incidents
  add column if not exists threat_score integer
    check (threat_score between 0 and 100),
  add column if not exists threat_details text[] not null default '{}';

notify pgrst, 'reload schema';
