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
  created_at timestamptz, email text, telegram_id bigint
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'unauthorized';
  end if;
  return query
    select p.id, p.name, p.agency_name, p.agency_code, p.status, p.created_at,
           u.email::text, p.telegram_id
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

-- 텔레그램 ID 등록/변경/해제 (null 이면 해제)
create or replace function public.admin_set_telegram_id(account_id uuid, tg_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  if tg_id is not null and tg_id <= 0 then
    raise exception 'invalid telegram id';
  end if;
  if tg_id is not null and exists (
    select 1 from public.profiles where telegram_id = tg_id and id <> account_id
  ) then
    raise exception 'telegram id already used';
  end if;
  update public.profiles set telegram_id = tg_id where id = account_id;
end;
$$;

-- 자료가 없어 답하지 못한 질문 — 같은 질문은 묶어서 횟수로
--   no_coverage  : "자료에 없어서 안내드리기 어렵습니다"
--   no_result    : 관련 자료를 찾지 못함
--   clarify_nohit: 근거가 없어 되물음
--   llm_general  : KB 대신 일반 상식으로 답함 (KB 보강 후보)
create or replace function public.admin_list_unanswered(days integer default 30, include_resolved boolean default false)
returns table (
  query text, ask_count bigint, last_asked timestamptz, routes text,
  askers text, resolved_at timestamptz, resolved_note text
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  return query
    select l.query,
           count(*)::bigint,
           max(l.asked_at),
           string_agg(distinct l.route, ','),
           string_agg(distinct coalesce(p.name || ' (' || p.agency_name || ')', '미등록 ' || l.user_id), ', '),
           max(l.resolved_at),
           max(l.resolved_note)
    from public.bot_query_logs l
    left join public.profiles p on p.telegram_id::text = l.user_id
    where l.found = false
      and l.route in ('no_coverage', 'no_result', 'clarify_nohit', 'llm_general')
      and l.asked_at > now() - make_interval(days => days)
    group by l.query
    having include_resolved or max(l.resolved_at) is null
    order by max(l.resolved_at) nulls first, max(l.asked_at) desc
    limit 300;
end;
$$;

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
   where query = q and resolved_at is null;
end;
$$;

grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_set_telegram_id(uuid, bigint) to authenticated;
grant execute on function public.admin_list_unanswered(integer, boolean) to authenticated;
grant execute on function public.admin_resolve_query(text, text) to authenticated;
