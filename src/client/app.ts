type Identity = "visitor" | "friend-a" | "friend-b" | "owner";
type Mode = "mock" | "openai-synthetic";
interface Message { role: "user" | "assistant"; text: string; sequence: number }
interface Provider { mode: Mode; ready: boolean; model: string | null; notice: string; remainingRequests: number | null }
interface Session { identity: Identity; label: string; approved: boolean; mode: Mode; provider: Provider; allowedMessages: string[]; inFlight: boolean; messages: Message[] }
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
let identity: Identity = "visitor";
let revision = 0;
let relationships: Relationship[] = [];
let busy = false;
let lastSession: Session | undefined;
const tickets = new Map<Identity, { text: string; id: string }>();
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
  const options: RequestInit = { method, headers, signal: AbortSignal.timeout(25000) };
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
  const ai = session.mode === "openai-synthetic";
  const waiting = busy || session.inFlight;
  chatPanel.hidden = owner; adminPanel.hidden = !owner;
  element("account-label", HTMLParagraphElement).textContent = session.label;
  element("mode-label", HTMLSpanElement).textContent = ai ? "SYNTHETIC AI · 고정 예시 전용" : "MOCK 응답 · 외부 전송 없음";
  element("mode-description", HTMLParagraphElement).textContent = ai ? "합성 예시만 서버에서 AI로 전송합니다. 실제 인물의 말투 학습 결과가 아닙니다." : "실제 AI 연결이나 말투 학습 없이, 합성 인물과 목 응답으로 작동합니다.";
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
  element("session-note", HTMLSpanElement).textContent = waiting ? "응답 처리 중 · 중복 요청 방지" : "현재 세션 " + session.messages.filter(m => m.role === "user").length + "/40회 · " + (ai ? "남은 API 시도 " + session.provider.remainingRequests : "목 응답");
  messages.replaceChildren();
  if (session.approved && session.messages.length === 0) {
    const empty = document.createElement("p"); empty.className = "empty-chat";
    empty.textContent = ai ? "고정된 합성 예시로만 AI 연결을 확인합니다. 실제 개인정보는 전송하지 않습니다." : "새 대화를 시작해 보세요. 실제 AI가 아닌 목 응답으로 데이터 흐름을 확인합니다.";
    messages.append(empty);
  }
  for (const message of session.messages) {
    const bubble = document.createElement("div"); bubble.className = "bubble " + message.role;
    if (message.role === "assistant") {
      const label = document.createElement("span"); label.className = "bubble-label";
      label.textContent = ai ? "AI REPLICA / SYNTHETIC AI" : "AI REPLICA / MOCK"; bubble.append(label);
    }
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
  busy = false; messageInput.value = ""; notice("");
  try {
    const session = await api<Session>("/api/session");
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
  sessionStorage.setItem("synthetic-demo-identity", identity);
  messageInput.disabled = true; sendButton.disabled = true; resetButton.disabled = true;
  void load();
});
syntheticSelect.addEventListener("change", () => { messageInput.value = syntheticSelect.value; });
relationAccount.addEventListener("change", showRelationship);
element("refresh-button", HTMLButtonElement).addEventListener("click", () => { void load(); });
element("chat-form", HTMLFormElement).addEventListener("submit", event => {
  event.preventDefault();
  if (busy || messageInput.disabled) return;
  const text = messageInput.value.trim();
  if (!text) { notice("전송할 합성 메시지를 입력하거나 선택해 주세요.", true); return; }
  let ticket = tickets.get(identity);
  if (!ticket || ticket.text !== text) { ticket = { text, id: crypto.randomUUID() }; tickets.set(identity, ticket); }
  const current = revision;
  busy = true; if (lastSession) render(lastSession);
  void api<Session>("/api/chat", "POST", { message: text, requestId: ticket.id }).then(session => {
    if (current !== revision) return;
    tickets.delete(identity); busy = false; render(session); messageInput.value = ""; syntheticSelect.value = "";
    notice(session.mode === "mock" ? "목 응답으로 데이터 흐름을 확인했습니다." : "합성 예시의 AI 응답을 받았습니다. 실제 말투 학습 결과가 아닙니다.");
  }).catch(async (error: unknown) => {
    if (current !== revision) return;
    busy = false;
    const message = error instanceof Error ? error.message : "응답을 확인할 수 없습니다.";
    // A failed or timed-out request keeps its ID. Never automatically resubmit it.
    try { const session = await api<Session>("/api/session"); if (current === revision) render(session); } catch { if (lastSession && current === revision) render(lastSession); }
    if (current === revision) { messageInput.value = text; notice(message + " 자동 재시도는 하지 않았습니다.", true); }
  });
});
resetButton.addEventListener("click", () => {
  if (busy || resetButton.disabled) return;
  const current = revision;
  busy = true; if (lastSession) render(lastSession);
  void api<Session>("/api/session/reset", "POST", {}).then(session => {
    if (current !== revision) return;
    busy = false; tickets.delete(identity); render(session); messageInput.value = ""; syntheticSelect.value = "";
    notice("이 데모 계정의 현재 세션을 초기화했습니다.");
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
