-- ============================================================================
-- 0007_account_deletion.sql — tombstone fencing so late worker writes cannot
-- resurrect deleted user data (O02).
-- ============================================================================

create table if not exists deleted_users (
  user_id    text primary key,
  deleted_at timestamptz not null default now()
);

alter table if exists deleted_users enable row level security;

do $$
begin
  begin
    revoke all on table deleted_users from anon, authenticated;
  exception when undefined_table then null;
  end;
end $$;
