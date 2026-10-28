// Explicit opt-in, metadata only. Never part of npm test.
import { fileURLToPath } from "node:url";
import { CodexResponder, loadCliPath } from "../src/codex-responder.js";
import { ChatService, ServiceError } from "../src/service.js";
import { SYNTHETIC_MESSAGES } from "../src/synthetic.js";
async function main(){
 if(!process.argv.includes("--confirm-synthetic-cli"))throw new Error("Explicit synthetic CLI confirmation required");
 const executable=loadCliPath(fileURLToPath(new URL("../../",import.meta.url)));
 const p=new CodexResponder(executable?{executable,maxRequests:1}:{});const service=new ChatService(p);
 try{
  const result=await service.chat("friend-a",SYNTHETIC_MESSAGES[0],"cli-live-0001");
  await service.chat("friend-a",SYNTHETIC_MESSAGES[0],"cli-live-0001");
  console.log(JSON.stringify({status:"completed",cli_attempts:1,nonempty_response:Boolean(result.messages[1]?.text.trim()),duplicate_without_extra_call:p.info.remainingRequests===0,other_account_isolated:service.session("friend-b").messages.length===0,response_text_printed:false}));
 }catch(error:unknown){console.log(JSON.stringify({status:"blocked",cli_attempts:executable?1-(p.info.remainingRequests??1):0,error_code:error instanceof ServiceError?error.code:"local_failure",failed_input_not_committed:service.session("friend-a").messages.length===0,automatic_retry:false,api_fallback:false}));process.exitCode=2;}
}
void main().catch(()=>{console.log(JSON.stringify({status:"not_run",reason:"local_setup_failed"}));process.exitCode=2;});
