import { ServiceError, type ContextReport, type ConversationMessage, type ReplyInput } from "./domain.js";

export const CONTEXT_POLICY = Object.freeze({ windowMs: 10 * 60_000, gapMs: 2 * 60_000, maxMessages: 40, maxBytes: 12_288 });
export const MAX_PROMPT_BYTES = 24_576;
export interface ContextPolicy { windowMs: number; gapMs: number; maxMessages: number; maxBytes: number }
export interface ContextSelection { messages: ConversationMessage[]; report: ContextReport }

// UTF-8 bytes are a conservative size budget, not a model token count or a sufficiency claim.
export function selectContext(history: readonly ConversationMessage[], roomId: string, targetSequence: number, nowMs: number, policy: ContextPolicy = CONTEXT_POLICY): ContextSelection {
  if (!Number.isSafeInteger(nowMs) || Number.isNaN(new Date(nowMs).getTime()) || Object.values(policy).some(n => !Number.isSafeInteger(n) || n <= 0)) throw new ServiceError(400, "문맥 예산 설정이 유효하지 않습니다.", "context_policy");
  const ids = new Set<string>(); const groups = new Set<string>();
  let sequence = 0, time = -Infinity, lastGroup = "";
  for (const message of history) {
    if (message.roomId !== roomId || !message.eventId || ids.has(message.eventId) || !Number.isSafeInteger(message.sequence) || message.sequence <= sequence || !Number.isSafeInteger(message.sentAtMs) || Number.isNaN(new Date(message.sentAtMs).getTime()) || message.sentAtMs < time || !message.speakerId || !message.groupId)
      throw new ServiceError(400, "방·화자·이벤트 순서를 확인할 수 없습니다.", "context_order");
    if (lastGroup !== message.groupId && groups.has(message.groupId)) throw new ServiceError(400, "문맥 묶음 순서가 유효하지 않습니다.", "context_order");
    ids.add(message.eventId); groups.add(message.groupId); lastGroup = message.groupId; sequence = message.sequence; time = message.sentAtMs;
  }
  const target = history.find(m => m.sequence === targetSequence);
  if (!target || target.role !== "user" || target.sentAtMs > nowMs) throw new ServiceError(400, "최신 입력의 문맥 경계를 확인할 수 없습니다.", "context_target");
  const before = history.filter(m => m.sequence <= targetSequence);
  const day = new Date(target.sentAtMs).toISOString().slice(0, 10);
  const inWindow = before.filter(m => target.sentAtMs - m.sentAtMs <= policy.windowMs && new Date(m.sentAtMs).toISOString().slice(0, 10) === day);
  const dateBoundary = before.some(m => new Date(m.sentAtMs).toISOString().slice(0, 10) !== day);
  let start = 0;
  for (let i = 1; i < inWindow.length; i++) if (inWindow[i]!.sentAtMs - inWindow[i - 1]!.sentAtMs >= policy.gapMs) start = i;
  // Do not keep a partial stored group at a time/gap boundary. The latest group must fit as a whole.
  let candidates = inWindow.slice(start);
  while (candidates.length && before.some(m => m.groupId === candidates[0]!.groupId && m.sequence < candidates[0]!.sequence)) {
    if (candidates[0]!.groupId === target.groupId) throw new ServiceError(413, "최신 묶음이 문맥 경계를 넘습니다. 묶음을 나눠 검토해 주세요.", "context_review_needed");
    const partial = candidates[0]!.groupId; candidates = candidates.filter(m => m.groupId !== partial);
  }
  const batches: ConversationMessage[][] = [];
  for (const message of candidates) {
    const last = batches.at(-1);
    if (last?.[0]?.groupId === message.groupId) last.push(message); else batches.push([message]);
  }
  let selected: ConversationMessage[] = [], countDropped = 0, bytesDropped = 0;
  for (let i = batches.length - 1; i >= 0; i--) {
    const next = [...batches[i]!, ...selected];
    const tooMany = next.length > policy.maxMessages, tooLarge = Buffer.byteLength(JSON.stringify(next), "utf8") > policy.maxBytes;
    if (tooMany || tooLarge) {
      if (!selected.length) throw new ServiceError(413, "최신 묶음이 문맥 예산보다 큽니다. 내용을 줄이거나 나눠 검토해 주세요.", "context_review_needed");
      const omitted = batches.slice(0, i + 1).reduce((sum, batch) => sum + batch.length, 0);
      if (tooMany) countDropped = omitted; else bytesDropped = omitted;
      break;
    }
    selected = next;
  }
  if (selected.at(-1)?.sequence !== targetSequence) throw new ServiceError(400, "최신 입력이 문맥에 포함되지 않았습니다.", "context_target");
  const dropped = { time: before.length - inWindow.length, gap: inWindow.length - candidates.length, count: countDropped, bytes: bytesDropped, afterTarget: history.length - before.length };
  const multipleSpeakers = new Set(selected.filter(m => m.role === "user").map(m => m.speakerId)).size > 1;
  return { messages: structuredClone(selected), report: { roomId, targetSequence, selectedMessages: selected.length, selectedGroups: new Set(selected.map(m => m.groupId)).size, serializedBytes: Buffer.byteLength(JSON.stringify(selected), "utf8"), maxBytes: policy.maxBytes, maxMessages: policy.maxMessages, windowMs: policy.windowMs, dropped, dateBoundary, longGap: start > 0, multipleSpeakers, requiresReview: multipleSpeakers || Object.values(dropped).some(n => n > 0) } };
}

export function boundedPrompt(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PROMPT_BYTES) throw new ServiceError(413, "관계·지침·문맥의 전체 입력 예산을 초과했습니다. 문맥을 검토해 주세요.", "context_review_needed");
  return serialized;
}

export function promptMessages(input: ReplyInput) {
  const target = input.sessionMessages.at(-1) as Partial<ConversationMessage> | undefined;
  const groups = new Map<string, number>();
  return input.sessionMessages.map(message => {
    const event = message as Partial<ConversationMessage>;
    if (event.groupId && !groups.has(event.groupId)) groups.set(event.groupId, groups.size + 1);
    return { role: message.role, text: message.text, sequence: message.sequence,
      speakerId: event.speakerId ?? (message.role === "assistant" ? "self" : "counterpart"),
      speakerLabel: event.speakerLabel,
      secondsBeforeTarget: target?.sentAtMs !== undefined && event.sentAtMs !== undefined ? Math.max(0, (target.sentAtMs - event.sentAtMs) / 1000) : undefined,
      group: event.groupId ? groups.get(event.groupId) : undefined };
  });
}
