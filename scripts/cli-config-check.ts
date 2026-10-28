// Offline configuration diagnosis: empty input, isolated home, no credentials and no model request.
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { cliExecArgs, cliEnvironment, classifyCliFailure, loadCliPath, runCli } from "../src/codex-responder.js";
async function main() {
  const executable=loadCliPath(fileURLToPath(new URL("../../",import.meta.url)));
  if(!executable)throw new Error("Missing local executable");
  const base=await realpath(tmpdir());
  const directory=await mkdtemp(resolve(base,"replica-offline-config-"));
  try {
    const schema=resolve(directory,"schema.json");
    await writeFile(schema,JSON.stringify({type:"object",properties:{reply:{type:"string",maxLength:1600}},required:["reply"],additionalProperties:false}));
    const result=await runCli({executable,args:cliExecArgs(schema),env:{...cliEnvironment(),CODEX_HOME:directory},cwd:directory,stdin:"",timeoutMs:10000,events:false});
    const emptyPrompt=/no prompt provided|no prompt|empty prompt/i.test(result.stderr+result.stdout);
    console.log(JSON.stringify({offline:true,credentials_available:false,empty_prompt_rejected:emptyPrompt,diagnostic:classifyCliFailure(result)}));
    if(!emptyPrompt)process.exitCode=2;
  } finally {
    const target=await realpath(directory);
    if(dirname(target)===base&&basename(target).startsWith("replica-offline-config-"))await rm(target,{recursive:true,force:true});
  }
}
void main().catch(()=>{console.log(JSON.stringify({offline:true,status:"local_failure"}));process.exitCode=2;});
