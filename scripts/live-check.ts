// Explicit opt-in only; never included in npm test. Reports metadata, never key or response text.
import { fileURLToPath } from "node:url";
import { loadApprovedKey } from "../src/config.js";
import { OpenAiResponder, SYNTHETIC_TEST_MODEL } from "../src/openai-responder.js";
import { ChatService, ServiceError } from "../src/service.js";
import { SYNTHETIC_MESSAGES } from "../src/synthetic.js";
async function main():Promise<void>{
  if(!process.argv.includes("--confirm-synthetic-api"))throw new Error("Explicit synthetic API confirmation flag required");
  const workspace=fileURLToPath(new URL("../../",import.meta.url));
  const configuration=loadApprovedKey(workspace);
  if(configuration.status!=="ready"||!configuration.apiKey){
    console.log(JSON.stringify({status:"not_run",reason:"key_configuration_unavailable",external_attempts:0}));
    process.exitCode=2;return;
  }
  const provider=new OpenAiResponder({apiKey:configuration.apiKey,maxRequests:2});
  const service=new ChatService(provider);
  let messagesBeforeAttempt=0;
  try{
    const first=await service.chat("friend-a",SYNTHETIC_MESSAGES[0],"live-synthetic-01");
    if(first.messages.length!==2||!first.messages[1]?.text.trim())throw new Error("Unexpected synthetic response");
    await service.chat("friend-a",SYNTHETIC_MESSAGES[0],"live-synthetic-01");
    if(provider.info.remainingRequests!==1)throw new Error("Replay caused extra request");
    if(service.session("friend-b").messages.length!==0)throw new Error("Isolation failed");
    messagesBeforeAttempt=service.session("friend-a").messages.length;
    const second=await service.chat("friend-a",SYNTHETIC_MESSAGES[2],"live-synthetic-02");
    if(second.messages.length!==4)throw new Error("Session context failed");
    console.log(JSON.stringify({status:"completed",model:SYNTHETIC_TEST_MODEL,external_attempts:2,nonempty_ai_responses:2,duplicate_replay_without_extra_call:true,other_account_isolated:true,synthetic_only:true,response_text_printed:false}));
  }catch(error:unknown){
    console.log(JSON.stringify({status:"blocked",model:SYNTHETIC_TEST_MODEL,external_attempts:2-(provider.info.remainingRequests??2),error_code:error instanceof ServiceError?error.code:"local_validation_failed",http_status:error instanceof ServiceError?error.status:null,failed_request_not_committed:service.session("friend-a").messages.length===messagesBeforeAttempt,automatic_retry:false,second_request_after_failure:false,response_text_printed:false}));
    process.exitCode=2;
  }
}
void main().catch(()=>{console.log(JSON.stringify({status:"not_run",reason:"local_setup_failed",external_attempts:0}));process.exitCode=2;});
