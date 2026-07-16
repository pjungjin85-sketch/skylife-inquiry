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
