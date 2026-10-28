import { ServiceError, type Message, type ProviderInfo, type ReplyInput, type Responder, type ResponseMode } from "./domain.js";
import { SYNTHETIC_MESSAGES, SYNTHETIC_RELATIONS } from "./synthetic.js";
export { ServiceError, type Message, type ReplyInput, type Responder } from "./domain.js";
export const identities = ["visitor", "friend-a", "friend-b", "owner"] as const;
export type Identity = typeof identities[number];
export type ChatIdentity = Exclude<Identity, "owner">;
export interface Relationship { accountId: ChatIdentity; label: string; description: string; approved: boolean }
export interface SessionView { identity: Identity; label: string; approved: boolean; mode: ResponseMode; provider: ProviderInfo; allowedMessages: readonly string[]; inFlight: boolean; messages: Message[] }
interface RequestRecord { text: string; epoch: number; promise: Promise<void> }
export function parseIdentity(value: string | undefined): Identity {
  if (value === undefined) return "visitor";
  if ((identities as readonly string[]).includes(value)) return value as Identity;
  throw new ServiceError(400, "알 수 없는 데모 계정입니다.");
}
export class MockResponder implements Responder {
  get info(): ProviderInfo { return { mode: "mock", ready: true, model: null, notice: "MOCK · 외부 API 전송 없음", remainingRequests: null }; }
  respond(input: ReplyInput): string {
    const count = input.sessionMessages.filter(message => message.role === "user").length;
    return "[MOCK · 합성 데모] 현재 세션의 " + count + "번째 메시지를 받았어요. 이전 입력 " + Math.max(0, count - 1) + "개와 자유문장 관계 설정을 전달하는 흐름입니다. 실제 AI 답변이나 말투 학습 결과가 아닙니다.";
  }
}
export class ChatService {
  private readonly relationships = new Map<ChatIdentity, Relationship>([
    ["visitor", { accountId: "visitor", label: "방문자 데모", description: "", approved: false }],
    ["friend-a", { accountId: "friend-a", label: "가상 친구 A", description: SYNTHETIC_RELATIONS["friend-a"], approved: true }],
    ["friend-b", { accountId: "friend-b", label: "가상 동료 B", description: SYNTHETIC_RELATIONS["friend-b"], approved: true }]
  ]);
  private readonly sessions = new Map<ChatIdentity, Message[]>();
  private readonly epochs = new Map<ChatIdentity, number>();
  private readonly inFlight = new Map<ChatIdentity, string>();
  private readonly records = new Map<ChatIdentity, Map<string, RequestRecord>>();
  constructor(private readonly responder: Responder = new MockResponder()) {}
  private relation(identity: ChatIdentity): Relationship {
    const value = this.relationships.get(identity);
    if (!value) throw new ServiceError(404, "데모 상대를 찾을 수 없습니다.");
    return value;
  }
  session(identity: Identity): SessionView {
    const provider = this.responder.info;
    const common = { mode: provider.mode, provider, allowedMessages: provider.mode !== "mock" ? SYNTHETIC_MESSAGES : [] };
    if (identity === "owner") return { ...common, identity, label: "소유자 · 데모 관리자", approved: false, inFlight: false, messages: [] };
    const relation = this.relation(identity);
    return { ...common, identity, label: relation.label, approved: relation.approved, inFlight: this.inFlight.has(identity), messages: relation.approved ? structuredClone(this.sessions.get(identity) ?? []) : [] };
  }
  listRelationships(identity: Identity): Relationship[] {
    if (identity !== "owner") throw new ServiceError(403, "소유자만 관계를 관리할 수 있습니다.");
    return structuredClone([...this.relationships.values()]);
  }
  updateRelationship(identity: Identity, accountId: string, description: unknown, approved: unknown): Relationship {
    if (identity !== "owner") throw new ServiceError(403, "소유자만 관계를 수정할 수 있습니다.");
    if (!["visitor", "friend-a", "friend-b"].includes(accountId)) throw new ServiceError(404, "데모 상대를 찾을 수 없습니다.");
    if (typeof description !== "string" || description.length > 2000 || typeof approved !== "boolean") throw new ServiceError(400, "관계 설명은 2,000자 이내의 문장이어야 합니다.");
    if (approved && description.trim().length === 0) throw new ServiceError(400, "승인하려면 관계 설명을 작성해 주세요.");
    const account = accountId as ChatIdentity;
    const relation = this.relation(account);
    relation.description = description.trim(); relation.approved = approved;
    this.epochs.set(account, (this.epochs.get(account) ?? 0) + 1);
    // A changed relationship starts a clean context. Pending replies cannot restore old state.
    this.sessions.delete(account);
    return structuredClone(relation);
  }
  async chat(identity: Identity, text: unknown, requestId: unknown): Promise<SessionView> {
    if (identity === "owner") throw new ServiceError(403, "관리자는 상대별 관계만 편집합니다.");
    const relation = this.relation(identity);
    if (!relation.approved || !relation.description.trim()) throw new ServiceError(403, "소유자가 관계를 등록한 상대만 자동 대화를 시작할 수 있습니다.", "not_approved");
    if (typeof text !== "string" || !text.trim() || text.length > 2000) throw new ServiceError(400, "메시지를 1~2,000자로 입력해 주세요.");
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new ServiceError(400, "유효한 요청 ID가 필요합니다.");
    const normalized = text.trim();
    const epoch = this.epochs.get(identity) ?? 0;
    let ledger = this.records.get(identity);
    if (!ledger) { ledger = new Map(); this.records.set(identity, ledger); }
    const previous = ledger.get(requestId);
    if (previous) {
      if (previous.text !== normalized) throw new ServiceError(409, "같은 요청 ID로 다른 메시지를 보낼 수 없습니다.", "request_conflict");
      if (previous.epoch !== epoch) throw new ServiceError(409, "이전 세션의 요청 ID입니다.", "stale_request");
      await previous.promise;
      return this.session(identity);
    }
    if (this.inFlight.has(identity)) throw new ServiceError(409, "이 계정의 이전 응답을 기다려 주세요.", "request_in_flight");
    if (ledger.size >= 128) throw new ServiceError(409, "데모 요청 기록 한도입니다. 서버를 다시 시작해 주세요.", "request_limit");
    const history = this.sessions.get(identity) ?? [];
    if (history.filter(message => message.role === "user").length >= 40) throw new ServiceError(409, "데모 세션 40회에 도달했습니다. 새 세션을 시작해 주세요.");
    this.inFlight.set(identity, requestId);
    const next = [...history, { role: "user" as const, text: normalized, sequence: history.length + 1 }];
    const description = relation.description;
    const operation = (async () => {
      const reply = await this.responder.respond({ relationshipDescription: description, sessionMessages: structuredClone(next) });
      if ((this.epochs.get(identity) ?? 0) !== epoch || !this.relation(identity).approved) throw new ServiceError(409, "관계 또는 승인 상태가 바뀌어 응답을 보관하지 않았습니다.", "state_changed");
      if (!reply.trim() || reply.length > 4000) throw new ServiceError(502, "유효한 응답을 받지 못했습니다.", "invalid_response");
      next.push({ role: "assistant", text: reply, sequence: next.length + 1 });
      this.sessions.set(identity, next);
    })().finally(() => { this.inFlight.delete(identity); });
    ledger.set(requestId, { text: normalized, epoch, promise: operation });
    await operation;
    return this.session(identity);
  }
  reset(identity: Identity): SessionView {
    if (identity === "owner") throw new ServiceError(403, "관리자에게는 채팅 세션이 없습니다.");
    if (this.inFlight.has(identity)) throw new ServiceError(409, "응답 처리 중에는 세션을 초기화할 수 없습니다.", "request_in_flight");
    this.sessions.delete(identity);
    this.epochs.set(identity, (this.epochs.get(identity) ?? 0) + 1);
    return this.session(identity);
  }
}
