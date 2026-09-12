# Gates and hooks

Everything the harness enforces without asking the model to remember it.

## Hook inventory

| Event | Handler | What it does | Mode from |
| --- | --- | --- | --- |
| `SessionStart` | `scripts/hooks/session-start-context.js` | Injects project shape, api version drift, default org, gate thresholds, guarded production aliases, pending validated deployments, stale claims | minimal |
| `PreToolUse` (`Bash`, `PowerShell`) | `scripts/hooks/pre-bash-guard.js` | Evaluates every command segment against the guard rules: production deploy/data/metadata operations, retired `sfdx force:*` syntax, git hook bypass, force push, credential exposure, ignore-flags, missing local gate | minimal (deny/ask), standard (+ notes) |
| `PreToolUse` (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) | `scripts/hooks/pre-edit-guard.js` | Denies generated paths, secrets, claimed files, cross-slice writes; prompts on profile edits; attaches advisory notes | minimal (deny/ask), standard (+ notes) |
| `PostToolUse` (`Write`, `Edit`, `MultiEdit`) | `scripts/hooks/post-edit-check.js` | Claims the path, records the touch, lints metadata XML, checks api version drift, runs the project prettier | minimal |
| `SubagentStop` | `scripts/hooks/subagent-stop-release.js` | Releases the agent's claims, records the file set in `events.jsonl` | minimal |
| `Stop` | `scripts/hooks/stop-local-gate.js` | Runs `hooks.stopGate` (default `static`) over the session's touched files and blocks the turn while it fails | standard |
| `PreCompact` | `scripts/hooks/pre-compact-notes.js` | Writes `.vibeforce/state/session-notes.md` with touched files, gate status, validated deployments, live claims | minimal |

Rule logic is pure and unit-tested: `scripts/lib/bash-guards.js`, `scripts/lib/edit-guards.js`,
`scripts/lib/xml-lint.js`, `scripts/lib/sf-paths.js`. Run `node --test tests/` in the plugin
repository to see each rule asserted.

## Hook modes

| Mode | Guards (deny/ask) | Advisory notes | Stop gate | Deploy without passing local gate |
| --- | --- | --- | --- | --- |
| `off` | no | no | no | allowed |
| `minimal` | yes | no | no | allowed |
| `standard` (default) | yes | yes | yes | note only |
| `strict` | yes | yes | yes | denied |

Set it in `.vibeforce/config.json`:

```json
{ "hooks": { "mode": "strict", "stopGate": "local", "autoFormat": true, "enforceOwnership": true } }
```

Per-shell override: `VF_HOOK_MODE=strict`, `VF_ALLOW_PROD=1`, `VF_SKIP_CHECKS=1`, `VF_DEBUG=1`.

## Guard rules

| Rule id | Trigger | Decision |
| --- | --- | --- |
| `retired-sfdx-syntax` | `sfdx force:*` | deny, with the `sf` replacement |
| `git-no-verify` | `git commit/push/merge --no-verify` or `-n` | deny |
| `git-force-push-protected` | `git push --force` / `-f` | deny on `main`/`master`/`develop`/`release/*`, otherwise ask (use `--force-with-lease`) |
| `prod-deploy-start` | `sf project deploy start` targeting a production alias | deny (ask when `VF_ALLOW_PROD=1` cleared `blockProductionDeploy`) |
| `prod-quick-deploy-unvalidated` | `sf project deploy quick` to production | deny without `--job-id`; ask when the job is unknown to `deploy-jobs.json`; ask to confirm the window when it is known |
| `ignore-flags-on-prod` | `--ignore-conflicts/-errors/-warnings` | deny on production, ask elsewhere |
| `destructive-source-delete` | `sf project delete source/tracking` | deny on production, ask elsewhere |
| `sandbox-org-delete` | `sf org delete sandbox` | ask (scratch org deletion passes) |
| `prod-data-mutation` | `sf data delete/update/upsert/import` on production | deny; `sf data query` always passes; bulk delete elsewhere asks |
| `prod-anonymous-apex` | `sf apex run` on production | ask |
| `prod-destructive-apex-test-run` | `--test-level RunAllTestsInOrg` on production | ask |
| `credential-leak` | `--password`, `--client-secret`, `sfdxurl`, inline secret-looking `-p` | ask, with the safer auth path |
| `auth-file-into-repo` | writing an sfdx auth URL file inside the tree | deny |
| `deploy-without-local-gate` | deploy/validate with no passing local gate this session | note (standard) / deny (strict) |

