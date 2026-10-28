type Identity = "visitor" | "friend-a" | "friend-b" | "owner";
interface Message { role: "user" | "assistant"; text: string; sequence: number }
interface Session { identity: Identity; label: string; approved: boolean; mode: "mock"; messages: Message[] }
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
let identity: Identity = "visitor";
let revision = 0;
let relationships: Relationship[] = [];
let busy = false;
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
  const options: RequestInit = { method, headers };
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
  const owner = session.identity === "owner";
  chatPanel.hidden = owner;
  adminPanel.hidden = !owner;
  element("account-label", HTMLParagraphElement).textContent = session.label;
  const badge = element("approval-badge", HTMLSpanElement);
  badge.textContent = session.approved ? "관계 등록됨" : "승인 대기";
  badge.classList.toggle("approved", session.approved);
  element("pending-notice", HTMLDivElement).hidden = session.approved;
  messageInput.disabled = !session.approved || busy;
  sendButton.disabled = !session.approved || busy;
  resetButton.disabled = !session.approved || busy;
  messageInput.placeholder = session.approved ? "합성 예시 메시지를 입력해 보세요" : "승인된 상대만 메시지를 보낼 수 있어요";
  element("session-note", HTMLSpanElement).textContent = "현재 세션 " + session.messages.filter(m => m.role === "user").length + "/40회 · 목 응답";
  messages.replaceChildren();
  if (session.approved && session.messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-chat";
    empty.textContent = "새 대화를 시작해 보세요. 실제 AI가 아닌 목 응답으로 데이터 흐름을 확인합니다.";
    messages.append(empty);
  }
  for (const message of session.messages) {
    const bubble = document.createElement("div");
    bubble.className = "bubble " + message.role;
    if (message.role === "assistant") {
      const label = document.createElement("span");
      label.className = "bubble-label"; label.textContent = "AI REPLICA / MOCK";
      bubble.append(label);
    }
    bubble.append(document.createTextNode(message.text));
    messages.append(bubble);
  }
  messages.scrollTop = messages.scrollHeight;
}
function showRelationship(): void {
  const relation = relationships.find(value => value.accountId === relationAccount.value);
  relationDescription.value = relation?.description ?? "";
  relationApproved.checked = relation?.approved ?? false;
}
async function load(): Promise<void> {
  const current = ++revision;
  busy = false;
  messageInput.value = "";
  notice("");
  try {
    const session = await api<Session>("/api/session");
    if (current !== revision) return;
    render(session);
    if (session.identity === "owner") {
      const values = await api<Relationship[]>("/api/admin/relationships");
      if (current !== revision) return;
      relationships = values;
      relationAccount.replaceChildren();
      for (const relation of values) {
        const option = document.createElement("option");
        option.value = relation.accountId;
        option.textContent = relation.label + (relation.approved ? " · 승인됨" : " · 대기");
        relationAccount.append(option);
      }
      showRelationship();
    }
  } catch (error: unknown) {
    if (current === revision) notice(error instanceof Error ? error.message : "연결을 확인해 주세요.", true);
  }
}
identitySelect.addEventListener("change", () => {
  identity = identitySelect.value as Identity;
  sessionStorage.setItem("synthetic-demo-identity", identity);
  messageInput.disabled = true; sendButton.disabled = true; resetButton.disabled = true;
  void load();
});
relationAccount.addEventListener("change", showRelationship);
element("chat-form", HTMLFormElement).addEventListener("submit", event => {
  event.preventDefault();
  if (busy || messageInput.disabled) return;
  const text = messageInput.value.trim();
  if (!text) { notice("메시지를 입력해 주세요.", true); return; }
  const current = revision;
  busy = true; sendButton.disabled = true; messageInput.disabled = true;
  void api<Session>("/api/chat", "POST", { message: text }).then(session => {
    if (current !== revision) return;
    busy = false; render(session); messageInput.value = ""; messageInput.focus();
    notice("목 응답으로 데이터 흐름을 확인했습니다.");
  }).catch((error: unknown) => {
    if (current !== revision) return;
    busy = false; messageInput.disabled = false; sendButton.disabled = false;
    notice(error instanceof Error ? error.message : "전송에 실패했습니다.", true);
  });
});
resetButton.addEventListener("click", () => {
  if (busy || resetButton.disabled) return;
  const current = revision;
  void api<Session>("/api/session/reset", "POST", {}).then(session => {
    if (current !== revision) return;
    render(session); notice("이 데모 계정의 현재 세션을 초기화했습니다.");
  }).catch((error: unknown) => notice(error instanceof Error ? error.message : "초기화에 실패했습니다.", true));
});
element("relationship-form", HTMLFormElement).addEventListener("submit", event => {
  event.preventDefault();
  const current = revision;
  const save = element("save-relationship", HTMLButtonElement);
  save.disabled = true;
  void api<Relationship>("/api/admin/relationships", "POST", { accountId: relationAccount.value, description: relationDescription.value, approved: relationApproved.checked }).then(value => {
    if (current !== revision) return;
    relationships = relationships.map(item => item.accountId === value.accountId ? value : item);
    const selected = relationAccount.selectedOptions[0];
    if (selected) selected.textContent = value.label + (value.approved ? " · 승인됨" : " · 대기");
    notice("관계 문장과 승인 상태를 저장했습니다. 목 응답 모드가 유지됩니다.");
  }).catch((error: unknown) => {
    if (current === revision) notice(error instanceof Error ? error.message : "저장에 실패했습니다.", true);
  }).finally(() => { save.disabled = false; });
});
void load();
