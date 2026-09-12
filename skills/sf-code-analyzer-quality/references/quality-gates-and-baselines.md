# Quality Gates and Baselines

Gate policy, how to introduce the gate to a codebase that has never been analyzed, and how the
signal reaches CI and reviewers.

## 1. Gate definitions

| Gate | Source of truth | Blocking condition |
| --- | --- | --- |
| Formatting | `config/prettier/.prettierrc` | any file fails `prettier --check` |
| JavaScript lint | `config/eslint/eslint.config.mjs` | any ESLint error (warnings do not block) |
| Static analysis | `config/code-analyzer.yml` | any violation at severity <= `gates.analyzerFailSeverity` (default `3`) |
| LWC unit tests | Jest config in the consumer project | failing test or coverage below `gates.jestCoverageMin` (default `80`) |
| Apex tests | org run | org coverage below `gates.apexOrgCoverageMin` (85) or class coverage below `gates.apexClassCoverageMin` (75) |
| Test presence | `gates.requireTestForApexClass`, `gates.requireJestForLwc` | new Apex class without a test class, new LWC without a Jest test |

`local` = `format` + `lint` + `analyzer` + `jest`. Nothing reaches wave 3 (deploy) until `local`
exits `0`. Apex test and coverage policy: skill `sf-apex-testing`. Deploy-time test levels: skill
`sf-deployment-strategies`.

## 2. Exit codes and what they mean for the agent

| Code | Meaning | Correct response |
| --- | --- | --- |
| `0` | pass | continue the wave |
| `1` | gate failed | fix the code; never lower the threshold to pass |
| `2` | misconfiguration or missing tool (no JDK for `pmd`/`sfge`, no Python for `flow`, plugin not installed) | fix the environment or disable that engine in config; report it, do not silently skip |
| `3` | org or network error | retry once, then report; not a code problem |

Exit `2` is the one an agent most often mishandles. A missing JDK silently dropping the `pmd` and
`sfge` engines would turn a security gate into a no-op, which is why the runner treats it as a
misconfiguration rather than a pass.

## 3. Introducing the gate to a legacy codebase

Turning on `Recommended` at severity 3 in a codebase with years of history produces thousands of
violations and stalls delivery. Sequence it:

**Step 1 - measure.** Full inventory, no threshold, machine-readable:

```bash
sf code-analyzer run --workspace . --rule-selector Recommended \
  --output-file .vibeforce/reports/baseline.json \
  --output-file .vibeforce/reports/baseline.html
```

**Step 2 - gate new and changed code only.** `vf-check analyzer --changed` targets files changed
against `git merge-base origin/main HEAD` while passing the package directories as the workspace, so
new violations block and historical ones do not. This is the default vibe-force posture and is
usually sufficient: legacy debt stops growing immediately.

**Step 3 - record the remaining debt explicitly.** For modules that must be excluded for a while,
add a capped suppression rather than an ignore:

```yaml
suppressions:
  "force-app/legacy/classes/":
    - rule_selector: "pmd:ApexCRUDViolation,pmd:ApexSharingViolations"
      max_suppressed_violations: 120
      reason: "Pre-2024 module. VF-214 migrates to user mode; cap ratchets down monthly."
```

Why a cap beats `ignores.files`: the cap is a number in version control that can only go down, new
violations beyond the cap are reported normally, and the `reason` field carries the ticket.

**Step 4 - ratchet.** Each iteration, lower the cap by the number of violations fixed and commit the
new number in the same PR:

```bash
# current count for the suppressed selector, ignoring suppressions
sf code-analyzer run --workspace . --rule-selector "pmd:(ApexCRUDViolation,ApexSharingViolations)" \
  --target force-app/legacy/classes --no-suppressions --output-file /tmp/legacy.json
```

Set `max_suppressed_violations` to the observed count. The cap becomes a monotonically decreasing
debt counter, and the PR that fails because the cap is too low is the PR that reintroduced debt.

**Step 5 - remove the suppression.** When the count reaches `0`, delete the block. The module is
then covered by the normal gate.

## 4. Severity policy and escalation

| Severity | Gate behaviour | Review expectation |
| --- | --- | --- |
| 1 Critical | blocks | fix in this PR; no suppression without a named approver in the PR description |
| 2 High | blocks | fix in this PR |
| 3 Moderate | blocks (default threshold) | fix, or justify a capped suppression |
| 4 Low | reported | fix opportunistically; may be batched into a cleanup PR |
| 5 Info | reported | no action required |

Escalations vibe-force applies on top of the engine defaults (`config/code-analyzer.yml`):
`ApexSOQLInjection`, `ApexSuggestUsingNamedCred`, `ApexBadCrypto`, `ApexCSRF`,
`OperationWithLimitsInLoop`, and `@lwc/lwc/no-inner-html` become Critical because each one is a
security or scalability defect that is cheap to fix at authoring time and expensive later.

Never change `gates.analyzerFailSeverity` to pass a PR. The only legitimate reasons to change it are
a deliberate, reviewed policy change for the whole project.

## 5. Suppression review rules

A suppression is a code change and gets the same scrutiny:

1. **Narrowest scope.** Prefer `code-analyzer-suppress-next-line <engine>:<rule>` over a file-level
   marker, and a single rule selector over `engine:all`.
2. **Reason on the same line or in the config entry.** `-- reason text` after the marker; `reason:`
   in a config suppression.
3. **Cap.** Config suppressions always set `max_suppressed_violations`.
4. **Expiry.** The reason names a ticket. A suppression with no ticket and no owner is deleted.
5. **Never suppress a Critical** without an approver named in the PR description.
6. **Never `--no-suppressions` in reverse.** Do not add `suppressions.disable_suppressions: true` to
   silence the audit; that field is for verifying the true violation count.

