-- ══════════════════════════════════════════════════════════════
-- 현장영업 안내 회원가입/승인제 로그인 — 계정 테이블 + RPC
-- Supabase SQL Editor에서 전체 내용을 그대로 실행하세요.
-- (실행 전: Authentication → Providers → Email → "Confirm email" 꺼두기)
--
-- 실행 후 최초 관리자 지정 (반드시 1명 이상 필요):
--   1) admin.html에서 로그인할 관리자 계정으로 먼저 회원가입
--   2) SQL Editor에서 아래 실행 (본인 이메일로 교체)
--      update public.profiles set is_admin = true
--      where id = (select id from auth.users where email = '관리자이메일@example.com');
-- ══════════════════════════════════════════════════════════════

-- 1. 계정 프로필 테이블
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  agency_name text not null,
  agency_code text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "select own profile" on public.profiles;
create policy "select own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = id and status = 'pending');

-- 2. 관리자용 RPC — 로그인한 사용자(auth.uid())가 profiles.is_admin = true 인지로 게이트.
--    비밀번호 파라미터 없음. 반드시 로그인(=authenticated) 상태에서만 호출 가능.

create or replace function public.admin_list_accounts()
returns table (
  id uuid,
  name text,
  agency_name text,
  agency_code text,
  status text,
  created_at timestamptz,
  email text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'unauthorized';
  end if;

  return query
    select p.id, p.name, p.agency_name, p.agency_code, p.status, p.created_at, u.email::text
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

create or replace function public.admin_set_status(account_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  if new_status not in ('pending','approved','rejected') then
    raise exception 'invalid status';
  end if;

  update public.profiles set status = new_status where id = account_id;
end;
$$;

grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_set_status(uuid, text) to authenticated;
