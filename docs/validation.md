# 로컬 검증 기록 · 2026-10-28

초기 mock 검증과 자동 검사는 전부 합성 예시를 사용합니다. 이 검사에서는 메신저 파일, 기존 파생 자료, 실제 비밀키를 읽거나 복사하지 않습니다. 별도 승인된 실제 API 검증은 자동 검사와 분리합니다.

## 환경과 의존성

- Node.js 24.14.1 / npm 11.11.0
- TypeScript 5.9.3
- @types/node 24.19.2
- ESLint 10.13.0 / typescript-eslint 8.72.1
- npm 공식 레지스트리 사용, 설치 스크립트 비활성화
- 최신 TypeScript 메타데이터는 7.0.2였으나 린트 도구의 지원 범위가 <6.1이므로 지원되는 5.9.3을 명시적으로 사용
- package-lock.json으로 실제 설치 버전 고정

## 자동 검사

- npm run typecheck: 통과
- npm run lint: 통과
- npm test: 10개 테스트 통과, 실패 0
- 단위 검사: 미등록 차단, 자유문장 관계, 소유자 전용 조회·수정, 계정별 세션과 초기화 격리, 문자열 명령의 설정 변경 방지, 응답기 입력 격리, 반환 객체 복사, 승인 취소 후 차단, 입력·세션 한도
- HTTP 검사: 등록 전 403, 비소유자 수정 403, 다른 계정 필드 400, 잘못된 호스트와 교차 사이트 API 차단, 정상 소개 페이지 탐색, 정적 파일 허용 목록, 요청 크기·형식 제한
- 운영 환경 및 --demo 누락 시작 차단

## 실제 브라우저 확인

Chrome에서 http://127.0.0.1:4317 를 열어 다음을 확인했습니다.

1. 방문자의 승인 대기 화면과 전송 비활성화
2. 가상 친구 A의 합성 입력과 MOCK 표시 응답
3. 가상 동료 B로 전환 시 A 메시지 미노출, 별도 B 대화
4. A로 돌아오기 및 새로고침 후 A 대화 유지
5. 소유자 화면에서 자유문장 관계 저장과 방문자 승인
6. 승인 이후 방문자의 전송 활성화와 목 응답

현재 브라우저 검증은 데스크톱 화면 기준입니다. 운영 인증, 실제 모델 품질, 실제 데이터와 보안 운영 검증은 포함하지 않습니다.

## 서버 AI 연결 추가 검증

타입 검사와 린트 통과, 자동 테스트 28개 통과(실패 0). 실제 OpenAI 호출 없이 가짜 토큰과 로컬 HTTP 목만 사용했습니다. 기본 mock은 키 없이 실행되고 키 미설정 AI 모드는 호출을 비활성화합니다. 중복 요청 1회 처리, 실패한 요청 재전송 방지, 오류·시간 초과 롤백, 승인 변경 후 늦은 응답 폐기, 계정별 격리, 고정 합성 입력만 전송, 키 파일 미추적·제외·파일 유형 검사를 확인했습니다.

Chrome에서 mock 응답, 미승인 차단, 계정 격리, 관리자 자유문장 관계 저장을 확인했습니다. 실제 키를 로드하지 않는 테스트용 AI 인스턴스에서도 키 미설정 안내, 합성 예시 전용 UI, 등록 계정의 전송 차단을 확인했습니다. 실제 API 응답 검증은 별도 실행이며 정상 응답 성공을 이 자동 테스트 결과로 대신 주장하지 않습니다.

## CLI adapter verification

Type checking, lint and all 40 tests pass. Tests require an execution environment allowing temporary Git repositories and loopback HTTP; restricted sandbox runs fail those environment-dependent checks. The explicit live synthetic CLI check launched once and returned cli_failed. No normal response was verified, no failed input was stored, and there was no further CLI launch or API fallback. Internal network retry count is unknown; the official CLI defaults apply. Chrome verified the CLI label, missing-configuration notice and disabled sending for visitor and approved friend on a separate port 4318 server. Existing port 4317 was left untouched. See [CLI boundaries](codex-cli.md).
