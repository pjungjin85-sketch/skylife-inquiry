-- ══════════════════════════════════════════════════════════════
-- 업무지원 텔레그램 봇 연동 — 계정별 텔레그램 ID + 미해결 질문 관리
-- Supabase SQL Editor에서 전체 내용을 그대로 실행하세요. (여러 번 실행해도 안전)
--
-- 1) profiles.telegram_id  : 승인된 계정에 텔레그램 ID를 연결하면 봇 사용 가능
-- 2) bot_query_logs        : 봇 질문 로그 (봇이 service_role 키로 기록)
-- 3) 관리자 RPC            : 텔레그램 ID 등록, 미해결 질문 조회·처리 완료
--
-- 봇 쪽 접근 판정은 service_role 키로 profiles 를 직접 조회한다
--   (telegram_id 일치 + status = 'approved').
-- ══════════════════════════════════════════════════════════════

-- 1. 계정 ↔ 텔레그램 ID
alter table public.profiles add column if not exists telegram_id bigint;
create unique index if not exists profiles_telegram_id_key
  on public.profiles (telegram_id) where telegram_id is not null;

-- 가입 정책 강화: 예전 정책은 status 만 검사해서 가입하면서 is_admin = true 를 넣으면
-- 바로 관리자 RPC 를 쓸 수 있었다. telegram_id 도 스스로 넣지 못하게 한다.
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert with check (
    auth.uid() = id and status = 'pending'
    -- 가입 시 스스로 관리자·텔레그램 연결을 넣지 못하게 (관리자 RPC 로만 변경)
    and is_admin = false and telegram_id is null
  );
-- 수정 정책은 없지만(=수정 불가) 방어적으로 직접 UPDATE 권한도 회수한다
revoke update on public.profiles from anon, authenticated;


-- 2. 봇 질문 로그
create table if not exists public.bot_query_logs (
  id          bigserial primary key,
  asked_at    timestamptz not null default now(),
  user_id     text,                 -- 텔레그램 사용자 ID
  query       text not null,        -- 질문 (개인정보는 봇이 가린 뒤 기록)
  found       boolean not null,     -- KB에서 근거를 찾았는지
  route       text,                 -- 어떤 경로로 답했는지 (kb/no_coverage/...)
  top_item_id text,
  top_score   real,
  latency_ms  integer,
  feedback    smallint
);
alter table public.bot_query_logs add column if not exists bot text not null default 'main';
alter table public.bot_query_logs add column if not exists resolved_at timestamptz;
alter table public.bot_query_logs add column if not exists resolved_note text;
-- 관리자가 '삭제'한 질문 (목록에서만 빼고 기록은 남긴다 — 질문 통계용, 되살리기 가능)
alter table public.bot_query_logs add column if not exists dismissed_at timestamptz;

create index if not exists bot_query_logs_asked_at_idx on public.bot_query_logs (asked_at desc);
create index if not exists bot_query_logs_found_idx on public.bot_query_logs (found, asked_at desc);

-- RLS 켜고 정책 없음 → anon/authenticated 는 직접 접근 불가, 관리자는 아래 RPC로만
alter table public.bot_query_logs enable row level security;


-- 3. 관리자 RPC

-- 반환 컬럼이 바뀌므로 다시 만든다 (telegram_id 추가)
drop function if exists public.admin_list_accounts();
create function public.admin_list_accounts()
returns table (
  id uuid, name text, agency_name text, agency_code text, status text,
  created_at timestamptz, email text, telegram_id bigint,
  last_sign_in_at timestamptz  -- 최근 접속(로그인). 가이드는 세션 저장이라 창을 닫으면 다시 로그인한다
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'unauthorized';
  end if;
  return query
    select p.id, p.name, p.agency_name, p.agency_code, p.status, p.created_at,
           u.email::text, p.telegram_id, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

-- 텔레그램 ID 는 직원이 가이드에서 직접 연결한다 (아래 4번). 관리자 입력 함수는 없앴다.
drop function if exists public.admin_set_telegram_id(uuid, bigint);

-- 자료가 없어 답하지 못한 질문 — 같은 질문은 묶어서 횟수로
--   no_coverage  : "자료에 없어서 안내드리기 어렵습니다"
--   no_result    : 관련 자료를 찾지 못함
--   clarify_nohit: 근거가 없어 되물음
--   llm_general  : KB 대신 일반 상식으로 답함 (KB 보강 후보)
-- 같은 질문 묶기용 정규화: 앞의 목록 기호(- • *), 끝의 물음표·마침표, 띄어쓰기 차이를 무시
--   "- 명의변경 서류 뭐 필요해?" = "명의변경 서류 뭐 필요해" = "명의변경  서류 뭐 필요해 ?"
create or replace function public.bot_norm_query(q text)
returns text language sql immutable
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(lower(trim(coalesce(q, ''))), '^[-•*·>\s]+', ''),
           '[?？!.~\s]+$', ''),
         '\s+', '', 'g')
$$;

