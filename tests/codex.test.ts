import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, lstatSync } from "node:fs";
import { CodexResponder, CLI_CONFIG, CLI_VERSION, DISABLED_FEATURES, cliEnvironment, classifyCliFailure, runCli, type CliRunner, type RunSpec } from "../src/codex-responder.js";
import { ChatService, ServiceError, type ReplyInput } from "../src/service.js";
import { SYNTHETIC_MESSAGES, SYNTHETIC_RELATIONS } from "../src/synthetic.js";
const executable="SYNTHETIC_CLI";
const input:ReplyInput={relationshipDescription:SYNTHETIC_RELATIONS["friend-a"],sessionMessages:[{role:"user",text:SYNTHETIC_MESSAGES[0]??"",sequence:1}]};
const ok=(stdout:string)=>({exitCode:0,stdout,stderr:""});
const completed=()=>[JSON.stringify({type:"thread.started"}),JSON.stringify({type:"turn.started"}),JSON.stringify({type:"item.completed",item:{type:"agent_message",text:JSON.stringify({reply:"가상의 퍼즐 완성을 축하해!"})}}),JSON.stringify({type:"turn.completed"})].join("\n");
function fixture(onExec:(spec:RunSpec)=>Promise<ReturnType<typeof ok>>|ReturnType<typeof ok>=()=>ok(completed())):CliRunner{return async spec=>{
 if(spec.args.includes("--version"))return ok(CLI_VERSION);
 if(spec.args.includes("features"))return ok(DISABLED_FEATURES.map(name=>name+" stable false").join("\n"));
 if(spec.args.includes("login"))return ok("Logged in using ChatGPT");
 return onExec(spec);
};}
const code=(expected:string)=>(error:unknown)=>error instanceof ServiceError&&error.code===expected;
test("CLI uses stdin, isolated temp cwd, fixed args, no API credentials and plain response text",async()=>{
 let calls=0;let cwd="";
 const provider=new CodexResponder({executable,runner:fixture(spec=>{
   calls++;cwd=spec.cwd;assert.equal(lstatSync(cwd).isDirectory(),true);
   assert.equal(spec.args.includes(input.sessionMessages[0]?.text??""),false);
   assert.ok(spec.stdin.includes(SYNTHETIC_MESSAGES[0]??""));
   for(const flag of ["--no-daemon","--ignore-user-config","--ignore-rules","--ephemeral","--strict-config","--output-schema","--sandbox","read-only","--json","-"])assert.ok(spec.args.includes(flag));
   for(const setting of CLI_CONFIG)assert.ok(spec.args.includes(setting));
   assert.equal(spec.env.OPENAI_API_KEY,undefined);assert.equal(spec.env.CODEX_API_KEY,undefined);
   assert.equal(readFileSync(spec.args[spec.args.indexOf("--output-schema")+1]??"","utf8").includes('"reply"'),true);
   return ok(completed());
 })});
 const service=new ChatService(provider);
 const first=await service.chat("friend-a",SYNTHETIC_MESSAGES[0],"cli-test-0001");
 assert.equal(first.mode,"codex-synthetic");assert.equal(first.messages[1]?.text,"가상의 퍼즐 완성을 축하해!");
 await service.chat("friend-a",SYNTHETIC_MESSAGES[0],"cli-test-0001");
 assert.equal(calls,1);assert.equal(existsSync(cwd),false);assert.equal(service.session("friend-b").messages.length,0);
 assert.deepEqual(service.session("friend-a").allowedMessages,SYNTHETIC_MESSAGES);
 await assert.rejects(service.chat("visitor",SYNTHETIC_MESSAGES[0],"cli-test-0002"),error=>error instanceof ServiceError&&error.status===403);
});
test("CLI environment excludes tokens, keys, endpoint/proxy overrides and inherited Codex config",()=>{
 const env=cliEnvironment({SystemRoot:"SYNTHETIC_SYSTEM",PATH:"SYNTHETIC_PATH",OPENAI_API_KEY:"SYNTHETIC_SECRET",CODEX_API_KEY:"SYNTHETIC_SECRET",CODEX_HOME:"SYNTHETIC_HOME",HTTPS_PROXY:"SYNTHETIC_PROXY",OPENAI_BASE_URL:"SYNTHETIC_URL",CODEX_ACCESS_TOKEN:"SYNTHETIC_SECRET"});
 assert.deepEqual(env,{SystemRoot:"SYNTHETIC_SYSTEM",PATH:"SYNTHETIC_PATH"});
});
test("CLI failure diagnostics expose only fixed categories and known settings",async()=>{
 const raw="unknown field `max_context_tokens` SYNTHETIC_PRIVATE_DIAGNOSTIC C:\\fictional\\private";
 assert.deepEqual(classifyCliFailure({exitCode:1,stdout:"",stderr:raw}),{exitCode:1,signal:null,category:"configuration",setting:"max_context_tokens",message:null});
 assert.equal(classifyCliFailure({exitCode:2,stdout:"",stderr:"unknown field `SYNTHETIC_SECRET`"}).setting,null);
 for(const [text,category] of [["401 Unauthorized","authentication"],["429 quota exceeded","quota"],["permission denied","permission"],["unexpected argument","arguments"],["unclassified SYNTHETIC_PRIVATE_DIAGNOSTIC","unknown"]])assert.equal(classifyCliFailure({exitCode:1,stdout:"",stderr:text??""}).category,category);
 const p=new CodexResponder({executable,runner:fixture(()=>({exitCode:1,stdout:"",stderr:raw}))});
 await assert.rejects(p.respond(input),code("cli_failed"));
 assert.equal(JSON.stringify(p.diagnostic).includes("PRIVATE"),false);
 const copy=p.diagnostic;assert.ok(copy);copy.category="changed";assert.equal(p.diagnostic?.category,"configuration");
 const structured=classifyCliFailure({exitCode:0,stderr:"configuration warning features.code_mode",stdout:JSON.stringify({type:"item.completed",item:{type:"error",message:"quota exceeded at https://fictional.invalid/private C:\\fictional\\private token=SYNTHETIC_SECRET contact fictional@example.invalid"}})});
 assert.equal(structured.category,"quota");assert.equal(structured.setting,null);
 for(const privateText of ["https:","C:\\fictional","SYNTHETIC_SECRET","fictional@example.invalid"])assert.equal(structured.message?.includes(privateText),false);
});
test("CLI structured error items fail as errors without being mistaken for tools",async()=>{
 const p=new CodexResponder({executable,runner:fixture(()=>ok(JSON.stringify({type:"item.completed",item:{type:"error",message:"quota exceeded"}})))});
 await assert.rejects(p.respond(input),code("cli_failed"));assert.equal(p.diagnostic?.category,"quota");
});
test("CLI advisory error items do not discard a completed valid answer",async()=>{
 const advisory=JSON.stringify({type:"item.completed",item:{type:"error",message:"SYNTHETIC_ADVISORY"}});
 const p=new CodexResponder({executable,runner:fixture(()=>ok(advisory+"\n"+completed()))});
 assert.equal(await p.respond(input),"가상의 퍼즐 완성을 축하해!");assert.equal(p.diagnostic,null);
});
test("CLI rejects non-fixture messages and arbitrary relationships before any process",async()=>{
 let calls=0;const p=new CodexResponder({executable,runner:async()=>{calls++;return ok("");}});
 await assert.rejects(p.respond({...input,relationshipDescription:"임의 합성 관계"}),code("synthetic_only"));
 await assert.rejects(p.respond({...input,sessionMessages:[{role:"user",text:"임의 합성 입력",sequence:1}]}),code("synthetic_only"));assert.equal(calls,0);
});
test("CLI missing configuration, version mismatch, tool policy mismatch and non-ChatGPT auth fail closed",async()=>{
 await assert.rejects(new CodexResponder().respond(input),code("cli_calls_stopped"));
 assert.equal(new CodexResponder().info.ready,false);
 for(const failStep of ["--version","features","login"]){
  let modelCalls=0;const normal=fixture(()=>{modelCalls++;return ok(completed());});
  const p=new CodexResponder({executable,runner:spec=>spec.args.includes(failStep)?Promise.resolve(ok("unsupported")):normal(spec)});
  await assert.rejects(p.respond(input),error=>error instanceof ServiceError);
  assert.equal(p.info.ready,false);assert.equal(modelCalls,0);
 }
});
test("CLI global concurrency and 2-call budget are enforced",async()=>{
 const holder:{finish?: (value:ReturnType<typeof ok>)=>void}={};let calls=0;
 const p=new CodexResponder({executable,runner:fixture(()=>{calls++;return new Promise(resolve=>{holder.finish=resolve;});})});
 const finishPending=()=>{assert.ok(holder.finish);holder.finish(ok(completed()));};
 const first=p.respond(input);while(!holder.finish)await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(p.respond(input),code("cli_busy"));finishPending();await first;
 const second=p.respond(input);delete holder.finish;while(!holder.finish)await new Promise(resolve=>setImmediate(resolve));finishPending();await second;
 await assert.rejects(p.respond(input),code("cli_calls_stopped"));assert.equal(calls,2);
});
for(const kind of ["failure","tool","incomplete","malformed","timeout"])test("CLI "+kind+" blocks further attempts, exposes no raw errors and leaves no history",async()=>{
 let calls=0;
 const p=new CodexResponder({executable,runner:fixture(()=>{calls++;
   if(kind==="timeout")throw new ServiceError(503,"SYNTHETIC_TIMEOUT","cli_timeout");
   if(kind==="failure")return {exitCode:1,stdout:"SYNTHETIC_PRIVATE_ERROR",stderr:"SYNTHETIC_PRIVATE_ERROR"};
   if(kind==="tool")return ok(JSON.stringify({type:"item.started",item:{type:"command_execution"}}));
   if(kind==="incomplete")return ok(JSON.stringify({type:"turn.started"}));
   return ok("not-json");
 })});
 const service=new ChatService(p);
 await assert.rejects(service.chat("friend-a",SYNTHETIC_MESSAGES[0],"cli-fail-0001"),error=>error instanceof ServiceError&&!error.message.includes("PRIVATE"));
 await assert.rejects(service.chat("friend-a",SYNTHETIC_MESSAGES[0],"cli-fail-0001"));
 await assert.rejects(p.respond(input),code("cli_calls_stopped"));
 assert.equal(calls,1);assert.equal(p.info.ready,false);assert.equal(service.session("friend-a").messages.length,0);
});
test("real child transport has no shell, bounded output, timeout and unexpected-tool termination",async()=>{
 const base={executable:process.execPath,cwd:process.cwd(),env:cliEnvironment(),stdin:"",timeoutMs:1000,events:false};
 assert.equal((await runCli({...base,args:["-e","process.stdout.write('synthetic')"]})).stdout,"synthetic");
 await assert.rejects(runCli({...base,args:["-e","setTimeout(()=>{},5000)"],timeoutMs:30}),code("cli_timeout"));
 await assert.rejects(runCli({...base,args:["-e","process.stdout.write('x'.repeat(70000))"]}),code("cli_output_limit"));
 await assert.rejects(runCli({...base,args:["-e","console.log(JSON.stringify({type:'item.started',item:{type:'command_execution'}}));setTimeout(()=>{},5000)"],events:true}),code("cli_unexpected_tool"));
});
