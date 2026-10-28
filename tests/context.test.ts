import test from "node:test";
import assert from "node:assert/strict";
import { selectContext, boundedPrompt, CONTEXT_POLICY } from "../src/context.js";
import { ChatService, ServiceError, type ReplyInput } from "../src/service.js";
import type { ConversationMessage, ProviderInfo } from "../src/domain.js";
import { OpenAiResponder } from "../src/openai-responder.js";
import { SYNTHETIC_MESSAGES, SYNTHETIC_RELATIONS } from "../src/synthetic.js";

const now = Date.UTC(2026, 0, 5, 12);
const info: ProviderInfo = { mode: "mock", ready: true, model: null, notice: "Fictional context test", remainingRequests: null };
const code = (value: string) => (error: unknown) => error instanceof ServiceError && error.code === value;
function message(sequence: number, options: Partial<ConversationMessage> = {}): ConversationMessage {
  return { sequence, role: "user", text: "Fictional event " + sequence, eventId: "fictional-event-" + sequence, roomId: "friend-a/main", speakerId: "friend-a", speakerLabel: "Fictional A", sentAtMs: now - (10 - sequence) * 1000, groupId: "fictional-group-" + sequence, ...options };
}

test("context preserves source order and excludes every event after the target snapshot", () => {
  const history = [message(1), message(2), message(3, { text: "Fictional future answer", role: "assistant", speakerId: "self" })];
  const selected = selectContext(history, "friend-a/main", 2, now);
  assert.deepEqual(selected.messages.map(m => m.sequence), [1, 2]);
  assert.equal(selected.report.dropped.afterTarget, 1);
  assert.equal(JSON.stringify(selected).includes("future answer"), false);
  assert.equal(selected.report.requiresReview, true);
  selected.messages[0]!.text = "Changed copy"; assert.equal(history[0]!.text, "Fictional event 1");
});

test("room, event uniqueness, chronological order and future targets fail closed", () => {
  for (const history of [
    [message(1), message(2, { roomId: "friend-b/main" })],
    [message(1), message(2, { eventId: "fictional-event-1" })],
    [message(2), message(1)],
    [message(1), message(2, { sentAtMs: now - 60_000 })]
  ]) assert.throws(() => selectContext(history, "friend-a/main", 2, now), code("context_order"));
  assert.throws(() => selectContext([message(1, { sentAtMs: now + 1 })], "friend-a/main", 1, now), code("context_target"));
});

test("time, UTC date and long silence boundaries are visible and never imply enough context", () => {
  const history = [message(1, { sentAtMs: now - 601_000 }), message(2, { sentAtMs: now - 200_000 }), message(3, { sentAtMs: now })];
  const result = selectContext(history, "friend-a/main", 3, now);
  assert.deepEqual(result.messages.map(m => m.sequence), [3]);
  assert.equal(result.report.dropped.time, 1); assert.equal(result.report.dropped.gap, 1); assert.equal(result.report.longGap, true);
  const midnight = Date.UTC(2026, 0, 6, 0, 1);
  const dates = selectContext([message(1, { sentAtMs: midnight - 120_000 }), message(2, { sentAtMs: midnight })], "friend-a/main", 2, midnight);
  assert.equal(dates.report.dateBoundary, true); assert.equal(dates.report.dropped.time, 1);
});

test("message and UTF-8 byte budgets remove complete older groups rather than dangling replies", () => {
  const history = [message(1, { text: "가".repeat(180), groupId: "pair" }), message(2, { role: "assistant", speakerId: "self", groupId: "pair" }), message(3)];
  const counted = selectContext(history, "friend-a/main", 3, now, { ...CONTEXT_POLICY, maxMessages: 2 });
  assert.deepEqual(counted.messages.map(m => m.sequence), [3]); assert.equal(counted.report.dropped.count, 2);
  const oneSize = Buffer.byteLength(JSON.stringify([history[2]]));
  const bytes = selectContext(history, "friend-a/main", 3, now, { ...CONTEXT_POLICY, maxBytes: oneSize + 10 });
  assert.deepEqual(bytes.messages.map(m => m.sequence), [3]); assert.equal(bytes.report.dropped.bytes, 2);
  assert.throws(() => selectContext(history, "friend-a/main", 3, now, { ...CONTEXT_POLICY, maxBytes: oneSize - 1 }), code("context_review_needed"));
});

test("partial groups at a time boundary are omitted and a split latest group needs review", () => {
  const history = [message(1, { groupId: "old", sentAtMs: now - 601_000 }), message(2, { groupId: "old", sentAtMs: now - 599_000 }), message(3, { sentAtMs: now })];
  const result = selectContext(history, "friend-a/main", 3, now, { ...CONTEXT_POLICY, gapMs: 600_000 });
  assert.deepEqual(result.messages.map(m => m.sequence), [3]); assert.equal(result.report.requiresReview, true);
  assert.throws(() => selectContext([history[0]!, message(2, { groupId: "old", sentAtMs: now })], "friend-a/main", 2, now), code("context_review_needed"));
});

