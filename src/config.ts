import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
export interface KeyConfiguration { status: "ready" | "missing-key" | "unsafe-key-file"; apiKey?: string }
// Only the explicitly designated workspace file is read. Never search other files or process env.
export function loadApprovedKey(workspace: string): KeyConfiguration {
  const target = resolve(workspace, ".env.local");
  try {
    let ancestor = resolve(workspace);
    for (;;) {
      if (lstatSync(ancestor).isSymbolicLink()) return { status: "unsafe-key-file" };
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(dirname(target)) !== realpathSync(workspace)) return { status: "unsafe-key-file" };
    execFileSync("git", ["-C", workspace, "check-ignore", "--quiet", "--", ".env.local"], { stdio: "ignore" });
    const tracked = execFileSync("git", ["-C", workspace, "ls-files", "--", ".env.local"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (tracked.trim()) return { status: "unsafe-key-file" };
    const contents = readFileSync(target, "utf8").replace(/^\uFEFF/, "");
    const entries = [...contents.matchAll(/^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*?)\s*$/gm)];
    if (entries.length !== 1) return { status: "unsafe-key-file" };
    let key = entries[0]?.[1]?.trim() ?? "";
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
    if (!key || /[\r\n\s]/.test(key)) return { status: "unsafe-key-file" };
    return { status: "ready", apiKey: key };
  } catch (error: unknown) {
    return { status: error instanceof Error && "code" in error && error.code === "ENOENT" ? "missing-key" : "unsafe-key-file" };
  }
}
