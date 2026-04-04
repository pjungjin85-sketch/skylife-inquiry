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
