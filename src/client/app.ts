type Identity = "visitor" | "friend-a" | "friend-b" | "owner";
type Mode = "mock" | "openai-synthetic" | "codex-synthetic";
type RoomId = "main" | "side" | "group";
interface Message { role: "user" | "assistant"; text: string; sequence: number; speakerLabel?: string; speakerId?: string; sentAtMs?: number; groupId?: string }
interface Context { messages: Message[]; report: { selectedMessages: number; selectedGroups: number; targetSequence: number; serializedBytes: number; maxBytes: number; requiresReview: boolean; longGap: boolean; dateBoundary: boolean; multipleSpeakers: boolean; dropped: { time: number; gap: number; count: number; bytes: number; afterTarget: number } } }
interface Provider { mode: Mode; ready: boolean; model: string | null; notice: string; remainingRequests: number | null }
interface Session { identity: Identity; label: string; roomId: RoomId; rooms: {id:RoomId;label:string}[]; context: Context | null; approved: boolean; mode: Mode; provider: Provider; allowedMessages: string[]; inFlight: boolean; messages: Message[] }
interface Relationship { accountId: string; label: string; description: string; approved: boolean }
function element<T extends HTMLElement>(id: string, constructor: { new (...args: never[]): T }): T {
  const found = document.getElementById(id);
  if (!(found instanceof constructor)) throw new Error("필수 화면 요소가 없습니다: " + id);
  return found;
}
const identitySelect = element("identity", HTMLSelectElement);
const messageInput = element("message", HTMLTextAreaElement);
const sendButton = element("send-button", HTMLButtonElement);
const resetButton = element("reset-button", HTMLButtonElement);
const messages = element("messages", HTMLDivElement);
const feedback = element("feedback", HTMLParagraphElement);
const chatPanel = element("chat-panel", HTMLElement);
const adminPanel = element("admin-panel", HTMLElement);
const relationAccount = element("relationship-account", HTMLSelectElement);
const relationDescription = element("relationship-description", HTMLTextAreaElement);
const relationApproved = element("relationship-approved", HTMLInputElement);
const syntheticSelect = element("synthetic-message", HTMLSelectElement);
const roomSelect = element("room", HTMLSelectElement);
const batchButton = element("batch-demo", HTMLButtonElement);
let identity: Identity = "visitor";
let roomId: RoomId = "main";
let revision = 0;
let relationships: Relationship[] = [];
let busy = false;
let lastSession: Session | undefined;
const tickets = new Map<string, { text: string; id: string }>();
const sessionPath = () => "/api/session?room=" + encodeURIComponent(roomId);
const stored = sessionStorage.getItem("synthetic-demo-identity");
if (["visitor", "friend-a", "friend-b", "owner"].includes(stored ?? "")) identity = stored as Identity;
identitySelect.value = identity;
function notice(text: string, error = false): void {
  feedback.textContent = text;
  feedback.classList.toggle("error", error);
  feedback.setAttribute("role", error ? "alert" : "status");
}
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Demo-Identity": identity };
  const options: RequestInit = { method, headers, signal: AbortSignal.timeout(60000) };
  if (body !== undefined) { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
  const response = await fetch(path, options);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : "요청을 완료할 수 없습니다.";
    throw new Error(error);
  }
  return payload as T;
}
function render(session: Session): void {
  lastSession = session;
  const owner = session.identity === "owner";
  const ai = session.mode !== "mock";
  const waiting = busy || session.inFlight;
  roomId = session.roomId;
  roomSelect.replaceChildren();
  for (const room of session.rooms) { const option = document.createElement("option"); option.value = room.id; option.textContent = room.label; roomSelect.append(option); }
  roomSelect.value = roomId; roomSelect.disabled = waiting || ai || owner;
  batchButton.hidden = ai || roomId !== "group";
  batchButton.disabled = waiting || !session.approved;
  chatPanel.hidden = owner; adminPanel.hidden = !owner;
  element("account-label", HTMLParagraphElement).textContent = session.label;
  element("mode-label", HTMLSpanElement).textContent = ai ? (session.mode === "codex-synthetic" ? "CODEX CLI · 합성 예시 전용" : "OPENAI API · 합성 예시 전용") : "MOCK 응답 · 외부 전송 없음";
  element("mode-description", HTMLParagraphElement).textContent = session.mode === "codex-synthetic" && !session.provider.ready ? "CLI 실행이 비활성화되었습니다. 아래 연결 상태와 호출 한도를 확인하세요." : ai ? "합성 예시만 서버에서 AI로 전송합니다. 실제 인물의 말투 학습 결과가 아닙니다." : "실제 AI 연결이나 말투 학습 없이, 합성 인물과 목 응답으로 작동합니다.";
  element("model-status", HTMLElement).textContent = ai ? session.provider.model ?? "Not configured" : "Not connected";
  element("provider-notice", HTMLParagraphElement).textContent = session.provider.notice;
  element("mode-footer", HTMLSpanElement).textContent = ai ? "AI 복제본 · SYNTHETIC AI" : "AI 복제본 · MOCK MODE";
  element("admin-mode-note", HTMLParagraphElement).textContent = ai ? "AI 모드는 고정 합성 관계만 전송합니다. 자유문장 편집 흐름은 유지되지만 수정한 문장은 API로 보내지 않습니다." : "관계 문장을 자유롭게 수정할 수 있습니다. mock 모드는 외부 API를 사용하지 않습니다.";
  const badge = element("approval-badge", HTMLSpanElement);
  badge.textContent = session.approved ? "관계 등록됨" : "승인 대기";
  badge.classList.toggle("approved", session.approved);
  element("pending-notice", HTMLDivElement).hidden = session.approved;
  messageInput.readOnly = ai;
  messageInput.disabled = !session.approved || !session.provider.ready || waiting;
  sendButton.disabled = messageInput.disabled;
  resetButton.disabled = !session.approved || waiting;
  messageInput.placeholder = ai ? "아래의 고정 합성 예시를 선택해 주세요" : session.approved ? "합성 예시 메시지를 입력해 보세요" : "승인된 상대만 메시지를 보낼 수 있어요";
  element("synthetic-controls", HTMLDivElement).hidden = !ai;
  syntheticSelect.disabled = messageInput.disabled;
  const selected = syntheticSelect.value;
  syntheticSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = ""; placeholder.textContent = "전송할 합성 예시 선택";
  syntheticSelect.append(placeholder);
  for (const text of session.allowedMessages) {
    const option = document.createElement("option"); option.value = text; option.textContent = text; syntheticSelect.append(option);
  }
  if (session.allowedMessages.includes(selected)) syntheticSelect.value = selected;
  element("session-note", HTMLSpanElement).textContent = waiting ? "응답 처리 중 · 중복 요청 방지" : "현재 세션 " + session.messages.filter(m => m.role === "user").length + "/40회 · " + (ai ? "남은 엔진 시도 " + session.provider.remainingRequests : "목 응답");
  const context = session.context, review = element("context-messages", HTMLOListElement);
  review.replaceChildren();
  if (context) {
    const report = context.report, dropped = Object.values(report.dropped).reduce((a, b) => a + b, 0);
    element("context-notice", HTMLParagraphElement).textContent = "마지막 응답 입력: " + report.selectedMessages + "발언 / " + report.selectedGroups + "묶음 · " + report.serializedBytes + "/" + report.maxBytes + " UTF-8 bytes (토큰 수 아님) · 생략 " + dropped + "개 · " + (report.requiresReview ? "문맥 검토 필요" : "문맥 충분성 미확인");
    element("context-boundaries", HTMLParagraphElement).textContent = "시간/날짜 제외 " + report.dropped.time + ", 공백/불완전 묶음 제외 " + report.dropped.gap + ", 개수 제한 " + report.dropped.count + ", 크기 제한 " + report.dropped.bytes + ", 목표 이후 제외 " + report.dropped.afterTarget + (report.longGap ? " · 긴 공백에서 새 구간" : "") + (report.dateBoundary ? " · UTC 날짜 경계" : "") + (report.multipleSpeakers ? " · 여러 상대 화자: 관계를 추정하지 않음" : "") + ". 묶음은 실제 답장 링크가 아닙니다.";
    const targetTime = context.messages.at(-1)?.sentAtMs;
    for (const message of context.messages) {
      const item = document.createElement("li");
      const seconds = targetTime !== undefined && message.sentAtMs !== undefined ? Math.round((targetTime - message.sentAtMs) / 1000) : 0;
      item.textContent = "#" + message.sequence + " · " + (message.speakerLabel ?? message.role) + " · 최신 입력 " + seconds + "초 전: " + message.text;
      review.append(item);
    }
  } else {
    element("context-notice", HTMLParagraphElement).textContent = "관계 설정과 최근 문맥을 분리합니다. 최대 10분·40발언·크기 예산 안에서 완전한 묶음을 선택하며 충분성을 보장하지 않습니다.";
    element("context-boundaries", HTMLParagraphElement).textContent = "아직 성공한 응답의 입력 문맥이 없습니다. 실제 메신저 데이터는 연결하지 않았습니다.";
  }
  messages.replaceChildren();
  if (session.approved && session.messages.length === 0) {
    const empty = document.createElement("p"); empty.className = "empty-chat";
    empty.textContent = ai ? "고정된 합성 예시로만 AI 연결을 확인합니다. 실제 개인정보는 전송하지 않습니다." : "새 대화를 시작해 보세요. 실제 AI가 아닌 목 응답으로 데이터 흐름을 확인합니다.";
    messages.append(empty);
  }
  for (const message of session.messages) {
    const bubble = document.createElement("div"); bubble.className = "bubble " + message.role;
    const label = document.createElement("span"); label.className = "bubble-label";
    label.textContent = "#" + message.sequence + " · " + (message.speakerLabel ?? message.role) + (message.role === "assistant" ? (ai ? " / SYNTHETIC AI" : " / MOCK") : ""); bubble.append(label);
    bubble.append(document.createTextNode(message.text)); messages.append(bubble);
  }
  messages.scrollTop = messages.scrollHeight;
}
function showRelationship(): void {
  const relation = relationships.find(value => value.accountId === relationAccount.value);
  relationDescription.value = relation?.description ?? ""; relationApproved.checked = relation?.approved ?? false;
}
async function load(): Promise<void> {
  const current = ++revision;
  busy = false; lastSession = undefined; messageInput.value = ""; notice("");
  messageInput.disabled = true; sendButton.disabled = true; resetButton.disabled = true; batchButton.disabled = true;
  messages.replaceChildren(); element("context-messages", HTMLOListElement).replaceChildren();
  element("context-notice", HTMLParagraphElement).textContent = "선택한 상대와 방의 문맥을 불러오는 중입니다.";
  element("context-boundaries", HTMLParagraphElement).textContent = "";
  try {
    const session = await api<Session>(sessionPath());
    if (current !== revision) return;
    render(session);
    if (session.identity === "owner") {
      const values = await api<Relationship[]>("/api/admin/relationships");
      if (current !== revision) return;
      relationships = values; relationAccount.replaceChildren();
      for (const relation of values) {
        const option = document.createElement("option"); option.value = relation.accountId;
        option.textContent = relation.label + (relation.approved ? " · 승인됨" : " · 대기"); relationAccount.append(option);
      }
      showRelationship();
    }
  } catch (error: unknown) { if (current === revision) notice(error instanceof Error ? error.message : "연결을 확인해 주세요.", true); }
}
identitySelect.addEventListener("change", () => {
  identity = identitySelect.value as Identity;
  roomId = "main";
  sessionStorage.setItem("synthetic-demo-identity", identity);
  messageInput.disabled = true; sendButton.disabled = true; resetButton.disabled = true;
  void load();
});
roomSelect.addEventListener("change", () => { roomId = roomSelect.value as RoomId; void load(); });
syntheticSelect.addEventListener("change", () => { messageInput.value = syntheticSelect.value; });
relationAccount.addEventListener("change", showRelationship);
element("refresh-button", HTMLButtonElement).addEventListener("click", () => { void load(); });
function sendRequest(path: string, body: Record<string, unknown>, signature: string, text: string): void {
  const scope = identity + "/" + roomId;
  let ticket = tickets.get(scope);
  if (!ticket || ticket.text !== signature) { ticket = { text: signature, id: crypto.randomUUID() }; tickets.set(scope, ticket); }
  const current = ++revision;
  busy = true; if (lastSession) render(lastSession);
  void api<Session>(path, "POST", { ...body, roomId, requestId: ticket.id }).then(session => {
    if (current !== revision) return;
    tickets.delete(scope); busy = false; render(session); messageInput.value = ""; syntheticSelect.value = "";
    notice(session.mode === "mock" ? "목 응답으로 데이터 흐름을 확인했습니다." : "합성 예시의 AI 응답을 받았습니다. 실제 말투 학습 결과가 아닙니다.");
  }).catch(async (error: unknown) => {
    if (current !== revision) return;
    busy = false;
    const message = error instanceof Error ? error.message : "응답을 확인할 수 없습니다.";
    // A failed or timed-out request keeps its ID. Never automatically resubmit it.
    try { const session = await api<Session>(sessionPath()); if (current === revision) render(session); } catch { if (lastSession && current === revision) render(lastSession); }
    if (current === revision) { messageInput.value = text; notice(message + " 자동 재시도는 하지 않았습니다.", true); }
  });
}
element("chat-form", HTMLFormElement).addEventListener("submit", event => {
  event.preventDefault();
  if (busy || messageInput.disabled) return;
  const text = messageInput.value.trim();
  if (!text) { notice("전송할 합성 메시지를 입력하거나 선택해 주세요.", true); return; }
  sendRequest("/api/chat", { message: text }, "chat:" + text, text);
});
batchButton.addEventListener("click", () => {
  if (busy || batchButton.disabled || roomId !== "group" || lastSession?.mode !== "mock") return;
  const events = [
    { speakerId: "group-peer", text: "합성 예시: 가상의 모임 주제를 골라 보자.", ageSeconds: 0 },
    { speakerId: identity, text: "합성 예시: 앞선 주제는 퍼즐 이야기였어.", ageSeconds: 0 },
    { speakerId: identity, text: "합성 예시: 지금의 흐름을 이어서 짧게 답해 줘.", ageSeconds: 0 }
  ];
  sendRequest("/api/chat/batch", { events }, "batch:" + JSON.stringify(events), "");
});
resetButton.addEventListener("click", () => {
  if (busy || resetButton.disabled) return;
  const current = ++revision;
  busy = true; if (lastSession) render(lastSession);
  const scope = identity + "/" + roomId;
  void api<Session>("/api/session/reset", "POST", { roomId }).then(session => {
    if (current !== revision) return;
    busy = false; tickets.delete(scope); render(session); messageInput.value = ""; syntheticSelect.value = "";
    notice("이 상대의 현재 방만 초기화했습니다.");
  }).catch((error: unknown) => {
    if (current !== revision) return;
    busy = false; if (lastSession) render(lastSession);
    notice(error instanceof Error ? error.message : "초기화에 실패했습니다.", true);
  });
});
element("relationship-form", HTMLFormElement).addEventListener("submit", event => {
  event.preventDefault();
  const current = revision; const save = element("save-relationship", HTMLButtonElement); save.disabled = true;
  void api<Relationship>("/api/admin/relationships", "POST", { accountId: relationAccount.value, description: relationDescription.value, approved: relationApproved.checked }).then(value => {
    if (current !== revision) return;
    relationships = relationships.map(item => item.accountId === value.accountId ? value : item);
    const selected = relationAccount.selectedOptions[0];
    if (selected) selected.textContent = value.label + (value.approved ? " · 승인됨" : " · 대기");
    notice("관계 문장과 승인 상태를 저장했습니다. 해당 계정의 이전 세션은 초기화했습니다.");
  }).catch((error: unknown) => { if (current === revision) notice(error instanceof Error ? error.message : "저장에 실패했습니다.", true); })
    .finally(() => { save.disabled = false; });
});
void load();