Edit-guard rules: `generated-path`, `secret:<pattern>` (private key, AWS key id, `force://`
auth URL, Slack/GitHub token, bearer literal, client secret, password literal, `<password>` in
metadata), `ownership-conflict`, `slice-boundary`, `profile-edit`, plus advisory notes for
SOQL/DML in loops, `SeeAllData=true`, hardcoded ids, `without sharing`, legacy `System.assert*`,
concatenated dynamic SOQL, stray `console.log`, missing Apex test class, missing Jest test,
`sfdx-project.json` and `.forceignore` changes.

## Check runner

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" <check> [flags]
```

| Check | Org | Composition |
| --- | --- | --- |
| `format` | no | prettier `--check` (`--fix` writes) |
| `lint` | no | eslint over LWC/Aura JS |
| `analyzer` | no | `sf code-analyzer run` with `config/code-analyzer.yml` |
| `jest` | no | `sfdx-lwc-jest` with coverage gate |
| `static` | no | format + lint + analyzer + test/component pairing |
| `local` | no | static + jest - the wave-2 gate and the Stop gate |
| `apex` | yes | `sf apex run test` with coverage gates |
| `deploy-validate` | yes | `sf project deploy validate`, records the job id |
| `deploy-quick` | yes | `sf project deploy quick --job-id <recorded>` |
| `smoke` | yes | deploy report, anonymous-Apex probes, verification queries, limits, log scan |
| `verify` | yes | apex + smoke |
| `all` | yes | local + apex + smoke |

Flags: `--changed`, `--files <globs>`, `--target-org <alias>`, `--project-dir <path>`, `--json`,
`--fix`, `--quiet`, `--report <path>`.

Exit codes: `0` pass, `1` gate failed (fix the code), `2` misconfiguration or missing tool
(fix the environment), `3` org or network error (retry or check auth). The Stop hook treats 2
and 3 as non-blocking outside `strict` mode, because a missing prettier install is not a reason
to hold a turn hostage.

## Gate thresholds

```json
{
  "gates": {
    "apexOrgCoverageMin": 85,
    "apexClassCoverageMin": 75,
    "jestCoverageMin": 80,
    "analyzerFailSeverity": 3,
    "requireTestForApexClass": true,
    "requireJestForLwc": true
  }
}
```

`apexClassCoverageMin` 75 is the platform requirement for production deployment; the org-level
85 is headroom so a single uncovered class does not block a release. Lowering either value is a
human decision with a reason recorded in the repository, never an agent's workaround.

## State files

| File | Written by | Read by |
| --- | --- | --- |
| `.vibeforce/state/ownership.json` | `post-edit-check`, `subagent-stop-release` | `pre-edit-guard`, orchestrator |
| `.vibeforce/state/touched.json` | `post-edit-check` | `stop-local-gate`, `pre-compact-notes` |
| `.vibeforce/state/gates.json` | `stop-local-gate` | `pre-bash-guard` (`deploy-without-local-gate`) |
| `.vibeforce/state/deploy-jobs.json` | `vf-check deploy-validate` | `vf-check deploy-quick`, `pre-bash-guard`, `session-start-context` |
| `.vibeforce/state/contract.md` | orchestrator | every wave-1/2 agent |
| `.vibeforce/state/session-notes.md` | `pre-compact-notes` | the session after compaction |
| `.vibeforce/state/events.jsonl` | all guards | audit, post-mortem |
| `.vibeforce/reports/*.json` | `vf-check` | agents, humans, CI artefact upload |

All of it is disposable and gitignored. Deleting `.vibeforce/state` resets the harness; it never
holds anything a deploy depends on.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every write to a file is denied with `ownership-conflict` | stale claim from a crashed agent | inspect `ownership.json`, delete the entry, or wait out the 6h TTL |
| Turn will not end, gate keeps failing | real finding in a touched file | run the printed command, fix at source; `VF_SKIP_CHECKS=1` only with a human decision |
| Gate cannot run, exit 2 | prettier/eslint/analyzer not installed in the project | `npm ci`, `sf plugins install code-analyzer` |
| Hooks silent | `hooks.mode` is `off`, or `node` not on the non-interactive PATH | check `.vibeforce/config.json`, run `node -v` from a login-less shell |
| Guard blocks a legitimate production step | correct behaviour | human sets `VF_ALLOW_PROD=1` for that shell, with the reason recorded |
| Advisory notes too chatty | mode `standard` | set `hooks.mode` to `minimal` for a session of pure research |
