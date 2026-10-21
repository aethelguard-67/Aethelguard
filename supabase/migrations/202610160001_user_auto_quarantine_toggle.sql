alter table public.profiles
  add column if not exists auto_quarantine_enabled boolean not null default true;

drop policy if exists "Users can update their own profile settings" on public.profiles;
create policy "Users can update their own profile settings"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

notify pgrst, 'reload schema';
