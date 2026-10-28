import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { OpenAiResponder, OPENAI_RESPONSES_ENDPOINT } from "../src/openai-responder.js";
import { ChatService, ServiceError, type ReplyInput } from "../src/service.js";
import { SYNTHETIC_MESSAGES, SYNTHETIC_RELATIONS } from "../src/synthetic.js";
const fakeKey = "SYNTHETIC_TEST_TOKEN";
function input(text = SYNTHETIC_MESSAGES[0] ?? ""): ReplyInput { return { relationshipDescription: SYNTHETIC_RELATIONS["friend-a"], sessionMessages: [{ role: "user", text, sequence: 1 }] }; }
function completed(text = "가상의 퍼즐 완성을 축하해요."): Response { return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] }); }
function code(expected: string) { return (error: unknown) => error instanceof ServiceError && error.code === expected; }
test("real HTTP mock verifies request shape with no call to OpenAI", async () => {
  let calls = 0; let captured: Record<string,unknown> | undefined;
  const upstream = createServer(async (request,response) => {
    calls++; assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer " + fakeKey);
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    captured = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string,unknown>;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "합성 HTTP 목 응답입니다." }] }] }));
  });
  upstream.listen(0,"127.0.0.1"); await once(upstream,"listening");
  const address=upstream.address(); assert.ok(address && typeof address!=="string");
  const responder = new OpenAiResponder({ apiKey: fakeKey, fetcher: async (url,options) => { assert.equal(url,OPENAI_RESPONSES_ENDPOINT); return fetch("http://127.0.0.1:"+address.port,options); } });
  try {
    assert.match(await responder.respond(input()), /^\[AI · 합성 테스트\]/);
    assert.equal(calls,1); assert.ok(captured);
    assert.equal(captured.store,false); assert.equal(captured.max_output_tokens,256);
    assert.deepEqual(captured.reasoning,{effort:"none"}); assert.equal("tools" in captured,false);
    assert.deepEqual(captured.input,[{role:"user",content:SYNTHETIC_MESSAGES[0]}]);
    assert.equal(JSON.stringify(responder.info).includes(fakeKey),false);
    assert.equal(JSON.stringify(responder).includes(fakeKey),false);
  } finally { upstream.closeAllConnections(); await new Promise<void>(resolve=>upstream.close(()=>resolve())); }
});
test("non-fixture user text and edited relationship never reach transport", async () => {
  let calls=0;
  const responder=new OpenAiResponder({apiKey:fakeKey,fetcher:async()=>{calls++;return completed();}});
  await assert.rejects(responder.respond(input("합성이라고 주장하지만 허용되지 않은 임의 입력")),code("synthetic_only"));
  await assert.rejects(responder.respond({...input(),relationshipDescription:"수정한 자유문장 합성 관계"}),code("synthetic_only"));
  assert.equal(calls,0);
});
for (const status of [401,403,429]) test("provider "+status+" is sanitized, blocks later requests and never retries",async()=>{
  let calls=0;
  const responder=new OpenAiResponder({apiKey:fakeKey,fetcher:async()=>{calls++;return Response.json({error:{message:fakeKey}}, {status});}});
  await assert.rejects(responder.respond(input()),error=>error instanceof ServiceError && !error.message.includes(fakeKey) && error.status===503);
  await assert.rejects(responder.respond(input()),code("api_calls_stopped"));
  assert.equal(calls,1); assert.equal(responder.info.ready,false);
});
test("upstream failure is not retried and response body is never surfaced",async()=>{
  let calls=0;
  const responder=new OpenAiResponder({apiKey:fakeKey,fetcher:async()=>{calls++;return Response.json({error:{message:fakeKey}},{status:500});}});
  const service=new ChatService(responder);
  const text=SYNTHETIC_MESSAGES[0]??"";
  await assert.rejects(service.chat("friend-a",text,"failure01"),code("api_upstream"));
  await assert.rejects(service.chat("friend-a",text,"failure01"),code("api_upstream"));
  assert.equal(calls,1); assert.deepEqual(service.session("friend-a").messages,[]);
});
test("timeout aborts once, rolls back and blocks new paid attempts",async()=>{
  let calls=0;
  const responder=new OpenAiResponder({apiKey:fakeKey,timeoutMs:10,fetcher:async(_url,options)=>{calls++;return new Promise<Response>((_resolve,reject)=>{options?.signal?.addEventListener("abort",()=>reject(new DOMException("synthetic abort","AbortError")));});}});
  const service=new ChatService(responder);
  await assert.rejects(service.chat("friend-a",SYNTHETIC_MESSAGES[0],"timeout01"),code("api_timeout"));
  await assert.rejects(service.chat("friend-a",SYNTHETIC_MESSAGES[1],"timeout02"),code("api_calls_stopped"));
  assert.equal(calls,1); assert.deepEqual(service.session("friend-a").messages,[]); assert.equal(service.session("friend-a").inFlight,false);
});
test("empty, incomplete, refusal-only and malformed responses never become assistant messages",async()=>{
  for(const payload of [
    {status:"incomplete",output:[]},
    {status:"completed",output:[]},
    {status:"completed",output:[{type:"message",role:"assistant",content:[{type:"refusal",refusal:"synthetic"}]}]}
  ]){
    const responder=new OpenAiResponder({apiKey:fakeKey,fetcher:async()=>Response.json(payload)});
    const service=new ChatService(responder);
    await assert.rejects(service.chat("friend-a",SYNTHETIC_MESSAGES[0],"invalid01"),code("api_invalid_response"));
    assert.deepEqual(service.session("friend-a").messages,[]);
  }
  const responder=new OpenAiResponder({apiKey:fakeKey,fetcher:async()=>new Response("invalid-json")});
  await assert.rejects(responder.respond(input()),code("api_transport"));
});
test("server-wide paid-attempt budget is enforced",async()=>{
  let calls=0;
  const responder=new OpenAiResponder({apiKey:fakeKey,maxRequests:2,fetcher:async()=>{calls++;return completed();}});
  await responder.respond(input()); await responder.respond(input());
  await assert.rejects(responder.respond(input()),code("api_calls_stopped"));
  assert.equal(calls,2); assert.equal(responder.info.remainingRequests,0);
});

for(const [upstreamCode,safeCode] of [["insufficient_quota","api_insufficient_quota"],["rate_limit_exceeded","api_rate_limit"]])test("429 code is whitelisted: "+upstreamCode,async()=>{
  let calls=0;
  const responder=new OpenAiResponder({apiKey:fakeKey,fetcher:async()=>{calls++;return Response.json({error:{code:upstreamCode,message:fakeKey}},{status:429});}});
  await assert.rejects(responder.respond(input()),code(safeCode??""));
  assert.equal(calls,1);assert.equal(responder.info.ready,false);
});
