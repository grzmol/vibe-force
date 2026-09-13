# Architecture

## Component map

```
Claude Code session
        |
        |-- skills/            knowledge: what correct Salesforce work looks like
        |-- agents/            labour: who does which slice, in which wave
        |-- commands/          entry points: /vf-story, /vf-check, /vf-deploy, /vf-verify, ...
        |
        |-- hooks/hooks.json   lifecycle wiring
        |     |
        |     '-- scripts/hooks/*.js       thin handlers (stdin JSON -> stdout decision)
        |               |
        |               '-- scripts/lib/*.js   pure logic: guards, config, state, classification
        |
        '-- scripts/checks/vf-check.mjs   the only gate runner
                  |
                  |-- prettier / eslint / sf code-analyzer / sfdx-lwc-jest     (local, no org)
                  '-- sf apex run test / project deploy validate|quick / data query / limits (org)
                            |
                            '-- <project>/.vibeforce/{config.json, state/, reports/}
```

The plugin holds no Salesforce state of its own. Everything session- or project-specific lives
under the consuming project's `.vibeforce/` directory and is disposable.

## Why the layers are split this way

| Decision | Reason |
| --- | --- |
| Guard rules as pure functions in `scripts/lib`, handlers as thin I/O shells | Rules are testable without Claude Code; `tests/hooks.test.mjs` asserts each rule and each handler's stdout contract |
| Zero npm dependencies | The hooks run on every tool call in every session; an install step or a transitive dependency tree is a liability, not a feature. The Salesforce DX MCP server in `.mcp.json` is the one exception: Claude Code runs it through `npx` in the user's environment, and no hook or check imports it |
| One check runner instead of per-agent commands | Agents, hooks, humans and CI must gate on exactly the same thing; divergence between "what CI runs" and "what the agent ran" is the classic pipeline failure |
| Ownership enforced by a hook, not by prompt discipline | Prompt discipline degrades over a long session; a `deny` does not |
| State in files, not in context | Claims, gate results, validated job ids and touched files survive compaction, subagent boundaries and session restarts |
| Reports as JSON artefacts | A finding must be re-readable after the model's context moved on, and uploadable from CI |

## Request flow: a write during wave 1

```
model calls Write(force-app/.../classes/AccountsService.cls)
   -> PreToolUse hook: pre-edit-guard.js
        loadConfig()               resolve project root, merge defaults + .vibeforce/config.json
        classify(path)             slice = apex, owner = sf-apex-engineer
        claimConflict(path, agent) another live agent holds it? -> deny
        slice check                agent_type is a wave-1 peer of another slice? -> deny
        secret scan                private key / token / client secret in content? -> deny
        advisory notes             SOQL in loop, missing test class, hardcoded id...
   -> tool executes
   -> PostToolUse hook: post-edit-check.js
        claim(path, agent)         ownership.json
        touch(session, path)       touched.json  (feeds the Stop gate)
        lintXml / apiVersion       metadata hygiene
        prettier --write           when hooks.autoFormat
   -> model continues
...
   -> Stop hook: stop-local-gate.js
        touched files that are Apex/LWC/metadata and still exist
        already passed for this exact file set? -> pass
        run vf-check <stopGate> --files ... --json
        exit 0 -> record pass; exit 1 -> block the turn with the findings
        exit 2/3 -> note and pass (tooling problem, not a code problem) unless mode=strict
```

## Request flow: an MCP tool call

```
model calls mcp__salesforce-dx__deploy_metadata(usernameOrAlias: acme-prod)
   -> PreToolUse hook: pre-mcp-guard.js        matcher mcp__.*
        loadConfig()               same project config as every other guard
        parseToolName()            server = salesforce-dx, tool = deploy_metadata
        productionTarget(input)    any string argument, any depth, matching productionAliases
        rules in mcp-guards.js     deny: MCP deploys leave no validated job id
   -> tool never executes
```

An MCP server reaches the org without going through Bash, so `pre-bash-guard` never sees the call
and the production rails would otherwise have a side door. The same applies to writes:
`retrieve_metadata` puts files on disk without a `Write` tool call, so no ownership claim is
checked - the guard notes it instead of silently allowing a wave-1 collision. Scope, toolsets and
the full rule table: [MCP](mcp.md).

## Wave model

Waves exist to make parallelism safe rather than merely concurrent:

| Wave | Shape | Why |
| --- | --- | --- |
| 0 scout + design + contract | serial | Produces the decisions every parallel agent depends on; parallelising it would mean negotiating mid-flight. `sf-technical-architect` runs here, only when the story has more than one defensible design |
| 1 build | parallel, disjoint paths | The work is genuinely independent once the contract is fixed |
| 2 checks | parallel, read-mostly | Tests, static analysis and security review do not conflict |
| 3 deploy | serial | One org, one deploy; validate then quick deploy is inherently ordered |
| 4 verify | parallel | Smoke probes and org test runs are independent observations |

The cost model matters: wave 1 and 2 are where wall clock is saved, wave 3 is where risk is
concentrated, wave 4 is where truth is established.

## Local versus org

The harness deliberately separates what can be proven without an org from what cannot:

| Provable locally | Needs an org |
| --- | --- |
| Prettier/ESLint/Code Analyzer findings | Apex compilation |
| LWC behaviour via Jest (mocked wire adapters, Apex, navigation) | Apex test execution and coverage |
| Metadata XML well-formedness, api version drift | Metadata validity and cross-references |
| Test/component pairing, missing tests | Flow activation, permission effects |
| Governor-limit anti-patterns by inspection | Actual limit consumption |
| Contract and scope review | Data shape, integration reachability |

`local` is therefore the gate that runs constantly, and `apex`/`deploy-validate`/`smoke` are the
gates that run at wave boundaries where an org round trip is justified.

## Extension points

| Want to | Change |
| --- | --- |
| Add a guard | a rule object in `scripts/lib/bash-guards.js` (or a branch in `edit-guards.js`) plus a test |
| Add a metadata slice | `SLICES` in `scripts/lib/sf-paths.js`, the ownership matrix reference, the owning agent file, tests |
| Add a check | a module under `scripts/checks/lib/`, the dispatcher, README and orchestration skill tables |
| Change a threshold | `config/vibe-force.defaults.json` (plugin default) or `.vibeforce/config.json` (project) |
| Add a skill | `skills/<name>/SKILL.md` + `references/`, cross-linked from siblings |
| Change hook aggressiveness | `hooks.mode` in project config, or `VF_HOOK_MODE` per shell |

## Non-goals

- No MCP server: everything is a CLI call the user can reproduce by hand.
- No background daemons or watchers.
- No org state cached in the plugin: the org is the source of truth, queried when needed.
- No silent fixes: a guard denies with a reason, a check reports findings, the model decides.
