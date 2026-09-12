---
description: Bootstrap a Salesforce DX project for vibe-force - detect or scaffold sfdx-project.json, install templates, write .vibeforce/config.json with real org aliases, and print the resulting gate configuration.
argument-hint: "[project-dir]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node:*), Bash(sf org list:*), Bash(sf org display:*), Bash(sf config:*), Bash(sf template generate project:*), Bash(git rev-parse:*)
---

# vf-init - bootstrap a project for vibe-force

Raw arguments: `$ARGUMENTS`

`PROJECT` = the first argument if one was given, otherwise the current working directory.
`PLUGIN` = `${CLAUDE_PLUGIN_ROOT}`.

Never overwrite an existing consumer file without showing a diff and getting an explicit answer.
Run every step below in order and report what changed. Do not run `npm install`, formatters, or tests.

## 1. Environment probe

Run these and record the results. Treat a non-zero exit as a finding, not a reason to stop:

```bash
node --version
sf --version
git -C "<PROJECT>" rev-parse --show-toplevel
```

| Condition | Action |
| --- | --- |
| `node` missing or major version < 20 | Stop. Report the required version; the check runner needs Node 20+. |
| `sf` missing | Continue, but skip steps 5 and 6 and report `sf` as a prerequisite (`npm install --global @salesforce/cli`, run by the user). |
| Not a git repository | Continue. Skip step 7 and say so. |

## 2. Detect or scaffold the Salesforce DX project

Look for `<PROJECT>/sfdx-project.json`.

- **Present**: read it. Record `packageDirectories[*].path` and `sourceApiVersion`.
- **Absent and the directory is empty**: scaffold with
  `sf template generate project --name <dirname> --output-dir <parent-of-PROJECT> --template standard --api-version 67.0`
  (`sf project generate` is the retained alias for the same command).
- **Absent and the directory is not empty**: do not scaffold blind. Show what is there, then either copy
  `${CLAUDE_PLUGIN_ROOT}/templates/sfdx-project.json` after confirming, or stop and explain.

If `sourceApiVersion` differs from `67.0` (the `apiVersion` in `${CLAUDE_PLUGIN_ROOT}/config/vibe-force.defaults.json`),
report the mismatch and offer to align it. Do not silently edit it.

## 3. Install templates

| Source under `${CLAUDE_PLUGIN_ROOT}/templates/` | Target under `<PROJECT>/` | Rule |
| --- | --- | --- |
| `.vibeforce/config.json` | `.vibeforce/config.json` | Create; if present, merge (step 4) |
| `scripts/apex/smoke.apex` | `scripts/apex/smoke.apex` | Create; if present, diff first |
| `.github/workflows/ci.yml` | `.github/workflows/ci.yml` | Create; if present, diff first |
| `sfdx-project.json` | `sfdx-project.json` | Only when absent |
| `.forceignore` | `.forceignore` | Only when absent |
| `package.json` | `package.json` | Only when absent; otherwise step 6 |
| `jest.config.js` | `jest.config.js` | Only when absent |
| `README.md` | `README.md` | Only on explicit request |
| `lwc/exampleCardFixtures/` | `<default package dir>/main/default/lwc/` | Only on explicit request; rename per component |
| `lwc/exampleCardHarness/` | `<preview package dir>/main/default/lwc/` | Only on explicit request; preview-only directory, never the default one (skill `sf-local-development`, pattern 9) |

Diff procedure for an existing target: read both files, show a unified diff of the differences only, and ask
whether to keep the project version, take the template version, or merge specific hunks. Default to keeping the
project version when the answer is unclear.

Shared configuration is referenced, never copied. Leave these where they are and point tools at them:
`config/code-analyzer.yml`, `config/pmd/apex-ruleset.xml`, `config/eslint/eslint.config.mjs`,
`config/prettier/.prettierrc`, `config/prettier/.prettierignore`, `config/jest/jest.config.mjs`.

## 4. Write `.vibeforce/config.json`

Read `${CLAUDE_PLUGIN_ROOT}/config/vibe-force.defaults.json` and `${CLAUDE_PLUGIN_ROOT}/templates/.vibeforce/config.json`.
The project file shallow-merges over the defaults, so write only the keys that differ for this project.

Set from what you found:

| Key | Value |
| --- | --- |
| `apiVersion` | `67.0` unless `sfdx-project.json` pins a different `sourceApiVersion` that the user confirms |
| `packageDirectories` | the `path` values from `sfdx-project.json` |
| `orgs` | filled in step 5 |
| `productionAliases` | every alias that step 5 marked as production |
| `gates`, `testLevels`, `hooks` | defaults, unless the user asks for different thresholds |

Create `<PROJECT>/.vibeforce/state/` and `<PROJECT>/.vibeforce/reports/` as empty directories.

## 5. Resolve org aliases

```bash
sf org list --json --skip-connection-status
```

Parse `result.nonScratchOrgs` and `result.scratchOrgs`. For each entry use `alias` (falling back to `username`),
`instanceUrl`, `isSandbox`, and `isDevHub`. Map them onto the four config slots:

| Slot | Pick |
| --- | --- |
| `dev` | a scratch org, or a sandbox alias containing `dev` |
| `integration` | a sandbox alias containing `int`, `ci`, or `sit` |
| `uat` | a sandbox alias containing `uat`, `qa`, or `staging` |
| `prod` | a non-sandbox, non-scratch production org |

An org is production when `isSandbox` is false and it is not a scratch org. Add every such alias to
`productionAliases`. If a slot has no candidate, leave it `null` and list it in the output as unconfigured -
never guess an alias. If several candidates fit a slot, ask which one.

Confirm a production candidate with `sf org display --target-org <alias> --json` before writing it, and report
`instanceUrl` and `username` so the user can see exactly which org was mapped to `prod`.

## 6. Project `package.json` scripts

Read `${CLAUDE_PLUGIN_ROOT}/templates/package.json` and copy its `scripts` entries verbatim - never retype a
script body from memory. It ships `test`, `test:unit`, `test:unit:watch`, `test:unit:debug`,
`test:unit:coverage`, `lint`, `format`, `format:verify`, `vf:local`, and `vf:verify`.

When `<PROJECT>/package.json` already exists, add only the scripts it is missing and leave the existing ones
untouched. Report every script you skipped because the project already defined it, and every script whose
project version differs from the template version.

## 7. Ignore generated state

Append to `<PROJECT>/.gitignore`, only the lines that are not already covered:

```text
.vibeforce/state/
.vibeforce/reports/
```

Leave `.vibeforce/config.json` tracked - it is shared project configuration.

## 8. Smoke-test the runner

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" format --changed --json
```

Exit `0` or `1` both prove the runner is wired up. Exit `2` means a missing tool or bad configuration: report the
runner's message verbatim and the fix it names. Exit `3` is an org error and should not happen for `format`.

## 9. Output

Print, in this order:

1. A table of files created, files skipped, and files that differ from the template.
2. The resolved org map (`slot | alias | instance | sandbox?`), with unconfigured slots called out.
3. The active gate configuration: `apexOrgCoverageMin`, `apexClassCoverageMin`, `jestCoverageMin`,
   `analyzerFailSeverity`, `requireTestForApexClass`, `requireJestForLwc`, `hooks.mode`.
4. Any prerequisite that is still missing.
5. The next command: `/vf-check local` when the project already has source, otherwise `/vf-story "<your story>"`.
