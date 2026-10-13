-- ══════════════════════════════════════════════════════════════
-- 관리자 비밀번호 초기화 RPC
-- Supabase SQL Editor에서 전체 내용을 그대로 실행하세요.
--
-- 왜 필요한가:
--   이 시스템의 계정 이메일은 '<아이디>@skylife-agent.local' 로 만들어진다.
--   실제로 존재하지 않는 도메인이라 Supabase의 비밀번호 재설정 메일이
--   전달될 수 없다. 따라서 재설정은 관리자가 직접 해줘야 한다.
--
-- 보안:
--   schema_accounts.sql의 admin_list_accounts / admin_set_status 와 동일하게
--   호출자가 profiles.is_admin = true 인지로만 게이트한다.
--   service_role 키를 브라우저에 두지 않는다.
-- ══════════════════════════════════════════════════════════════

-- 비밀번호 해싱에 pgcrypto(crypt, gen_salt)가 필요하다.
-- Supabase는 기본 설치되어 있다. 없다고 나오면 아래 주석을 풀고 실행할 것.
-- create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_reset_password(account_id uuid, new_password text)
returns void
language plpgsql
security definer
-- pgcrypto가 public에 있든 extensions에 있든 crypt()가 잡히도록 둘 다 둔다
set search_path = public, extensions
as $$
begin
  -- 1) 호출자가 관리자인지
  if not exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.is_admin) then
    raise exception 'unauthorized';
  end if;

  -- 2) 가입 화면과 같은 최소 길이 규칙
  if new_password is null or length(new_password) < 6 then
    raise exception 'password too short';
  end if;

  -- 3) 대상 계정이 실제로 있는지 (없으면 조용히 0건 처리되는 것을 막는다)
  if not exists (select 1 from auth.users u where u.id = account_id) then
    raise exception 'account not found';
  end if;

  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at = now()
  where id = account_id;
end;
$$;

-- 기본적으로 함수는 PUBLIC에 실행 권한이 붙는다. 민감한 함수이므로 회수 후
-- 로그인한 사용자에게만 부여한다. (실제 인가는 함수 안의 is_admin 검사가 한다)
revoke all on function public.admin_reset_password(uuid, text) from public;
revoke all on function public.admin_reset_password(uuid, text) from anon;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
