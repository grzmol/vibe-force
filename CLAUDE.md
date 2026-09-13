# Working on vibe-force

This repository is the plugin, not a Salesforce project. Changes here change how every consuming
project's sessions behave, so the bar is: deterministic, dependency-free, and tested.

## Invariants

- **No npm dependencies.** Hooks and checks use `node:` builtins only. `scripts/lib` and
  `scripts/hooks` are CommonJS `.js`; `scripts/checks` is ESM `.mjs`. Node >= 20. The one npm
  package the plugin references is the Salesforce DX MCP server in `.mcp.json`, which Claude Code
  runs through `npx` in the user's environment - never imported by a hook or a check.
- **Hooks fail open.** A handler that throws must never wedge a session: `hook-io.main()`
  catches, notes to stderr, and exits 0. Guard *decisions* are pure functions in
  `scripts/lib/*-guards.js` so they can be asserted without spawning Claude Code.
- **Rule logic lives in libs, I/O lives in handlers.** A new guard is a rule object in
  `bash-guards.js`, `mcp-guards.js`, or a branch in `edit-guards.js`, plus a test. Handlers stay thin.
- **One source of truth per fact.** Salesforce API version: `config/vibe-force.defaults.json`.
  Path-to-slice ownership: `scripts/lib/sf-paths.js` (`SLICES`), mirrored in
  `skills/sf-workflow-orchestration/references/ownership-matrix.md`. Check list and exit codes:
  `scripts/checks/vf-check.mjs`, mirrored in the README and the orchestration skill.
- **Salesforce CLI v2 only.** `sf ...` with an explicit `--target-org`. Retired `sfdx force:*`
  syntax appears only inside a documented migration table.
- **No third-party plugin references.** Skills, agents, commands and docs stand on official
  Salesforce documentation. Do not cite other Claude Code plugins as prior art. The marketplace
  may *link* Salesforce-authored plugins from `forcedotcom/sf-skills` (see
  `docs/salesforce-skills.md`); linking is not citing.
- **Never copy external skill text.** Upstream declares Apache-2.0 in `LICENSE.txt` and
  CC-BY-NC-4.0 in the npm package publishing the same `skills/` tree. Nothing from it, or from any
  other skill corpus, is pasted here - not prose, not tables, not scripts. Prove it:
  `node scripts/dev/skill-originality.mjs --corpus <clone>` must exit 0. Fix a hit by rewriting
  from the documentation; `scripts/dev/originality-allow.txt` takes reviewed facts only.
- **Tests gate every change.** `node --test tests/` must pass. A new guard rule without a test
  that fails before the rule existed is not done.

## Adding a skill

```
skills/<name>/SKILL.md          frontmatter name == directory name
skills/<name>/references/*.md   exhaustive tables, long examples, checklists
```

`SKILL.md` shape: `## When to use`, a decision table, numbered core patterns with runnable
examples, `## Anti-patterns` with the failing code and the fix, `## Verification` with the exact
`sf` / `vf-check` commands, `## References`. 180-400 lines; references 150-500 lines each.

Grounding rules: fetch the documentation you cite in the session you write it (official docs
first; Context7's `/llmstxt/developer_salesforce_llms_txt`, `/salesforcecli/cli`,
`/websites/lwc_dev` are useful indexes into it). Never invent a limit, a flag, an API name or a
rule id. Mark anything you could not verify `[unverified]`. Cross-link sibling skills by name
and name the `vf-check` that enforces a rule whenever one does.

## Adding an agent

Plugin agents support `name`, `description`, `model`, `tools`, `disallowedTools`, `skills`,
`effort`, `maxTurns` only. `hooks`, `mcpServers` and `permissionMode` are ignored for
plugin-shipped agents: do not add them. Keep `description` short - all agent descriptions share
one context budget. Body sections: Mission, Owned paths, Inputs, Method, Checks you MUST run,
Minimal change ladder, Hand-off, Hard rules.

Owned paths must be disjoint from every sibling in the same wave, and must match
`scripts/lib/sf-paths.js`. If you add a slice, update the lib, the tests, and the ownership
matrix reference together.

## Adding a check

Add a module under `scripts/checks/lib/`, register it in the dispatcher, keep the contract:
exit `0` pass, `1` gate failed, `2` misconfiguration or missing tool, `3` org or network error;
write a report to `.vibeforce/reports/<check>-<ISO>.json`; support `--changed`, `--files`,
`--target-org`, `--json`, `--project-dir`. Org-touching checks refuse production aliases unless
the operation is inherently safe or `VF_ALLOW_PROD=1` is set.

## Local verification

```bash
node --test tests/                                  # hook engine
node scripts/checks/vf-check.mjs --help             # runner contract
jq . .claude-plugin/plugin.json hooks/hooks.json    # manifests parse
claude plugin validate .                            # marketplace manifest only: both manifests live here
node scripts/dev/skill-originality.mjs --corpus /tmp/sf-skills   # no copied external prose
node scripts/dev/verify-metadata-dirs.mjs           # slice directories exist in the metadata registry
```

`claude plugin validate .` stops at `.claude-plugin/marketplace.json` and never reaches the agents
or commands. Frontmatter that fails to parse - an unquoted `:` in a `description` is the usual
cause - loads at runtime with *every field silently dropped*. Validate the plugin itself:

```bash
cp -R . /tmp/vfplugin && rm -f /tmp/vfplugin/.claude-plugin/marketplace.json
claude plugin validate /tmp/vfplugin --strict       # agents, skills, commands
```

Manual hook check without a Salesforce project:

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"sf project deploy start -o acme-prod"}}' \
  | node scripts/hooks/pre-bash-guard.js | jq .
```

## Style

English, no emojis, no filler. Tables for reference data. Tagged code fences. Comments explain
why, not what. Prose that could be a table should be a table.
