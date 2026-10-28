import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { loadApprovedKey } from "../src/config.js";
function fixture(run:(directory:string)=>void):void{
  const directory=mkdtempSync(join(tmpdir(),"replica-key-test-"));
  try{
    execFileSync("git",["init",directory],{stdio:"ignore"});
    writeFileSync(join(directory,".gitignore"),".env.local\n");
    run(directory);
  }finally{
    assert.equal(realpathSync(dirname(directory)),realpathSync(tmpdir()));
    assert.ok(basename(directory).startsWith("replica-key-test-"));
    rmSync(directory,{recursive:true,force:false});
  }
}
test("missing approved file is a safe disabled configuration",()=>fixture(directory=>{
  assert.equal(loadApprovedKey(directory).status,"missing-key");
}));
test("only one nonempty ignored untracked assignment is accepted",()=>fixture(directory=>{
  const target=join(directory,".env.local");
  writeFileSync(target,"OPENAI_API_KEY=SYNTHETIC_TEST_TOKEN\n");
  assert.equal(loadApprovedKey(directory).status,"ready");
  writeFileSync(target,"OPENAI_API_KEY=\n");
  assert.equal(loadApprovedKey(directory).status,"unsafe-key-file");
  writeFileSync(target,"OPENAI_API_KEY=SYNTHETIC_TEST_TOKEN\nOPENAI_API_KEY=SYNTHETIC_OTHER_TOKEN\n");
  assert.equal(loadApprovedKey(directory).status,"unsafe-key-file");
}));
test("tracked, not-ignored and hardlinked files are rejected",()=>fixture(directory=>{
  const target=join(directory,".env.local");
  writeFileSync(target,"OPENAI_API_KEY=SYNTHETIC_TEST_TOKEN\n");
  execFileSync("git",["-C",directory,"add","-f",".env.local"],{stdio:"ignore"});
  assert.equal(loadApprovedKey(directory).status,"unsafe-key-file");
  execFileSync("git",["-C",directory,"rm","--cached",".env.local"],{stdio:"ignore"});
  writeFileSync(join(directory,".gitignore"),"");
  assert.equal(loadApprovedKey(directory).status,"unsafe-key-file");
  writeFileSync(join(directory,".gitignore"),".env.local\n");
  linkSync(target,join(directory,"linked-file"));
  assert.equal(loadApprovedKey(directory).status,"unsafe-key-file");
}));
