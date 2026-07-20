# skylife-inquiry 프로젝트 대화 로그

**날짜**: 2026-04-04
**작업자**: 박정진
**관련 파일 위치**: `/Users/jaypark/workspace/skylife-inquiry/`
**배포 URL**: `https://skylife-inquiry.vercel.app/`

---

## 개요

독립 프로젝트로 신규 구축. 대리점 직원이 문의를 남기고 관리자가 답변하는 게시판.
Supabase를 백엔드 DB로 사용하는 정적 HTML 방식으로 구현.

---

## 주요 결정 사항

### 1. 독립 레포지토리로 분리
- 기존 `skylife-guide/inquiry.html` (Firebase 기반)과 별개로 신규 구축
- GitHub: `pjungjin85-sketch/skylife-inquiry`
- Vercel 배포: `https://skylife-inquiry.vercel.app/`

### 2. Supabase 사용 (Firebase → Supabase 변경)
- 프로젝트 URL: `https://zeiygknvggokauetgrzk.supabase.co`
- 무료 플랜, anon key 사용
- RLS(Row Level Security) 정책: insert/select/update 허용

### 3. 이메일 알림 미적용
- EmailJS 연동 시도했으나 무료 플랜에서 커스텀 도메인 허용 불가 (유료 필요)
- Formspree도 검토했으나 보류
- 현재 이메일 알림 없이 운영 중

### 4. 관리자 인증
- SHA-256 해시 기반 클라이언트 인증
- 기본 비밀번호: `skylife2026`
- sessionStorage에 인증 플래그 저장

---

## Supabase 설정 정보

| 항목 | 값 |
|------|-----|
| 프로젝트 URL | `https://zeiygknvggokauetgrzk.supabase.co` |
| 테이블 | `inquiries` |
| RLS | insert / select / update 허용 |

### 테이블 구조

```
inquiries
  id          uuid (PK, auto)
  created_at  timestamptz (auto)
  name        text (필수)
  department  text (필수)
  category    text (필수)
  content     text (필수)
  contact     text (선택)
  status      text ('pending' | 'answered', default 'pending')
  reply       text (관리자 답변)
  replied_at  timestamptz
```

---

## 기능 구조

### index.html (직원용)
- 탭 1 — 문의하기: 이름, 소속, 문의유형, 연락처(선택), 내용 입력 후 접수
- 탭 2 — 문의내역: 전체 문의 목록 조회, 답변 확인
- 문의 유형: 개통 문의 / 정책 문의 / 수수료 문의 / 단말기유심 / 기타

### admin.html (관리자용)
- 비밀번호: `skylife2026`
- 통계 바: 전체 / 답변대기 / 답변완료 건수
- 필터: 전체 / 답변대기 / 답변완료
- 답변 작성 / 수정 / 삭제 기능
- 답변 등록 시 status → 'answered' 자동 변경

---

## 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html` | 직원용 문의 작성 + 내역 확인 |
| `admin.html` | 관리자 문의 목록 + 답변 관리 |
| `vercel.json` | 캐시 헤더 설정 |

---

## 향후 필요 작업

- 이메일 알림 연동 (현재 보류 — EmailJS 유료 플랜 필요)

---

## 2026-07-16 업데이트 — 문의 게시판 → 공지사항 게시판으로 전환

### 1. 페이지 성격 변경
- 기존: 직원이 문의 작성 → 관리자가 답변하는 Q&A 구조
- 변경: 관리자만 공지 작성/수정/삭제, 직원은 읽기 전용 + 조회수 카운팅
- `inquiries` 테이블은 더 이상 사용하지 않음 (스키마/데이터는 Supabase에 남아있으나 코드에서 참조 제거)

### 2. 신규 테이블: `notices`
- 컬럼: `id, title, category(공지/필독/이벤트/기타), content, view_count, created_at, updated_at`
- RLS: 조회는 전체 공개(anon 포함), 작성/수정/삭제는 `profiles.is_admin = true`인 로그인 사용자만
- 조회수 증가는 `increment_notice_view(notice_id)` RPC(SECURITY DEFINER, view_count 컬럼만 갱신)로 anon도 호출 가능하게 좁게 허용
- SQL: `schema_notices.sql` (신규 파일, `schema_accounts.sql`의 `profiles` 테이블에 의존)

