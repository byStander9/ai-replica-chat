import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createDemoServer, assertDemoMode } from "../src/server.js";
import { ChatService, type SessionView } from "../src/service.js";
import { OpenAiResponder } from "../src/openai-responder.js";
test("production and missing demo opt-in remain blocked", () => {
  assert.throws(() => assertDemoMode([], undefined));
  assert.throws(() => assertDemoMode(["--demo"], "production"));
  assert.throws(() => assertDemoMode(["--demo"], "staging"));
  assert.doesNotThrow(() => assertDemoMode(["--demo"], "development"));
});
async function withServer(service: ChatService, run: (origin: string) => Promise<void>) {
  const server = createDemoServer(service); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try { await run("http://127.0.0.1:" + address.port); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
test("HTTP authorization, isolation, request IDs, Origin and static allowlist", async () => {
  await withServer(new ChatService(), async origin => {
    const post = (path: string, identity: string, value: unknown, extra: Record<string,string> = {}) => fetch(origin + path, { method: "POST", headers: { "X-Demo-Identity": identity, "Content-Type": "application/json", ...extra }, body: JSON.stringify(value) });
    assert.equal((await post("/api/chat", "visitor", { message: "합성 인사", requestId: "request01" })).status, 403);
    assert.equal((await post("/api/admin/relationships", "friend-a", { accountId: "friend-b", description: "합성 변경", approved: true })).status, 403);
    assert.equal((await post("/api/chat", "friend-a", { message: "합성 인사", requestId: "request01", accountId: "friend-b" })).status, 400);
    assert.equal((await post("/api/chat", "friend-a", { message: "합성 인사", requestId: "request01" }, { Origin: "https://example.invalid" })).status, 403);
    const badHost = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(origin + "/api/session", { headers: { Host: "example.invalid" } }, response => { response.resume(); resolve(response.statusCode ?? 0); });
      request.on("error", reject); request.end();
    });
    assert.equal(badHost, 403);
    assert.equal((await fetch(origin + "/api/session", { headers: { "X-Demo-Identity": "unknown" } })).status, 400);
    assert.equal((await fetch(origin + "/api/admin/relationships", { headers: { "X-Demo-Identity": "friend-a" } })).status, 403);
    assert.equal((await post("/api/admin/relationships", "owner", { accountId: "visitor", description: "자유로운 합성 관계 문장입니다.", approved: true })).status, 200);
    const first = await post("/api/chat", "visitor", { message: "<script>synthetic-only</script>", requestId: "request01" });
    assert.equal(first.status, 200); const view = await first.json() as SessionView;
    assert.equal(view.messages.length, 2); assert.match(view.messages[1]?.text ?? "", /MOCK/);
    const replay = await post("/api/chat", "visitor", { message: "<script>synthetic-only</script>", requestId: "request01" });
    assert.equal((await replay.json() as SessionView).messages.length, 2);
    assert.deepEqual((await (await fetch(origin + "/api/session", { headers: { "X-Demo-Identity": "friend-b" } })).json() as SessionView).messages, []);
    assert.equal((await fetch(origin + "/", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 200);
    assert.equal((await fetch(origin + "/api/session", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await fetch(origin + "/.env.local")).status, 404);
    assert.equal((await fetch(origin + "/src/config.ts")).status, 404);
    const page = await fetch(origin + "/"); assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(await page.text(), /MOCK/);
    assert.equal((await fetch(origin + "/app.js")).status, 200);
    assert.equal((await post("/api/chat", "friend-a", { message: "x".repeat(17000), requestId: "request01" })).status, 413);
    assert.equal((await fetch(origin + "/api/chat", { method: "POST", body: "plain" })).status, 415);
  });
});
test("missing-key AI mode is explicit and cannot send or silently fall back to mock", async () => {
  let outbound = 0;
  const service = new ChatService(new OpenAiResponder({ fetcher: async () => { outbound++; throw new Error("unexpected"); } }));
  await withServer(service, async origin => {
    const response = await fetch(origin + "/api/session", { headers: { "X-Demo-Identity": "friend-a" } });
    const view = await response.json() as SessionView;
    assert.equal(view.mode, "openai-synthetic"); assert.equal(view.provider.ready, false); assert.match(view.provider.notice, /키 파일/);
    const failed = await fetch(origin + "/api/chat", { method: "POST", headers: { "X-Demo-Identity": "friend-a", "Content-Type": "application/json" }, body: JSON.stringify({ message: view.allowedMessages[0], requestId: "request01" }) });
    assert.equal(failed.status, 503);
    assert.equal((await failed.json() as {code:string}).code, "api_key_unconfigured");
    assert.deepEqual(service.session("friend-a").messages, []); assert.equal(outbound, 0);
  });
});
