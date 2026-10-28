# 또 다른 나 · AI Replica Chat

**localhost 전용 합성 시제품**입니다. 기본 mock 모드와 명시적으로 켜는 합성 AI 테스트 모드를 구분합니다. 실제 인물의 말투를 학습한 복제본이 아닙니다.

## 기본 실행 · 외부 호출 없음

확인 환경: Node.js 24.14.1 / npm 11.11.0. 런타임 패키지 추가 설치와 DB가 필요 없습니다.

```powershell
cd D:\Projects\ai-replica-chat
npm ci
npm run dev
```

브라우저: http://127.0.0.1:4317

기본 mock 모드는 키 파일을 읽거나 외부 API를 호출하지 않습니다. 서버는 127.0.0.1에만 바인딩하고 --demo 옵션을 강제합니다. production/staging 환경에서는 시작하지 않습니다.

## 합성 AI 테스트 · 별도 명시적 실행

승인된 프로젝트 전용 키가 Git에서 제외된 .env.local의 OPENAI_API_KEY로 준비된 경우에만 사용합니다. 키 값을 채팅·스크린샷·브라우저 코드에 넣지 않습니다.

```powershell
npm run dev:ai
```

이 모드는 **고정된 합성 관계와 화면에 제공된 합성 메시지 3종만** 서버에서 OpenAI Responses API로 전송합니다. 임의 입력과 수정된 관계 설명은 서버에서 차단합니다. 자유문장 관계 편집 흐름은 mock 모드에서 검증할 수 있습니다. 실제 개인정보 처리나 모델 학습은 없습니다.

- 모델: gpt-6-luna / reasoning none / 최대 출력 256토큰 / store false
- 서버 프로세스당 외부 호출 시도 최대 3회, 자동 재시도 없음
- 키가 없거나 파일 안전성 검사가 실패하면 AI 전송 비활성화. mock으로 몰래 대체하지 않음
- 인증·접근·429 오류와 시간 초과 시 추가 호출 중단
- 동일 계정·동일 요청 ID는 프로세스 내에서 재전송하지 않음. 실패한 요청도 같은 ID로 재시도하지 않음
- store false는 요청의 응답 저장 설정이며 플랫폼 전체의 보관 정책을 보장하는 표현이 아님

## 검사

```powershell
npm run typecheck
npm run lint
npm test
```

기본 테스트는 가짜 토큰과 로컬 HTTP 목 서버만 사용합니다. 실제 키를 읽거나 OpenAI에 요청하지 않습니다.

실제 호출은 별도 승인 후 `npm run test:live`로 확인할 수 있습니다. 고정 합성 입력으로 최대 2회만 시도하고, 첫 오류에서 즉시 중단합니다. 출력은 상태·건수뿐이며 키나 응답 본문을 출력하지 않습니다. 반복 실행을 자동화하지 않습니다.

## 데모 흐름

- 방문자: 소개와 승인 대기, API에서도 미승인 자동 대화 차단
- 가상 친구 A / 가상 동료 B: 계정별로 격리된 현재 세션만 사용
- 소유자: 상대와 관계를 자유문장으로 정의하고 승인 여부 변경
- 관계 변경 시 해당 계정의 이전 세션 초기화. 처리 중 관계가 바뀌면 늦게 도착한 응답 폐기
- 새로고침 후 서버 메모리의 현재 대화 유지. 서버 재시작 시 합성 초기값으로 복원

데모 계정 선택은 **보안 인증이 아닙니다.** 실제 로그인·소유자 인증은 아직 미구현이므로 운영 배포할 수 없습니다.

## 코드와 데이터

코드 원격: byStander9/ai-replica-chat **PUBLIC**. 실제 메신저 원문·파생 자료·개인별 관계·대화 로그·DB·키와 로컬 보관 이력은 공개 저장소에 보내지 않습니다. 이 시제품은 그 자료를 읽지 않습니다.

[요구사항 요약](docs/requests.md) · [설계 결정](docs/decisions.md) · [AI 연결과 제한](docs/ai-integration.md) · [권한 경계](docs/security.md) · [검증 기록](docs/validation.md) · [공개 코드 정책](docs/public-code-policy.md)

## Optional Codex CLI experiment

`npm run dev:cli` selects a separate synthetic CLI provider and never loads the project API key. The final bounded live synthetic check succeeded with a schema-valid reply, duplicate-request suppression and counterpart isolation. The wrapper never retries or falls back to the API; CLI internal retries use official defaults. Default mock remains usable. See [CLI boundaries and evidence](docs/codex-cli.md). No messenger data or automatic sending is connected.

Generated replies have no forced AI prefix/suffix. Engine/mock status remains visible in the local test UI; this is not a claim that a person is currently typing.
