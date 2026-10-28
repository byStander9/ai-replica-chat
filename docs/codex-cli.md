# Local synthetic Codex CLI adapter

The optional localhost adapter reuses the official CLI's existing ChatGPT login. It never reads or copies credentials and never loads the project API key. Messenger integration and personal data are outside this experiment.

## Verified execution and limits

The installed CLI is pinned to `codex-cli 0.164.0-alpha.11.1`. Version, disabled features and ChatGPT login status are checked before each model launch. One explicitly authorized live synthetic check launched the CLI once and received a nonzero exit (`cli_failed`). No normal model reply was verified. The underlying raw diagnostic was intentionally not retained or printed, so the precise upstream cause is unknown. The failed input was not committed to session history. No second launch or API fallback followed.

The wrapper performs no automatic retry. This CLI build rejects built-in provider retry overrides; official CLI default internal retry behavior remains in effect and its internal network attempt count is unknown. A CLI launch is not a guarantee of exactly one network request. Subscription quotas still apply.

## Boundaries

- Only fixed fictional messages and relationships can reach the CLI. Context is reconstructed separately for each counterpart without resume or a shared daemon.
- A fresh temporary cwd contains only a generated reply schema. No repository, env or messenger files are copied there. Cleanup verifies the resolved parent and generated directory prefix.
- Exec uses `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--no-daemon`, `--ask-for-approval never`, strict config and a read-only sandbox. Project instruction loading is capped at zero bytes and host skill discovery is disabled.
- Shell, apps, plugins, MCP config, web search, browser/computer tools, image tools, code mode, multi-agent, hooks, memories, skill search and tool suggestions are disabled through supported settings. An offline features check confirms the disabled feature flags.
- The executable is a canonical regular `codex.exe` under the official app's bin directory, selected by an ignored machine-local JSON file. Prompt data goes through stdin with `shell:false`, fixed arguments and a curated environment without API keys, tokens, endpoint or proxy overrides.
- One concurrent launch, at most two launches per server process, 45-second model timeout, 64 KiB combined stdout/stderr, 1600-character reply and JSON-schema validation. The explicit live checker allows only one launch. Unexpected tool events, failure or timeout stop further calls for that responder. Duplicate request IDs reuse the recorded result.
- Replies have no forced AI prefix/suffix. The owner's UI shows the engine and readiness. Prompt instructions prohibit falsely claiming live human typing or finalizing financial transactions and important commitments; these are not verified guarantees of model behavior.

Read-only does not prevent file reads. Tool configuration reduces access but is not an independently verified OS isolation boundary. Authentication remains available to the official CLI. Ephemeral mode does not guarantee deletion of provider-side processing or all machine caches. System/managed configuration and implementation details may still affect execution. Real messenger integration, personal-data use and deployment require separate work.

## Validation

`npm run typecheck`, `npm run lint` and 40 tests pass. The suite uses fake CLI results and harmless Node processes, with no model calls. It covers stdin/cwd/environment/args/schema, account isolation, approval, duplicate IDs, concurrency, version/auth/tool preflight, transport limits and failures. The browser confirms CLI engine labeling, missing-config status and disabled sending for both pending and approved synthetic identities. Existing port 4317 was left untouched; browser checks used a separate disabled-provider server on port 4318.

Official references: [CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli), [configuration](https://learn.chatgpt.com/docs/config-file/config-reference).