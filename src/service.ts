import { ServiceError, type Message, type ConversationMessage, type ProviderInfo, type ReplyInput, type Responder, type ResponseMode, type RoomId } from "./domain.js";
import { selectContext, type ContextSelection } from "./context.js";
import { SYNTHETIC_MESSAGES, SYNTHETIC_RELATIONS } from "./synthetic.js";
import { createHash } from "node:crypto";
export { ServiceError, type Message, type ReplyInput, type Responder } from "./domain.js";
export const identities = ["visitor", "friend-a", "friend-b", "owner"] as const;
export const rooms = [{ id: "main", label: "기본 대화" }, { id: "side", label: "별도 합성 대화" }, { id: "group", label: "합성 그룹 대화" }] as const;
export type Identity = typeof identities[number];
export type ChatIdentity = Exclude<Identity, "owner">;
export interface Relationship { accountId: ChatIdentity; label: string; description: string; approved: boolean }
export interface SessionView { identity: Identity; label: string; roomId: RoomId; rooms: readonly { id: RoomId; label: string }[]; approved: boolean; mode: ResponseMode; provider: ProviderInfo; allowedMessages: readonly string[]; inFlight: boolean; messages: Message[]; context: ContextSelection | null }
interface RequestRecord { fingerprint: string; epoch: string; promise: Promise<void> }
interface IncomingEvent { speakerId: string; text: string; ageSeconds: number }
export function parseIdentity(value: string | undefined): Identity {
  if (value === undefined) return "visitor";
  if ((identities as readonly string[]).includes(value)) return value as Identity;
  throw new ServiceError(400, "알 수 없는 데모 계정입니다.");
}
export class MockResponder implements Responder {
  get info(): ProviderInfo { return { mode: "mock", ready: true, model: null, notice: "MOCK · 외부 API 전송 없음", remainingRequests: null }; }
  respond(input: ReplyInput): string {
    const speakers = new Set(input.sessionMessages.filter(m => m.role === "user").map(m => "speakerId" in m ? m.speakerId : "counterpart")).size;
    return "[MOCK · 합성 데모] 선택된 최근 문맥 " + input.sessionMessages.length + "개와 상대 화자 " + speakers + "명의 순서를 전달했습니다. 관계 설명은 별도 설정입니다. 실제 AI 답변이나 말투 학습 결과가 아니며 문맥 충분성도 확인하지 않았습니다.";
  }
}
export class ChatService {
  private readonly relationships = new Map<ChatIdentity, Relationship>([
    ["visitor", { accountId: "visitor", label: "방문자 데모", description: "", approved: false }],
    ["friend-a", { accountId: "friend-a", label: "가상 친구 A", description: SYNTHETIC_RELATIONS["friend-a"], approved: true }],
    ["friend-b", { accountId: "friend-b", label: "가상 동료 B", description: SYNTHETIC_RELATIONS["friend-b"], approved: true }]
  ]);
  private readonly sessions = new Map<string, ConversationMessage[]>();
  private readonly contexts = new Map<string, ContextSelection>();
  private readonly relationshipEpochs = new Map<ChatIdentity, number>();
  private readonly roomEpochs = new Map<string, number>();
  private readonly inFlight = new Map<string, string>();
  private readonly records = new Map<string, Map<string, RequestRecord>>();
  private readonly now: () => number;
  constructor(private readonly responder: Responder = new MockResponder(), options: { now?: () => number } = {}) { this.now = options.now ?? Date.now; }
  private relation(identity: ChatIdentity): Relationship {
    const value = this.relationships.get(identity);
    if (!value) throw new ServiceError(404, "데모 상대를 찾을 수 없습니다.");
    return value;
  }
  private room(value: unknown): RoomId {
    if (!rooms.some(room => room.id === value)) throw new ServiceError(400, "알 수 없는 합성 대화방입니다.", "invalid_room");
    if (value !== "main" && this.responder.info.mode !== "mock") throw new ServiceError(400, "추가 방과 그룹 대화는 외부 전송 없는 mock에서만 확인합니다.", "mock_only");
    return value as RoomId;
  }
  private key(identity: Identity, roomId: RoomId): string { return identity + "/" + roomId; }
  private epoch(identity: ChatIdentity, key: string): string { return (this.relationshipEpochs.get(identity) ?? 0) + ":" + (this.roomEpochs.get(key) ?? 0); }
  session(identity: Identity, roomValue: unknown = "main"): SessionView {
    const roomId = this.room(roomValue), key = this.key(identity, roomId), provider = this.responder.info;
    const common = { roomId, rooms: provider.mode === "mock" ? rooms : rooms.slice(0, 1), mode: provider.mode, provider, allowedMessages: provider.mode !== "mock" ? SYNTHETIC_MESSAGES : [] };
    if (identity === "owner") return { ...common, identity, label: "소유자 · 데모 관리자", approved: false, inFlight: false, messages: [], context: null };
    const relation = this.relation(identity);
    return { ...common, identity, label: relation.label, approved: relation.approved, inFlight: this.inFlight.has(key), messages: relation.approved ? structuredClone(this.sessions.get(key) ?? []) : [], context: relation.approved ? structuredClone(this.contexts.get(key) ?? null) : null };
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
    const account = accountId as ChatIdentity, relation = this.relation(account);
    relation.description = description.trim(); relation.approved = approved;
    this.relationshipEpochs.set(account, (this.relationshipEpochs.get(account) ?? 0) + 1);
    for (const room of rooms) { const key = this.key(account, room.id); this.sessions.delete(key); this.contexts.delete(key); }
    return structuredClone(relation);
  }
  async chat(identity: Identity, text: unknown, requestId: unknown, roomValue: unknown = "main"): Promise<SessionView> {
    return this.submit(identity, roomValue, [{ speakerId: identity, text, ageSeconds: 0 }], requestId);
  }
  async chatBatch(identity: Identity, roomValue: unknown, events: unknown, requestId: unknown): Promise<SessionView> {
    if (this.responder.info.mode !== "mock") throw new ServiceError(400, "여러 화자 입력은 합성 mock 검사 전용입니다.", "mock_only");
    return this.submit(identity, roomValue, events, requestId);
  }
  private async submit(identity: Identity, roomValue: unknown, rawEvents: unknown, requestId: unknown): Promise<SessionView> {
    if (identity === "owner") throw new ServiceError(403, "관리자는 상대별 관계만 편집합니다.");
    const relation = this.relation(identity);
    if (!relation.approved || !relation.description.trim()) throw new ServiceError(403, "소유자가 관계를 등록한 상대만 자동 대화를 시작할 수 있습니다.", "not_approved");
    const roomId = this.room(roomValue), key = this.key(identity, roomId);
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new ServiceError(400, "유효한 요청 ID가 필요합니다.");
    if (!Array.isArray(rawEvents) || rawEvents.length < 1 || rawEvents.length > 8) throw new ServiceError(400, "합성 입력 묶음은 1~8개 발언이어야 합니다.", "invalid_events");
    const events: IncomingEvent[] = rawEvents.map((raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length !== 3 || !("speakerId" in raw) || !("text" in raw) || !("ageSeconds" in raw)) throw new ServiceError(400, "발언 필드가 유효하지 않습니다.", "invalid_events");
      if (typeof raw.text !== "string" || !raw.text.trim() || raw.text.length > 2000) throw new ServiceError(400, "메시지를 1~2,000자로 입력해 주세요.");
      if (typeof raw.speakerId !== "string" || (raw.speakerId !== identity && !(roomId === "group" && raw.speakerId === "group-peer"))) throw new ServiceError(403, "이 합성 방의 화자가 아닙니다.", "invalid_speaker");
      if (typeof raw.ageSeconds !== "number" || !Number.isSafeInteger(raw.ageSeconds) || raw.ageSeconds < 0 || raw.ageSeconds > 600) throw new ServiceError(400, "과거 10분 이내의 상대 간격만 입력할 수 있습니다.", "invalid_time");
      return { speakerId: raw.speakerId, text: raw.text.trim(), ageSeconds: raw.ageSeconds };
    });
    if (events.at(-1)?.speakerId !== identity) throw new ServiceError(403, "관계가 승인된 요청 상대에게만 응답합니다. 다른 그룹 화자의 관계를 추정하지 않습니다.", "unapproved_target");
    if (events.at(-1)?.ageSeconds !== 0 || events.some((event, i) => i > 0 && event.ageSeconds > events[i - 1]!.ageSeconds)) throw new ServiceError(400, "최신 발언이 마지막에 오도록 시간순 입력이 필요합니다.", "invalid_time");
    if (events.reduce((n, e) => n + e.text.length, 0) > 4000) throw new ServiceError(413, "입력 묶음의 크기를 줄여 주세요.", "context_review_needed");
    // Deduplication retains a process-local fingerprint, not a second copy of failed message text.
    const fingerprint = createHash("sha256").update(JSON.stringify(events)).digest("hex"), epoch = this.epoch(identity, key);
    let ledger = this.records.get(key); if (!ledger) { ledger = new Map(); this.records.set(key, ledger); }
    const previous = ledger.get(requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ServiceError(409, "같은 요청 ID로 다른 메시지를 보낼 수 없습니다.", "request_conflict");
      if (previous.epoch !== epoch) throw new ServiceError(409, "이전 세션의 요청 ID입니다.", "stale_request");
      await previous.promise; return this.session(identity, roomId);
    }
    if (this.inFlight.has(key)) throw new ServiceError(409, "이 방의 이전 응답을 기다려 주세요.", "request_in_flight");
    if (ledger.size >= 128) throw new ServiceError(409, "데모 요청 기록 한도입니다. 서버를 다시 시작해 주세요.", "request_limit");
    const history = this.sessions.get(key) ?? [];
    if (history.filter(m => m.role === "user").length + events.length > 40) throw new ServiceError(409, "데모 세션 40회에 도달했습니다. 새 세션을 시작해 주세요.");
    const now = this.now(); if (!Number.isFinite(now)) throw new ServiceError(409, "로컬 시각을 확인해 주세요.", "invalid_time");
    let segment = 0;
    const incoming: ConversationMessage[] = events.map((event, index) => {
      if (index && events[index - 1]!.ageSeconds - event.ageSeconds > 60) segment++;
      return { role: "user", text: event.text, sequence: history.length + index + 1, eventId: requestId + ":" + index, roomId: key, speakerId: event.speakerId, speakerLabel: event.speakerId === identity ? relation.label : "가상 그룹 참여자 2", sentAtMs: now - event.ageSeconds * 1000, groupId: requestId + ":group:" + segment };
    });
    const next = [...history, ...incoming], target = incoming.at(-1)!;
    const selection = selectContext(next, key, target.sequence, now);
    const description = relation.description;
    this.inFlight.set(key, requestId);
    const operation = (async () => {
      const reply = await this.responder.respond({ relationshipDescription: description, sessionMessages: structuredClone(selection.messages), conversation: { roomId: key, targetSpeakerId: identity, report: structuredClone(selection.report) } });
      if (this.epoch(identity, key) !== epoch || !this.relation(identity).approved) throw new ServiceError(409, "관계 또는 승인 상태가 바뀌어 응답을 보관하지 않았습니다.", "state_changed");
      if (!reply.trim() || reply.length > 4000) throw new ServiceError(502, "유효한 응답을 받지 못했습니다.", "invalid_response");
      const replyTime = this.now();
      next.push({ role: "assistant", text: reply, sequence: next.length + 1, eventId: requestId + ":reply", roomId: key, speakerId: "self", speakerLabel: "본인 역할 · 합성 응답", sentAtMs: Number.isFinite(replyTime) ? Math.max(now, replyTime) : now, groupId: target.groupId });
      this.sessions.set(key, next); this.contexts.set(key, selection);
    })().finally(() => { this.inFlight.delete(key); });
    ledger.set(requestId, { fingerprint, epoch, promise: operation });
    await operation; return this.session(identity, roomId);
  }
  reset(identity: Identity, roomValue: unknown = "main"): SessionView {
    if (identity === "owner") throw new ServiceError(403, "관리자에게는 대화 세션이 없습니다.");
    const roomId = this.room(roomValue), key = this.key(identity, roomId);
    if (this.inFlight.has(key)) throw new ServiceError(409, "응답 처리 중에는 방을 초기화할 수 없습니다.", "request_in_flight");
    this.roomEpochs.set(key, (this.roomEpochs.get(key) ?? 0) + 1); this.sessions.delete(key); this.contexts.delete(key);
    return this.session(identity, roomId);
  }
}