### 3. 관리자 인증 전면 교체 (보안 이슈 수정)
- 기존 admin.html은 클라이언트 해시(`skylife2026`) 비교만으로 게이트 — 해시가 이미 공개된 JS라 anon 권한 RPC를 직접 호출하면 우회 가능한 구조였음
- Supabase Auth 실제 로그인(아이디+비밀번호, `<아이디>@skylife-agent.local` 형식 이메일)으로 교체
- 로그인 후 `profiles.is_admin`을 확인해야 관리자 화면 진입 가능. is_admin이 아니면 즉시 로그아웃 처리
- admin.html은 이제 "공지사항 관리" 탭 + "회원 승인" 탭(현장영업 안내 가입 승인, 별도 작업 건) 두 개를 한 로그인으로 공유

### 4. 최초 관리자 계정 설정 (1회 필요)
1. Supabase 대시보드 → Authentication → Users → "Add user"로 관리자 계정 생성 (이메일: `아이디@skylife-agent.local`)
2. SQL Editor에서 `public.profiles`에 해당 계정 행 추가 후 `is_admin = true`로 설정 (schema_notices.sql 상단 주석 참고)

### 5. 파일 구조 변경
| 파일 | 변경 내용 |
|------|-----------|
| `index.html` | 문의 작성/내역 탭 → 공지 목록(읽기 전용) + 상세보기 + 조회수 증가로 전면 재작성 |
| `admin.html` | 답변 관리 UI → 공지 작성/수정/삭제 UI로 교체, 인증을 Supabase Auth로 전환, 회원 승인 탭 병합 |
| `schema_notices.sql` | 신규 — notices 테이블 + RLS + is_admin() 헬퍼 + 조회수 RPC |
| `schema_accounts.sql` | 기존 pw_hash 파라미터 제거, profiles.is_admin 기반 인증으로 수정 (동일 보안 이슈) |

---

## 2026-07-16 업데이트 (계속) — Supabase 프로젝트 마이그레이션

### 1. 발생한 문제
- 기존 Supabase 프로젝트(`zeiygknvggokauetgrzk`)가 **90일 넘게 일시정지되어 Management API로도 복구 불가** 상태로 확인됨
- 이 프로젝트는 skylife-inquiry뿐 아니라 skylife-guide, skylife-addons, skylife-mobile-faq, skylife-plans, TPS까지 **워크스페이스 6개 사이트가 전부 공유**하고 있었음 → 6개 사이트의 로그인/승인 게이트가 동시에 죽어있던 상태였음

### 2. 새 프로젝트로 전환
- 신규 프로젝트 `skylife-shared` 생성 (Northeast Asia Tokyo, ref `qvzlwhwxspmofrwdvgdd`)
- `schema_accounts.sql` → `schema_notices.sql` 순서로 적용 (profiles, notices 테이블 + RLS + RPC)
- Authentication → `mailer_autoconfirm = true`로 설정 (이메일 인증 없이 즉시 로그인 가능)
- 관리자 계정 생성 완료: 이메일 `admin@skylife-agent.local`, `profiles.is_admin = true` — **비밀번호는 대화창으로만 전달했고 이 파일에는 기록하지 않음.** 최초 로그인 후 반드시 변경할 것
- 6개 저장소의 `SUPABASE_URL` / `SUPABASE_KEY`를 새 프로젝트 값으로 전량 교체, 각 저장소별 개별 커밋 + push + 배포(Vercel 수동 배포 필요한 곳은 `vercel deploy --prod`까지) 완료
- 관리자 등록 → 공개 조회 → 조회수 RPC → anon 쓰기 차단(RLS 정상 동작) 전 과정 실제 API 호출로 검증 완료

### 3. 부수 발견 — 커밋에 기존 미커밋 작업이 함께 묶임
- skylife-addons/mobile-faq/plans/TPS/skylife-guide 5곳은 이미 로그인월(lock-overlay, SSO) 기능이 **미커밋 상태로 작업 중**이었음 → URL 교체 커밋에 함께 포함되어 같이 push/배포됨 (파일 단위 커밋이라 분리 불가)

### 4. 미해결 — SSO 토큰 URL 전달 방식 보안 검토 대기 중
- `skylife-guide/index.html`의 `applySsoToLinks()`가 Supabase 액세스 토큰을 URL fragment(`#sso=...`)로 TPS/addons/mobile-faq/plans에 전달
- 수신 측은 `history.replaceState`로 즉시 URL 제거 + `getUser()`로 서버 검증까지 하고 있어 기본 방어는 있으나, 자동 보안 스캔에서 HIGH로 플래그됨
- 근본 해결(postMessage 또는 서버 토큰 교환 방식)로 바꿀지, 현재 설계를 유지할지 **사용자 결정 대기 중** (2026-07-16 기준 미결)