Audit the current suppression surface:

```bash
# what does the config suppress?
sf code-analyzer config --config-file config/code-analyzer.yml --rule-selector all | sed -n '/suppressions/,$p'

# true violation count, ignoring every suppression
sf code-analyzer run --workspace . --rule-selector Recommended --no-suppressions \
  --output-file .vibeforce/reports/unsuppressed.json
```

Grep the source for in-line markers as part of review:

```bash
grep -rn "code-analyzer-suppress" force-app
```

## 6. Which engines run where

| Stage | Selector | Rationale |
| --- | --- | --- |
| Editor / on save | Prettier + ESLint | instant feedback, no JVM start-up |
| Pre-commit hook | `vf-check format`, `vf-check lint` on staged files | fast, deterministic |
| PR gate (`vf-check analyzer --changed`) | `Recommended` across `pmd`, `eslint`, `regex`, `retire-js`, `flow` | seconds to a minute on a changed-file target |
| Pre-deploy (`vf-check static` on the full workspace) | `Recommended` plus `sfge` | Graph Engine needs the whole workspace and is slow; run once before wave 3 |
| Nightly / release | `--rule-selector all`, plus `cpd`, plus `AppExchange` when packaging | full inventory, trend tracking |

Graph Engine in particular should not run per-keystroke: it compiles the workspace, builds a
TinkerPop graph, and walks every path from every entry point. If it times out
(`java_thread_timeout`, default 900000 ms) or reports `LimitReached`, raise `java_max_heap_size` and
`java_thread_count`, or narrow `--target` while keeping the full `--workspace`.

## 7. CI integration

```bash
# 1. install once per job
sf plugins install code-analyzer
npm ci

# 2. run the no-org gate; non-zero exit fails the job
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed --json \
  > .vibeforce/reports/local.json

# 3. produce SARIF for code scanning
sf code-analyzer run --workspace . --rule-selector Recommended \
  --config-file config/code-analyzer.yml \
  --severity-threshold 3 \
  --output-file analyzer.sarif
```

SARIF upload (GitHub Actions):

```yaml
- name: Upload Code Analyzer SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: analyzer.sarif
    category: salesforce-code-analyzer
```

Notes:

- `--output-file analyzer.sarif` is a documented extension for `run`; SARIF also carries fixes and
  suggestions when `--include-fixes` / `--include-suggestions` are set.
- Run the analyzer step with `continue-on-error: false` for the threshold run, and a second
  unthresholded run only if you want a complete SARIF even when the gate fails.
- HTML output (`--output-file analyzer.html`) is the artifact reviewers actually read; attach it to
  the job.
- Cache `node_modules` and the Salesforce CLI plugin directory; the JVM-based engines dominate
  runtime otherwise.
- `[unverified]` Whether the SARIF emitted by Code Analyzer v5 includes rule help URIs in the form
  GitHub code scanning prefers was not verified this session; check one uploaded run before relying
  on in-PR rule descriptions.

## 8. PR annotation without SARIF

When code scanning is unavailable, convert the JSON report into review comments from the check
runner's normalized `findings[]` array (`{check, startedAt, durationMs, status, gates, findings[],
raw}`). Each finding carries the rule, engine, severity, message, file, and line, which is enough for
a one-line comment per violation. Keep the mapping from Code Analyzer's own JSON into `findings[]`
inside `scripts/checks/` so a plugin upgrade is a one-file change.

## 9. Metrics worth tracking

| Metric | Source | Target |
| --- | --- | --- |
| Violations at severity 1-3 on changed files | `vf-check analyzer --changed` | 0 |
| Total unsuppressed violations | nightly `--no-suppressions` run | monotonically decreasing |
| Sum of `max_suppressed_violations` | `config/code-analyzer.yml` | monotonically decreasing |
| Suppressions without a ticket in `reason` | `grep` + config read | 0 |
| Apex org coverage | `vf-check apex` | >= `gates.apexOrgCoverageMin` |
| Jest coverage | `vf-check jest` | >= `gates.jestCoverageMin` |
| Gate wall time | report `durationMs` | PR gate under a few minutes |

## 10. Failure playbook

| Symptom | Cause | Action |
| --- | --- | --- |
| `vf-check analyzer` exits `2` with a Java message | no JDK 11+ on PATH | install a JDK, or set `engines.pmd.java_command` / `engines.sfge.java_command`; disabling these engines is a policy change, not a fix |
| `flow` engine errors | no Python 3.10+ | install Python or set `engines.flow.disable_engine: true` for that environment |
| `eslint` engine error mentioning a plugin version | base config and project config conflict | set the matching `disable_*_base_config` in `code-analyzer.yml` |
| Thousands of ESLint violations appear suddenly | selector widened from `eslint:Recommended` to `eslint` | restore the `:Recommended` suffix |
| `sfge` `LimitReached` or `Timeout` violations | path explosion | raise `java_max_heap_size`, `java_thread_count`, `java_thread_timeout`; narrow `--target` |
| Formatting check fails on files nobody touched | Prettier or plugin version drift | pin versions in `package.json`, run `vf-check format --fix` in a dedicated PR |
| Analyzer passes locally, fails in CI | different plugin version or missing config file | pass `--config-file config/code-analyzer.yml` explicitly in both places; pin the plugin version in CI |
| A rule disappears after a plugin upgrade | rule renamed or retagged upstream | diff `sf code-analyzer rules --rule-selector all --output-file rules.json` before and after the upgrade |
