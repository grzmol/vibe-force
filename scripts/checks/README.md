# vibe-force check runner

Single entry point for every deterministic check the harness runs: local component checks before a
deploy, and org verification after one.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" <check> [options]
```

Node 20 or later, ESM, zero npm dependencies (`node:` builtins only). External tools are invoked
as child processes without a shell.

## Checks

| check | org | what it runs |
| --- | --- | --- |
| `format` | no | `prettier --check` (or `--write` with `--fix`) on Apex, LWC, XML, JS, MD, YAML |
| `lint` | no | `eslint --format json` on LWC and Aura JavaScript |
| `analyzer` | no | `sf code-analyzer run` with `config/code-analyzer.yml` |
| `pairing` | no | every Apex class has a test class, every LWC module has a Jest spec |
| `jest` | no | `sfdx-lwc-jest -- --coverage` plus the line-coverage gate |
| `static` | no | `format` + `lint` + `analyzer` + `pairing` |
| `local` | no | `static` + `jest` - the full local gate run in wave 2 |
| `apex` | yes | `sf apex run test --code-coverage` plus org and per-class coverage gates |
| `deploy-validate` | yes | `sf project deploy validate` (or `deploy start --dry-run`), records the job id |
| `deploy-quick` | yes | `sf project deploy quick --job-id <recorded id>` |
| `smoke` | yes | deploy report, anonymous Apex, SOQL probes, org limits, debug-log scan |
| `verify` | yes | `apex` + `smoke` |
| `all` | yes | `local` + `apex` + `smoke` |

## Options

| flag | meaning |
| --- | --- |
| `--changed` | only files changed vs `git merge-base <base-ref> HEAD`, plus the working tree |
| `--files <glob,...>` | explicit comma-separated globs (`*`, `**`, `?`, `{a,b}`, `[a-z]`) |
| `--target-org, -o <alias>` | org alias for org-touching checks |
| `--env <key>` | resolve the alias from `config.orgs[<key>]` |
| `--test-level <level>` | `NoTestRun`, `RunSpecifiedTests`, `RunLocalTests`, `RunAllTestsInOrg`, `RunRelevantTests` |
| `--tests <names>` | comma-separated `Class` or `Class.method` entries |
| `--class-names <names>` / `--suite-names <names>` | Apex test classes or suites (`apex` only) |
| `--job-id <id>` | explicit deploy job id (`deploy-quick`, `smoke`) |
| `--manifest <path>` | deploy a `package.xml` instead of source directories |
| `--validate-strategy <s>` | `auto` (default), `validate`, `dry-run` |
| `--apex-file <path>` | anonymous Apex script for `smoke` |
| `--wait <minutes>` | CLI wait window for `apex` and the deploy checks |
| `--base-ref <ref>` | git baseline for `--changed` |
| `--project-dir <path>` | Salesforce DX project root |
| `--report <path>` | write the JSON report here instead of `.vibeforce/reports/` |
| `--fix` | autofix where supported: prettier `--write`, eslint `--fix`, jest `--updateSnapshot` |
| `--strict` | a skipped step inside a composite fails the composite |
| `--json` | stdout carries the report object and nothing else |
| `--quiet` | suppress the human summary |

## Exit codes

| code | meaning |
| --- | --- |
| 0 | every gate passed |
| 1 | a gate failed (unformatted files, lint errors, violations, test failures, coverage below floor) |
| 2 | misconfiguration or a missing tool: no `sfdx-project.json`, unknown check, bad JSON, production guard, tool not installed |
| 3 | org or network error: cannot authenticate, CLI command failed against the org, org timeout |

A check requested directly that ends up `skipped` exits 2, because it proved nothing. The same
skip inside a composite is a warning; `--strict` turns it into a failure.

## Project resolution and configuration

Project root, in order: `--project-dir`, `$CLAUDE_PROJECT_DIR`, the nearest ancestor of the
working directory containing `sfdx-project.json`, then the working directory. Every check requires
`sfdx-project.json`; without it the runner exits 2 with a scaffold hint.

Configuration is `<project>/.vibeforce/config.json` merged over
`config/vibe-force.defaults.json`. The merge is shallow per top-level key, and when both sides
hold a plain object its own keys are merged one level deeper, so a project can override
`gates.jestCoverageMin` without restating the other gates. Arrays replace.

## Gates

| gate | source | applied by |
| --- | --- | --- |
| `apexOrgCoverageMin` | `summary.orgWideCoverage` | `apex` |
| `apexClassCoverageMin` | `codecoverage[].percentage` | `apex` |
| `jestCoverageMin` | `coverage-summary.json` `total.lines.pct` | `jest` |
| `analyzerFailSeverity` | Code Analyzer violation severity (1 Critical .. 5 Info) | `analyzer` |
| `requireTestForApexClass` | file-system pairing | `pairing` |
| `requireJestForLwc` | file-system pairing | `pairing` |

Findings whose numeric severity is at or below `analyzerFailSeverity` are blocking.

## Reports

Every run writes `<project>/.vibeforce/reports/<check>-<timestamp>.json` (temp file + rename;
`:` and `.` replaced with `-` so the name is valid on Windows and sorts chronologically). The
directory is pruned to `reports.keep` files, default 50.

```json
{
  "check": "local",
  "startedAt": "2026-09-12T10:15:04.118Z",
  "durationMs": 48213,
  "status": "failed",
  "exitCode": 1,
  "detail": "4/5 passed, failed: jest",
  "gates": [{ "name": "jest.jestLineCoverage", "actual": 71.4, "required": 80, "comparator": ">=", "unit": "%", "status": "failed" }],
  "findings": [{ "severity": 1, "severityLabel": "critical", "file": "force-app/.../x.test.js", "line": 12, "rule": "jest/test-failure", "message": "...", "engine": "jest" }],
  "steps": [{ "check": "format", "status": "passed", "durationMs": 812, "detail": "37 files checked, 0 unformatted", "exitCode": 0 }],
  "context": { "projectRoot": "...", "targetOrg": null, "mode": {}, "configSources": {}, "apiVersion": "67.0", "node": "v20.19.0" },
  "raw": {}
}
```

Keys listed in `reports.redactKeys` (`accessToken`, `sfdxAuthUrl`, `refreshToken`,
`clientSecret`, `password`) are replaced with `[redacted]` before anything is written. `sf org
display` is therefore called without `--verbose`: the verbose form prints `sfdxAuthUrl`, which
carries a refresh token.

## Production guard

An alias listed in `productionAliases` is production. Org-mutating checks (`apex`) refuse to run
and exit 2 unless `VF_ALLOW_PROD=1`. The deploy family and the read-only `smoke` probes run but
print a banner on stderr naming the org and the check.

## Environment

| variable | effect |
| --- | --- |
| `VF_ALLOW_PROD=1` | allow org-mutating checks against a production alias |
| `VF_SKIP_CHECKS=1` | exit 0 immediately without running anything |
| `VF_DEBUG=1` | print a stack trace for unexpected failures |
| `CLAUDE_PROJECT_DIR` | default project root |
| `CLAUDE_PLUGIN_ROOT` | plugin root used by callers to build the `node` command |

## Commands the runner issues

| check | command |
| --- | --- |
| `format` | `prettier --check\|--write --config <cfg> --ignore-path ... <files>` |
| `lint` | `eslint --format json [--fix] <files>` |
| `analyzer` | `sf code-analyzer run --workspace <dir> [--target <file>] --rule-selector <sel> --severity-threshold <n> --config-file <yml> --output-file <json> --view table` |
| `jest` | `sfdx-lwc-jest -- --coverage --json --outputFile <f> --coverageDirectory <d> --coverageReporters=json-summary` |
| `apex` | `sf apex run test --target-org <alias> --code-coverage --result-format json --json --wait <n> [--tests\|--class-names\|--suite-names\|--test-level]` |
| `deploy-validate` | `sf project deploy validate --target-org <alias> --test-level <level> [--tests] [--source-dir\|--manifest] --wait <n> --json`, or `sf project deploy start --dry-run --ignore-conflicts ...` |
| `deploy-quick` | `sf project deploy quick --job-id <id> --target-org <alias> --wait <n> --json` |
| `smoke` | `sf org display --json`, `sf project deploy report --job-id <id> --json`, `sf apex run --file <apex> --json`, `sf data query --query <soql> [--use-tooling-api] --json`, `sf org list limits --json`, `sf apex list log --json` |

`sf org list limits` is the canonical command; `sf limits api display` is a deprecated alias.
`sf apex list log` is canonical; `sf force apex log list` is the deprecated alias.

Tool binaries are resolved in this order: an absolute path in `config.tooling.<key>`, then
`<project>/node_modules/.bin/<tool>`, then `npx --no-install <tool>` so a missing dependency fails
fast instead of downloading. `sf`, `git` and `node` are expected on `PATH`.

## Deploy job state

A successful `deploy-validate` (strategy `validate`) appends to
`<project>/.vibeforce/state/deploy-jobs.json`:

```json
{ "jobs": [{ "jobId": "0Af0x000017yLUFCA2", "targetOrg": "vf-prod", "createdAt": "2026-09-12T10:15:04.118Z", "testLevel": "RunLocalTests", "componentCount": 128, "status": "Succeeded" }] }
```

`deploy-quick` uses the newest `Succeeded` entry for the target org and refuses when none exists
or the entry is older than `deploy.quickJobMaxAgeDays` (10, matching the documented validated-job
lifetime). After a successful quick deploy the entry is rewritten with `status: "Deployed"` so it
is not offered again.

With `deploy.validateStrategy: "auto"` a production alias gets `sf project deploy validate` (which
yields a quick-deployable job id) and any other alias gets `sf project deploy start --dry-run`,
following the Salesforce CLI guidance that `deploy validate` is a production command. A dry run
produces no reusable job id, which is why `deploy-quick` targets production.

## Module layout

| file | responsibility |
| --- | --- |
| `vf-check.mjs` | argv parsing (`util.parseArgs`), project/config resolution, dispatch, report write, exit code |
| `lib/result.mjs` | exit codes, statuses, findings, gates, `VfError` |
| `lib/config.mjs` | project discovery, config merge, package directories |
| `lib/log.mjs` | human status lines, findings list, gates line, `--json` emission |
| `lib/run.mjs` | spawn wrapper, timeouts, JSON extraction, missing-tool detection, tool resolution |
| `lib/git.mjs` | `--changed` baseline and diff |
| `lib/files.mjs` | glob matching, tree walk, metadata classification, deploy scoping |
| `lib/report.mjs` | report shape, redaction, atomic write, pruning |
| `lib/gates.mjs` | coverage, count and severity gate evaluation |
| `lib/state.mjs` | `.vibeforce/state/deploy-jobs.json` |
| `lib/org.mjs` | target-org resolution, production guard, `sf org display` |
| `lib/format.mjs` `lib/lint.mjs` `lib/analyzer.mjs` `lib/pairing.mjs` `lib/jest.mjs` | local checks |
| `lib/apex.mjs` `lib/deploy.mjs` `lib/smoke.mjs` | org checks |
| `lib/composite.mjs` | `static`, `local`, `verify`, `all` sequencing and degradation |

## References

- [Salesforce CLI Command Reference](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference.html)
- [`project deploy validate`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_validate.html)
- [`project deploy quick`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_quick.html)
- [`project deploy report`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_report.html)
- [`apex run test`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_run_test.html)
- [`apex run`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_run.html)
- [`apex list log`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_list_log.html)
- [`data query`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_data_query.html)
- [`org display`](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_org_display.html)
- [Code Analyzer CLI commands](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/analyze.html)
- [Code Analyzer JSON output schema](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/output-schemas-json.html)
- [Code Analyzer top-level configuration](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/config-toplevel.html)
- [Code Analyzer PMD engine](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/engine-pmd.html)
- [sfdx-lwc-jest](https://github.com/salesforce/sfdx-lwc-jest#configuration)
- [prettier CLI](https://prettier.io/docs/en/cli)
