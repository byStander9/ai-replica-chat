import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createDemoServer, assertDemoMode } from "../src/server.js";
import type { SessionView } from "../src/service.js";

test("production and missing demo opt-in are blocked", () => {
  assert.throws(() => assertDemoMode([], undefined));
  assert.throws(() => assertDemoMode(["--demo"], "production"));
  assert.throws(() => assertDemoMode(["--demo"], "staging"));
  assert.doesNotThrow(() => assertDemoMode(["--demo"], "development"));
});
test("HTTP boundaries, isolation, owner-only writes, and static allowlist", async () => {
  const server = createDemoServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = "http://127.0.0.1:" + address.port;
  const post = (path: string, identity: string, value: unknown, extra: Record<string,string> = {}) => fetch(origin + path, { method: "POST", headers: { "X-Demo-Identity": identity, "Content-Type": "application/json", ...extra }, body: JSON.stringify(value) });
  try {
    assert.equal((await post("/api/chat", "visitor", { message: "합성 인사" })).status, 403);
    assert.equal((await post("/api/admin/relationships", "friend-a", { accountId: "friend-b", description: "권한 변경 시도", approved: true })).status, 403);
    assert.equal((await post("/api/chat", "friend-a", { message: "합성 인사", accountId: "friend-b" })).status, 400);
    assert.equal((await post("/api/chat", "friend-a", { message: "합성 인사" }, { Origin: "https://example.invalid" })).status, 403);
    const badHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(origin + "/api/session", { headers: { Host: "example.invalid" } }, response => {
        response.resume(); resolve(response.statusCode ?? 0);
      });
      request.on("error", reject); request.end();
    });
    assert.equal(badHostStatus, 403);
    assert.equal((await fetch(origin + "/api/session", { headers: { "X-Demo-Identity": "not-an-account" } })).status, 400);
    assert.equal((await fetch(origin + "/api/admin/relationships", { headers: { "X-Demo-Identity": "friend-a" } })).status, 403);
    const saved = await post("/api/admin/relationships", "owner", { accountId: "visitor", description: "고정 모드 없는 합성 관계. 짧게 질문을 주고받습니다.", approved: true });
    assert.equal(saved.status, 200);
    const first = await post("/api/chat", "visitor", { message: "<script>synthetic-only</script>" });
    assert.equal(first.status, 200);
    const view = await first.json() as SessionView;
    assert.equal(view.messages.length, 2);
    assert.match(view.messages[1]?.text ?? "", /MOCK/);
    const isolated = await fetch(origin + "/api/session", { headers: { "X-Demo-Identity": "friend-b" } });
    assert.deepEqual((await isolated.json() as SessionView).messages, []);
    assert.equal((await fetch(origin + "/", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 200);
    assert.equal((await fetch(origin + "/api/session", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await fetch(origin + "/.env")).status, 404);
    assert.equal((await fetch(origin + "/src/service.ts")).status, 404);
    const page = await fetch(origin + "/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(await page.text(), /MOCK/);
    assert.equal((await fetch(origin + "/app.js")).status, 200);
    assert.equal((await post("/api/chat", "friend-a", { message: "x".repeat(17000) })).status, 413);
    assert.equal((await fetch(origin + "/api/chat", { method: "POST", body: "plain" })).status, 415);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
