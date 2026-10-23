-- ══════════════════════════════════════════════════════════════
-- 관리자가 등록하는 FAQ 답변 (봇 미해결 질문 → 답변 등록)
-- Supabase SQL Editor에서 전체 내용을 그대로 실행하세요. (여러 번 실행해도 안전)
--
-- 등록한 답변은
--   · 모바일 FAQ 화면(skylife-mobile-faq)에 바로 보이고 — 기존 faq.json 목록 뒤에 붙는다
--   · 업무지원 봇 KB 에는 다음 날 05:00 재빌드 때 들어간다 (mobile-work-support-bot/scripts/build_kb.py)
-- 지우지 않고 '숨김' 으로 내리며, 고칠 때마다 고치기 전 내용을 faq_answer_history 에 남긴다.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.faq_answers (
  id           bigserial primary key,
  category     text not null,
  q            text not null,
  a            text not null,
  hidden       boolean not null default false,
  source_query text,                      -- 어떤 미해결 질문에서 나왔는지 (직접 추가면 null)
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null
);

-- 고치거나 숨기기 직전의 내용
create table if not exists public.faq_answer_history (
  id         bigserial primary key,
  answer_id  bigint not null references public.faq_answers(id) on delete cascade,
  category   text not null,
  q          text not null,
  a          text not null,
  hidden     boolean not null,
  changed_at timestamptz not null default now(),   -- 이 내용이 바뀐 시각
  changed_by uuid references public.profiles(id) on delete set null
);
create index if not exists faq_answer_history_answer_idx on public.faq_answer_history (answer_id, changed_at desc);

-- RLS 켜고 정책 없음 → 직접 접근 불가, 아래 함수로만
alter table public.faq_answers enable row level security;
alter table public.faq_answer_history enable row level security;


-- 화면·봇용: 숨기지 않은 답변만. 로그인 없이도 부른다 (봇 KB 빌드가 GitHub Actions 에서 부름).
-- 기존 FAQ(faq.json)도 공개 저장소라 같은 수준의 공개다.
create or replace function public.faq_answers_public()
returns table (id bigint, category text, q text, a text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select f.id, f.category, f.q, f.a, f.updated_at
  from public.faq_answers f
  where not f.hidden
  order by f.id
$$;
revoke all on function public.faq_answers_public() from public;
grant execute on function public.faq_answers_public() to anon, authenticated;


-- 관리자: 전체 목록 (숨김 포함)
create or replace function public.admin_list_faq_answers()
returns table (
  id bigint, category text, q text, a text, hidden boolean, source_query text,
  created_at timestamptz, created_by_name text, updated_at timestamptz, updated_by_name text,
  history_count bigint
)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'unauthorized';
  end if;
  return query
    select f.id, f.category, f.q, f.a, f.hidden, f.source_query,
           f.created_at, pc.name, f.updated_at, pu.name,
           (select count(*) from public.faq_answer_history h where h.answer_id = f.id)
    from public.faq_answers f
    left join public.profiles pc on pc.id = f.created_by
    left join public.profiles pu on pu.id = f.updated_by
    order by f.updated_at desc;
end;
$$;

-- 관리자: 등록(answer_id 없음) 또는 수정. 미해결 질문에서 등록하면 그 질문을 처리 완료로.
create or replace function public.admin_save_faq_answer(
  answer_id bigint, p_category text, p_q text, p_a text, p_source_query text default null
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  c text := trim(coalesce(p_category, ''));
  qq text := trim(coalesce(p_q, ''));
  aa text := trim(coalesce(p_a, ''));
  sq text := nullif(trim(coalesce(p_source_query, '')), '');
  new_id bigint;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  if c = '' or qq = '' or aa = '' then raise exception 'empty field'; end if;
  if length(c) > 20 or length(qq) > 200 or length(aa) > 4000 then raise exception 'too long'; end if;

  if answer_id is null then
    insert into public.faq_answers (category, q, a, source_query, created_by, updated_by)
    values (c, qq, aa, sq, auth.uid(), auth.uid())
    returning id into new_id;
  else
    insert into public.faq_answer_history (answer_id, category, q, a, hidden, changed_by)
      select f.id, f.category, f.q, f.a, f.hidden, auth.uid()
      from public.faq_answers f
      where f.id = answer_id and (f.category, f.q, f.a) is distinct from (c, qq, aa);
    update public.faq_answers f
       set category = c, q = qq, a = aa, updated_at = now(), updated_by = auth.uid()
     where f.id = answer_id
    returning f.id into new_id;
    if new_id is null then raise exception 'not found'; end if;
  end if;

  if sq is not null then
    update public.bot_query_logs
       set resolved_at = now(), resolved_note = 'FAQ 등록'
     where public.bot_norm_query(query) = public.bot_norm_query(sq) and resolved_at is null;
  end if;
  return new_id;
end;
$$;

-- 관리자: 숨김 / 다시 보이기
create or replace function public.admin_set_faq_answer_hidden(answer_id bigint, p_hidden boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  insert into public.faq_answer_history (answer_id, category, q, a, hidden, changed_by)
    select f.id, f.category, f.q, f.a, f.hidden, auth.uid()
    from public.faq_answers f where f.id = answer_id and f.hidden is distinct from p_hidden;
  update public.faq_answers f
     set hidden = p_hidden, updated_at = now(), updated_by = auth.uid()
   where f.id = answer_id and f.hidden is distinct from p_hidden;
end;
$$;

-- 관리자: 한 답변의 이전 내용들 (최근 것부터)
create or replace function public.admin_faq_answer_history(answer_id bigint)
returns table (category text, q text, a text, hidden boolean, changed_at timestamptz, changed_by_name text)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin) then
    raise exception 'unauthorized';
  end if;
  return query
    select h.category, h.q, h.a, h.hidden, h.changed_at, p.name
    from public.faq_answer_history h
    left join public.profiles p on p.id = h.changed_by
    where h.answer_id = admin_faq_answer_history.answer_id
    order by h.changed_at desc, h.id desc;
end;
$$;

revoke all on function public.admin_list_faq_answers() from public, anon;
revoke all on function public.admin_save_faq_answer(bigint, text, text, text, text) from public, anon;
revoke all on function public.admin_set_faq_answer_hidden(bigint, boolean) from public, anon;
revoke all on function public.admin_faq_answer_history(bigint) from public, anon;
grant execute on function public.admin_list_faq_answers() to authenticated;
grant execute on function public.admin_save_faq_answer(bigint, text, text, text, text) to authenticated;
grant execute on function public.admin_set_faq_answer_hidden(bigint, boolean) to authenticated;
grant execute on function public.admin_faq_answer_history(bigint) to authenticated;
