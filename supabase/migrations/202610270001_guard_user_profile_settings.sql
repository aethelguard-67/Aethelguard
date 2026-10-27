create or replace function public.guard_user_profile_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) = old.id and not public.is_admin() then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.display_name is distinct from old.display_name
      or new.role is distinct from old.role
      or new.extension_active is distinct from old.extension_active
      or new.last_seen_at is distinct from old.last_seen_at then
      raise exception 'Users may only update their own auto-quarantine setting';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_user_profile_settings
  before update on public.profiles
  for each row execute function public.guard_user_profile_settings();