drop function if exists public.admin_list_unanswered(integer, boolean);
drop function if exists public.admin_list_unanswered(integer, boolean, boolean);
-- show_dismissed = true 면 삭제한 질문만, false 면 삭제 안 한 질문만
create function public.admin_list_unanswered(
  days integer default 30, include_resolved boolean default false, show_dismissed boolean default false
)
returns table (
  query text, ask_count bigint, last_asked timestamptz, routes text,
  askers text,        -- 사람별 횟수: "박정진 (본사) 2회, 송재혁 (무선사업팀) 1회"
  resolved_at timestamptz, resolved_note text,
  bots text,          -- 어느 봇에서 나온 질문인지 (main=운영, personal=노트북 개인 봇)
  first_asked timestamptz,
  dismissed_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  return query
    with base as (
      select l.*, public.bot_norm_query(l.query) as k,
             coalesce(p.name || ' (' || p.agency_name || ')', '미등록 ' || l.user_id) as who
      from public.bot_query_logs l
      left join public.profiles p on p.telegram_id::text = l.user_id
      where l.found = false
        and l.route in ('no_coverage', 'no_result', 'clarify_nohit', 'llm_general')
        and l.asked_at > now() - make_interval(days => days)
    ),
    per as (
      select b.k, b.who, count(*) as c from base b group by b.k, b.who
    )
    select (array_agg(regexp_replace(b.query, '^[-•*·>\s]+', '') order by b.asked_at desc))[1],  -- 대표 문구: 가장 최근 표현
           count(*)::bigint,
           max(b.asked_at),
           string_agg(distinct b.route, ','),
           (select string_agg(per.who || ' ' || per.c || '회', ', ' order by per.c desc, per.who)
              from per where per.k = b.k),
           max(b.resolved_at),
           max(b.resolved_note),
           string_agg(distinct b.bot, ','),
           min(b.asked_at),
           max(b.dismissed_at)
    from base b
    group by b.k
    -- 한 번 삭제한 질문은 같은 질문이 또 들어와도 다시 올리지 않는다 (처리 완료와 같은 방식)
    having (max(b.dismissed_at) is not null) = show_dismissed
       and (show_dismissed or include_resolved or max(b.resolved_at) is null)
    order by max(b.dismissed_at) desc nulls last, max(b.resolved_at) nulls first, max(b.asked_at) desc
    limit 300;
end;
$$;

-- 삭제(목록에서 빼기) / 되살리기 — 같은 질문(정규화 기준) 전체에 적용. 여러 개를 한 번에.
create or replace function public.admin_dismiss_queries(qs text[], dismiss boolean default true)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  update public.bot_query_logs l
     set dismissed_at = case when dismiss then now() else null end
   where public.bot_norm_query(l.query) in (select public.bot_norm_query(x) from unnest(qs) x)
     and (l.dismissed_at is null) = dismiss;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.admin_dismiss_queries(text[], boolean) from public, anon;
grant execute on function public.admin_dismiss_queries(text[], boolean) to authenticated;

-- 처리 완료 표시 (같은 질문 전체). note 에 "FAQ 추가" 같은 메모
create or replace function public.admin_resolve_query(q text, note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  update public.bot_query_logs
     set resolved_at = now(), resolved_note = nullif(trim(note), '')
   where public.bot_norm_query(query) = public.bot_norm_query(q) and resolved_at is null;
end;
$$;

grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_list_unanswered(integer, boolean, boolean) to authenticated;
grant execute on function public.admin_resolve_query(text, text) to authenticated;


-- ══════════════════════════════════════════════════════════════
-- 4. 직원 본인이 텔레그램 연결 (현장영업 가이드 메인 화면, 로그아웃 옆)
--   승인된 계정만 자기 계정에 텔레그램 ID 를 넣거나 해제할 수 있다.
--   다른 '승인된' 계정이 쓰는 ID 는 거부한다. 승인 대기·정지 계정이 쥐고 있는 ID 는 가져온다.
--   본인 확인은 없다 — 남의 ID 를 넣는 위험은 가이드 비밀번호를 남에게 알려주는 것과
--   같은 수준이라 별도 인증은 두지 않았다.
--   남의 ID 를 선점한 계정이 있으면 관리자가 그 계정을 '정지' → 연결이 자동 해제되고
--   (admin_set_status) 진짜 주인이 다시 연결할 수 있다.
-- ══════════════════════════════════════════════════════════════
drop function if exists public.create_telegram_link_code();
drop function if exists public.claim_telegram_link(text, bigint);
drop function if exists public.check_telegram_link(text);
drop table if exists public.telegram_link_codes;

create or replace function public.set_my_telegram_id(tg_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'approved') then
    raise exception 'not approved';
  end if;
  if tg_id is null or tg_id <= 0 then
    raise exception 'invalid telegram id';
  end if;
  if exists (select 1 from public.profiles
             where telegram_id = tg_id and id <> auth.uid() and status = 'approved') then
    raise exception 'telegram id already used';
  end if;
  update public.profiles set telegram_id = null where telegram_id = tg_id and id <> auth.uid();
  update public.profiles set telegram_id = tg_id where id = auth.uid();
end;
$$;

-- 본인 연결 해제
create or replace function public.unlink_my_telegram()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set telegram_id = null where id = auth.uid();
end;
$$;

revoke all on function public.set_my_telegram_id(bigint) from public, anon;
grant execute on function public.set_my_telegram_id(bigint) to authenticated;
revoke all on function public.unlink_my_telegram() from public, anon;
grant execute on function public.unlink_my_telegram() to authenticated;


-- 승인 해제(정지·대기)되면 텔레그램 연결도 푼다 — 선점된 ID 를 관리자가 정지로 풀어줄 수 있게
create or replace function public.admin_set_status(account_id uuid, new_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  if new_status not in ('pending','approved','rejected') then
    raise exception 'invalid status';
  end if;
  update public.profiles
     set status = new_status,
         telegram_id = case when new_status = 'approved' then telegram_id else null end
   where id = account_id;
end;
$$;
grant execute on function public.admin_set_status(uuid, text) to authenticated;
