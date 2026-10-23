-- ══════════════════════════════════════════════════════════════
-- 업무지원 텔레그램 봇 공지 (대화방 상단 고정)
-- Supabase SQL Editor에서 전체 내용을 그대로 실행하세요. (여러 번 실행해도 안전)
--
-- 관리자 '봇 공지' 탭에서 저장하면 bot_notices 에 한 줄 쌓인다. 봇마다 따로(bot = main/personal)
-- 가장 최근 줄이 그 봇의 지금 공지 (body 가 null 이면 공지 내림). 이전 공지는 기록으로 남는다.
-- 봇(운영·개인)은 직원이 말을 걸 때 그 사람이 최신 공지를 아직 못 받았으면
-- 공지를 보내 고정하고 bot_notice_deliveries 에 적는다 (service_role 키).
-- ══════════════════════════════════════════════════════════════

create table if not exists public.bot_notices (
  id         bigserial primary key,
  body       text,                                  -- null = 공지 내림
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
alter table public.bot_notices add column if not exists bot text not null default 'main';
alter table public.bot_notices drop constraint if exists bot_notices_bot_check;
alter table public.bot_notices add constraint bot_notices_bot_check check (bot in ('main', 'personal'));
create index if not exists bot_notices_bot_idx on public.bot_notices (bot, id desc);

-- 사람별로 어떤 공지를 받았는지 (봇마다 대화방이 따로라 bot 을 같이 키로)
create table if not exists public.bot_notice_deliveries (
  bot          text not null,                       -- main=운영 봇, personal=개인 봇
  user_id      text not null,                       -- 텔레그램 사용자 ID
  notice_id    bigint references public.bot_notices(id) on delete set null,
  message_id   bigint,                              -- 고정한 메시지 (다음 공지 때 고정 해제)
  delivered_at timestamptz not null default now(),
  primary key (bot, user_id)
);

-- RLS 켜고 정책 없음 → 직접 접근 불가. 관리자는 아래 함수로, 봇은 service_role 로
alter table public.bot_notices enable row level security;
alter table public.bot_notice_deliveries enable row level security;


-- 관리자: 한 봇의 공지 기록 (최근 것부터) + 공지별로 받은 사람 수
drop function if exists public.admin_list_bot_notices();
drop function if exists public.admin_set_bot_notice(text);

create or replace function public.admin_list_bot_notices(p_bot text)
returns table (id bigint, body text, created_at timestamptz, created_by_name text, delivered bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'unauthorized';
  end if;
  return query
    select n.id, n.body, n.created_at, p.name,
           (select count(*) from public.bot_notice_deliveries d where d.notice_id = n.id)
    from public.bot_notices n
    left join public.profiles p on p.id = n.created_by
    where n.bot = p_bot
    order by n.id desc
    limit 50;
end;
$$;

-- 관리자: 한 봇에 새 공지 저장. 빈 내용이면 공지 내림
create or replace function public.admin_set_bot_notice(p_bot text, p_body text)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  b text := nullif(trim(coalesce(p_body, '')), '');
  new_id bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  if p_bot not in ('main', 'personal') then raise exception 'invalid bot'; end if;
  if length(b) > 1000 then raise exception 'too long'; end if;
  insert into public.bot_notices (bot, body, created_by) values (p_bot, b, auth.uid()) returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.admin_list_bot_notices(text) from public, anon;
revoke all on function public.admin_set_bot_notice(text, text) from public, anon;
grant execute on function public.admin_list_bot_notices(text) to authenticated;
grant execute on function public.admin_set_bot_notice(text, text) to authenticated;
