export const identities = ["visitor", "friend-a", "friend-b", "owner"] as const;
export type Identity = typeof identities[number];
export type ChatIdentity = Exclude<Identity, "owner">;
export interface Message { role: "user" | "assistant"; text: string; sequence: number }
export interface Relationship { accountId: ChatIdentity; label: string; description: string; approved: boolean }
export interface SessionView { identity: Identity; label: string; approved: boolean; mode: "mock"; messages: Message[] }
export interface ReplyInput { relationshipDescription: string; sessionMessages: readonly Message[] }
export interface Responder { readonly kind: "mock"; respond(input: ReplyInput): string }
export class ServiceError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export function parseIdentity(value: string | undefined): Identity {
  if (value === undefined) return "visitor";
  if ((identities as readonly string[]).includes(value)) return value as Identity;
  throw new ServiceError(400, "알 수 없는 데모 계정입니다.");
}
export class MockResponder implements Responder {
  readonly kind = "mock";
  respond(input: ReplyInput): string {
    const count = input.sessionMessages.filter(message => message.role === "user").length;
    if (input.relationshipDescription.trim().length === 0) throw new ServiceError(403, "관계 설명이 필요합니다.");
    return "[MOCK · 합성 데모] 현재 세션의 " + count + "번째 메시지를 받았어요. 이전 입력 " + Math.max(0, count - 1) + "개와 소유자의 자유문장 관계 설정을 전달하는 흐름을 확인했습니다. 실제 AI 답변이나 말투 학습 결과가 아닙니다.";
  }
}
export class ChatService {
  private readonly relationships = new Map<ChatIdentity, Relationship>([
    ["visitor", { accountId: "visitor", label: "미등록 방문자", description: "", approved: false }],
    ["friend-a", { accountId: "friend-a", label: "가상 친구 A", description: "합성 인물 A. 서로 편하게 일상 이야기를 나누는 가상의 관계.", approved: true }],
    ["friend-b", { accountId: "friend-b", label: "가상 동료 B", description: "합성 인물 B. 업무 이야기를 차분하게 나누는 가상의 관계.", approved: true }]
  ]);
  private readonly sessions = new Map<ChatIdentity, Message[]>();
  constructor(private readonly responder: Responder = new MockResponder()) {}
  private relation(identity: ChatIdentity): Relationship {
    const value = this.relationships.get(identity);
    if (!value) throw new ServiceError(404, "데모 상대를 찾을 수 없습니다.");
    return value;
  }
  session(identity: Identity): SessionView {
    if (identity === "owner") return { identity, label: "소유자 · 데모 관리자", approved: false, mode: "mock", messages: [] };
    const relation = this.relation(identity);
    return { identity, label: relation.label, approved: relation.approved, mode: "mock", messages: relation.approved ? structuredClone(this.sessions.get(identity) ?? []) : [] };
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
    const relation = this.relation(accountId as ChatIdentity);
    relation.description = description.trim();
    relation.approved = approved;
    return structuredClone(relation);
  }
  chat(identity: Identity, text: unknown): SessionView {
    if (identity === "owner") throw new ServiceError(403, "관리자는 이 데모에서 상대별 관계만 편집합니다.");
    const relation = this.relation(identity);
    if (!relation.approved || !relation.description.trim()) throw new ServiceError(403, "소유자가 관계를 등록한 상대만 자동 대화를 시작할 수 있습니다.");
    if (typeof text !== "string" || !text.trim() || text.length > 2000) throw new ServiceError(400, "메시지를 1~2,000자로 입력해 주세요.");
    const history = this.sessions.get(identity) ?? [];
    if (history.filter(message => message.role === "user").length >= 40) throw new ServiceError(409, "데모 세션 40회에 도달했습니다. 새 세션을 시작해 주세요.");
    const next = [...history, { role: "user" as const, text: text.trim(), sequence: history.length + 1 }];
    const reply = this.responder.respond({ relationshipDescription: relation.description, sessionMessages: structuredClone(next) });
    next.push({ role: "assistant", text: reply, sequence: next.length + 1 });
    this.sessions.set(identity, next);
    return this.session(identity);
  }
  reset(identity: Identity): SessionView {
    if (identity === "owner") throw new ServiceError(403, "관리자에게는 채팅 세션이 없습니다.");
    this.sessions.delete(identity);
    return this.session(identity);
  }
}
