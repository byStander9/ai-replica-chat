# 확정된 제품 방향과 이번 시제품

## 제품 방향

- 누구나 볼 수 있는 웹 소개 화면으로 시작합니다. 자동 대화는 소유자가 관계를 등록한 상대에게만 허용합니다.
- 관계는 사용자가 작성하는 자유로운 문장입니다. 숫자나 사전 설정된 친밀도 범위로 강제하지 않습니다.
- 본인다운 말투와 농담 재현을 우선하며 현재 대화의 맥락을 활용하는 방향입니다.
- 상대방의 말은 향후 입력 맥락, 소유자 본인의 응답만 학습 타깃이 될 수 있습니다. 현재는 데이터 연결과 학습이 없습니다.
- 과거 메신저의 사적 사실을 기억하거나 조회하는 기능은 만들지 않습니다.
- 작업 파일은 PC 로컬 디스크에, 개발 코드는 로컬 Git과 공개 코드 전용 GitHub 저장소로 관리합니다.

## 이번 구현

TypeScript와 Node.js 기본 HTTP 서버, 정적 HTML/CSS 화면을 사용합니다. 별도 DB 없이 합성 관계와 계정별 현 세션을 메모리에서 관리합니다. 목 응답기는 현재 계정에 승인된 관계 문장과 그 계정의 세션만 받습니다. 기본 mock 외에 명시적 합성 AI 테스트를 지원합니다. 실제 인물의 말투 학습은 하지 않습니다.

소개, 승인 대기, 등록 상대 채팅, 소유자 자유문장 관계 편집, 계정별 세션 유지·초기화 흐름을 확인합니다. 서버가 API 권한 경계를 검사하고 화면 문자열은 DOM textContent로 렌더링합니다.

## 미결정 / 후속

실제 로그인과 상대 식별 방식, 소유자 인증, 초대 방식, 운영 DB와 보존·삭제 정책, 실제 서비스의 모델 정책, 문맥 검토 방식 및 운영 배포 조건. 개인별 초대 링크는 확정된 설계가 아닙니다.

API 키 생성·저장은 별도 보안 설정 작업입니다. 구현은 기존 키 검색이나 신규 키 생성을 하지 않습니다. 승인된 파일과 고정 합성 예시만 사용하는 API 테스트는 별도 명시적으로 실행합니다.

## Personal automation direction

The intended tool belongs to one owner, with multiple incoming conversation counterparts. The web UI is currently a temporary local test surface. Messenger automatic sending remains unimplemented. An optional ChatGPT-login CLI adapter uses bounded execution with no wrapper retry or API fallback; the final synthetic live check verified a valid reply, duplicate suppression and counterpart isolation. Replies do not force AI markers, while owner-facing engine labels remain explicit.
