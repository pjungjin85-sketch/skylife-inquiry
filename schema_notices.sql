-- ══════════════════════════════════════════════════════════════
-- kt skylife 공지사항 게시판 — notices 테이블 + RLS + 조회수 RPC
-- Supabase SQL Editor에서 전체 내용을 그대로 실행하세요.
--
-- 사전 조건: public.profiles 테이블이 이미 존재해야 함
--   (skylife-guide/schema_accounts.sql 을 먼저 실행)
--
-- 관리자(공지 작성/수정/삭제) 로그인 방법:
--   admin.html은 Supabase Auth 이메일/비밀번호 로그인을 사용합니다.
--   1) Supabase 대시보드 → Authentication → Users → "Add user"로
--      관리자 계정을 직접 만들거나, skylife-guide 회원가입 페이지로 가입
--   2) SQL Editor에서 아래 실행 (본인 이메일로 교체)
--      update public.profiles set is_admin = true
--      where id = (select id from auth.users where email = '관리자이메일@example.com');
--   3) profiles 행이 없는 계정이라면(=skylife-guide 가입을 거치지 않은 경우)
--      먼저 아래로 프로필을 만들어준 뒤 위 update를 실행:
--      insert into public.profiles (id, name, agency_name, agency_code, status, is_admin)
--      select id, '관리자', '본사', 'HQ', 'approved', true
--      from auth.users where email = '관리자이메일@example.com';
-- ══════════════════════════════════════════════════════════════

-- 0. 관리자 판별 헬퍼 (profiles.is_admin 재사용)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  );
$$;

-- 1. 공지사항 테이블
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default '공지' check (category in ('공지','필독','이벤트','기타')),
  content text not null,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.notices enable row level security;

-- 읽기: 로그인 여부와 무관하게 전체 공개
drop policy if exists "public read notices" on public.notices;
create policy "public read notices" on public.notices
  for select using (true);

-- 쓰기: is_admin() 인 로그인 사용자만
drop policy if exists "admin insert notices" on public.notices;
create policy "admin insert notices" on public.notices
  for insert to authenticated with check (public.is_admin());

drop policy if exists "admin update notices" on public.notices;
create policy "admin update notices" on public.notices
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete notices" on public.notices;
create policy "admin delete notices" on public.notices
  for delete to authenticated using (public.is_admin());

-- 2. 조회수 증가 RPC — view_count 컬럼만 건드리는 좁은 범위라 anon 허용
--    (RLS의 update 정책은 관리자 전용이므로, 일반 사용자의 조회수 증가는
--     반드시 이 SECURITY DEFINER 함수를 통해서만 가능)
create or replace function public.increment_notice_view(notice_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notices set view_count = view_count + 1 where id = notice_id;
$$;

grant execute on function public.increment_notice_view(uuid) to anon, authenticated;
