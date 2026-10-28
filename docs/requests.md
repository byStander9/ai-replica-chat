# 개발 요구사항 요약

## 목적

웹 채팅에서 소유자가 정한 관계 설명과 현재 대화 맥락을 바탕으로 응답하는 AI 복제본을 준비합니다. 초기 제품 목표는 말투와 농담의 표현 방식이며, 과거 메신저의 사적 사실을 기억하는 기능은 포함하지 않습니다.

## 접근과 관계

- 소개 화면은 누구나 볼 수 있는 방향입니다.
- 자동 대화는 소유자가 관계를 등록하고 승인한 상대에게만 허용합니다.
- 관계는 자유로운 문장으로 작성합니다. 숫자나 고정 친밀도 모드로 강제하지 않습니다.
- 일반 상대는 관계 설정이나 다른 상대의 대화를 변경하거나 조회할 수 없습니다.
- 실제 로그인·상대 식별·소유자 인증 방식은 아직 미정입니다.

## 현재 시제품

- 합성 인물과 합성 관계만 사용합니다.
- 기본 mock과 별도 합성 AI 테스트 모드를 구분합니다. mock을 실제 AI 응답으로 표시하지 않으며 개인 말투 학습 결과라고 주장하지 않습니다.
- 현 세션의 계정별 대화 흐름, 승인 전 차단, 관리자 관계 편집, 계정 간 격리를 검증합니다.
- 데이터는 메모리에만 두며 재시작하면 초기화됩니다.
- 데모 계정 선택은 localhost 개발 모드 전용이며 운영 인증을 대신하지 않습니다.

## 코드와 데이터 분리

개발 코드는 로컬 Git과 비공개 GitHub 저장소로 관리합니다. 실제 메신저 원문, 파생 자료, 개인별 관계 설정, 대화 로그, DB, 환경 파일 및 키는 코드 저장소에 포함하지 않습니다. 현재 시제품은 실제 데이터에 연결하지 않습니다. 모델 API는 별도로 승인된 고정 합성 예시 테스트에만 사용합니다.

## 후속 결정

운영 인증, 저장·보존·삭제 정책, 모델 연결, 문맥 검토·품질 평가 및 운영 배포 조건을 별도로 정합니다. 개인별 초대 방식은 확정된 설계가 아닙니다.

Personal-use automation is the intended direction; the web UI is a temporary local synthetic test interface. Optional CLI integration must reuse official ChatGPT auth without reading/copying tokens, permit only fixed synthetic inputs, and fail closed when safety restrictions cannot be verified. Generated reply bodies have no forced AI marker; owner-facing engine status remains. Actual messenger data/transport and public deployment are separate future work.