test("multi-speaker mock input preserves unique actors, current target and room/account isolation", async () => {
  const inputs: ReplyInput[] = [];
  const service = new ChatService({ info, respond(input) { inputs.push(structuredClone(input)); return "Fictional mock reply"; } }, { now: () => now });
  await service.chat("friend-a", "Fictional main message", "main-0001");
  const events = [{ speakerId: "group-peer", text: "Fictional peer topic", ageSeconds: 30 }, { speakerId: "friend-a", text: "Fictional A context", ageSeconds: 10 }, { speakerId: "friend-a", text: "Fictional A latest", ageSeconds: 0 }];
  const view = await service.chatBatch("friend-a", "group", events, "group-0001");
  const last = inputs.at(-1)!;
  assert.deepEqual(last.sessionMessages.map(m => m.text), events.map(m => m.text));
  assert.deepEqual(view.context?.messages.map(m => m.speakerId), ["group-peer", "friend-a", "friend-a"]);
  assert.equal(last.conversation?.targetSpeakerId, "friend-a"); assert.equal(last.conversation?.report.multipleSpeakers, true);
  assert.equal(last.sessionMessages.some(m => m.role === "assistant"), false);
  assert.equal(last.relationshipDescription, SYNTHETIC_RELATIONS["friend-a"]);
  assert.equal(service.session("friend-a", "main").messages.length, 2);
  assert.equal(service.session("friend-b", "group").messages.length, 0);
  await service.chatBatch("friend-a", "group", events, "group-0001"); assert.equal(inputs.length, 2);
  await assert.rejects(service.chatBatch("friend-a", "group", [{ speakerId: "group-peer", text: "Fictional unapproved target", ageSeconds: 0 }], "group-0002"), code("unapproved_target"));
  await assert.rejects(service.chatBatch("friend-a", "group", [{ speakerId: "friend-b", text: "Fictional injected actor", ageSeconds: 0 }], "group-0003"), code("invalid_speaker"));
  await assert.rejects(service.chatBatch("friend-a", "group", [{ speakerId: "friend-a", text: "Fictional future", ageSeconds: -1 }], "group-0004"), code("invalid_time"));
});

test("oversized latest group makes zero responder calls and stores neither input nor preview", async () => {
  let calls = 0;
  const service = new ChatService({ info, respond() { calls++; return "Fictional reply"; } }, { now: () => now });
  const events = [{ speakerId: "friend-a", text: "가".repeat(2000), ageSeconds: 0 }, { speakerId: "friend-a", text: "나".repeat(2000), ageSeconds: 0 }];
  await assert.rejects(service.chatBatch("friend-a", "group", events, "oversize-01"), code("context_review_needed"));
  assert.equal(calls, 0); assert.deepEqual(service.session("friend-a", "group").messages, []); assert.equal(service.session("friend-a", "group").context, null);
});

test("same-room in-flight exclusion and independent rooms survive reset and relationship revocation", async () => {
  const finishes = new Map<string, (text: string) => void>(); let calls = 0;
  const service = new ChatService({ info, respond(input) { calls++; return new Promise<string>(resolve => finishes.set(input.conversation!.roomId, resolve)); } });
  const main = service.chat("friend-a", "Fictional main", "shared-0001", "main");
  const duplicate = service.chat("friend-a", "Fictional main", "shared-0001", "main");
  const side = service.chat("friend-a", "Fictional side", "shared-0001", "side");
  assert.equal(calls, 2);
  await assert.rejects(service.chat("friend-a", "Fictional unseen later input", "shared-0002", "main"), code("request_in_flight"));
  finishes.get("friend-a/side")!("Fictional side reply"); await side; service.reset("friend-a", "side");
  assert.equal(service.session("friend-a", "main").inFlight, true); assert.equal(service.session("friend-a", "side").messages.length, 0);
  service.updateRelationship("owner", "friend-a", "Fictional changed relationship", false);
  finishes.get("friend-a/main")!("Fictional stale reply");
  await assert.rejects(main, code("state_changed")); await assert.rejects(duplicate, code("state_changed"));
  assert.equal(service.session("friend-a", "main").context, null); assert.equal(service.session("friend-a", "side").context, null);
});

test("mock batch and additional rooms never expand the external-provider input surface", async () => {
  let calls = 0;
  const service = new ChatService({ info: { ...info, mode: "openai-synthetic" }, respond() { calls++; return "Fictional reply"; } });
  await assert.rejects(service.chatBatch("friend-a", "group", [], "batch-0001"), code("mock_only"));
  await assert.rejects(service.chat("friend-a", "Fictional side", "side-0001", "side"), code("mock_only"));
  assert.equal(calls, 0);
});

test("whole prompt budget stops transport and the API adapter no longer silently slices at twelve", async () => {
  assert.throws(() => boundedPrompt("가".repeat(9000)), code("context_review_needed"));
  let calls = 0, received = 0;
  const provider = new OpenAiResponder({ apiKey: "SYNTHETIC_TEST_TOKEN", fetcher: async (_url, options) => { calls++; received = (JSON.parse(String(options?.body)) as { input: unknown[] }).input.length; return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Fictional reply" }] }] }), { status: 200 }); } });
  const sessionMessages = Array.from({ length: 15 }, (_, i) => ({ role: "user" as const, sequence: i + 1, text: SYNTHETIC_MESSAGES[0]! }));
  await provider.respond({ relationshipDescription: SYNTHETIC_RELATIONS["friend-a"], sessionMessages });
  assert.equal(received, 15);
  await assert.rejects(provider.respond({ relationshipDescription: SYNTHETIC_RELATIONS["friend-a"], sessionMessages: [...sessionMessages, { role: "assistant", sequence: 16, text: "가".repeat(9000) }] }), code("context_review_needed"));
  assert.equal(calls, 1);
});
