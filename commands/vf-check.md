---
description: Run a vibe-force check (format, lint, analyzer, jest, static, local, apex, smoke, verify, all), interpret the JSON report, group findings by severity, and propose the minimal fix set.
argument-hint: "[check] [--changed|--files <globs>] [--target-org <alias>]"
allowed-tools: Read, Grep, Glob, Edit, Bash(node:*), Bash(git status:*), Bash(git diff:*), Bash(git merge-base:*)
---

# vf-check - run a gate and interpret it

Raw arguments: `$ARGUMENTS`

Parse them as: first bare token = the check name, everything else = flags passed through untouched.
When no check name is given, use `local`.

## Checks

| Check | Org | What it runs |
| --- | --- | --- |
| `format` | no | `prettier --check` on changed Apex, LWC, XML, JS |
| `lint` | no | `eslint` on LWC and Aura JavaScript |
| `analyzer` | no | `sf code-analyzer run` with `config/code-analyzer.yml`, fails at `analyzerFailSeverity` |
| `jest` | no | `sfdx-lwc-jest` plus the `jestCoverageMin` gate |
| `static` | no | format + lint + analyzer |
| `local` | no | static + jest - the full local gate, and the default |
| `apex` | yes | `sf apex run test` plus the coverage gates |
| `deploy-validate` | yes | check-only deploy, records the job id |
| `deploy-quick` | yes | deploys a previously validated job id |
| `smoke` | yes | post-deploy probes: anonymous Apex, `sf data query`, limits, deploy report |
| `verify` | yes | apex + smoke |
| `all` | yes | local + apex + smoke |

Pass-through flags: `--changed`, `--files <globs>`, `--target-org <alias>`, `--json`, `--report <path>`,
`--quiet`, `--fix`, `--strict`, `--project-dir <path>`, `--tests <names>`, `--test-level <level>`,
`--job-id <id>`.

## 1. Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" <check> <flags> --json
```

Rules:

- Add `--changed` when the user gave neither `--changed` nor `--files` and the working tree has uncommitted
  changes. Say that you added it.
- For an org-backed check with no `--target-org`, read `orgs` from `<project>/.vibeforce/config.json` and use the
  `dev` alias. Name the alias you picked in the output. Never fall back to the CLI's ambient default org
  silently.
- Never pass `--fix` unless the user asked for it. See section 4.

## 2. Read the exit code before anything else

| Exit | Meaning | What you do |
| --- | --- | --- |
| `0` | Pass | Report the summary and stop |
| `1` | A gate failed | Sections 3 and 4 |
| `2` | Misconfiguration or a missing tool | Report the runner's own message verbatim and the prerequisite it names. Do not retry, do not work around it |
| `3` | Org or network error | Report the org alias and the CLI error. Retry once only if the error is transient (timeout, 503). Never retry an auth failure |

## 3. Interpret the report

The run writes `<project>/.vibeforce/reports/<check>-<ISO>.json` with
`{check, startedAt, durationMs, status, gates, findings[], raw}`. Read it - do not rely on stdout alone.

Group `findings[]` by severity and, inside a severity, by rule. For each group produce one row:

| Severity | Rule | Files | Count | Fix |
| --- | --- | --- | --- | --- |

Report `gates` separately, because a gate failure has no `findings[]` entry:

| Gate | Threshold | Actual | Verdict |
| --- | --- | --- | --- |

Gate names come from `.vibeforce/config.json`: `apexOrgCoverageMin`, `apexClassCoverageMin`, `jestCoverageMin`,
`analyzerFailSeverity`, `requireTestForApexClass`, `requireJestForLwc`.

## 4. Propose the minimal fix set

Order the work by what actually unblocks the gate:

1. Findings at or above `analyzerFailSeverity`, and any failed gate. These are the only blocking items.
2. Findings below the threshold that sit in files you are already editing.
3. Everything else - list it, do not fix it in this turn.

For each blocking item give the file, the line, the rule, and the smallest edit that clears it. Prefer one edit
that clears a whole rule group over several one-line patches. Never propose raising a threshold, adding a
suppression comment, narrowing `--files`, or deleting a test as a fix - if that is genuinely the right call, say
so as an explicit recommendation with the reason, and leave the decision to the user.

Coverage gate failures are fixed by writing the missing test, not by excluding the class.

## 5. Fixing

You may apply fixes in this turn when the user asked for them or when the user invoked this command as part of a
larger task that expects a green gate. When you do:

- State every file you changed and why, before the summary table.
- `--fix` is not silent: it rewrites files through `prettier --write` and `eslint --fix`. If you use it, say so,
  then show `git diff --stat` so the user sees the blast radius.
- Rerun the same check after fixing and report the new exit code. A fix you did not re-verify is not a fix.

## Output

```text
vf-check <check> [flags] -> exit <code> (<status>)
report: .vibeforce/reports/<check>-<ISO>.json
```

Then the findings table, the gates table, the fix plan, and - if you fixed anything - the list of changed files
and the rerun result. Keep it to what the user has to act on.
