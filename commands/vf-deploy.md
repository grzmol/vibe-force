---
description: Production-safe Salesforce deploy - require a green local gate, run a check-only validation, show the job id and test summary, and deploy the validated job only after explicit confirmation.
argument-hint: "[target-org]"
allowed-tools: Read, Grep, Glob, Bash(node:*), Bash(sf org display:*), Bash(sf project deploy report:*), Task
disable-model-invocation: true
---

# vf-deploy - validated deploy with a confirmation stop

Raw arguments: `$ARGUMENTS`

`ALIAS` = the first argument, or the `dev` entry in `<project>/.vibeforce/config.json` `orgs` when no argument
was given. Always pass `--target-org <ALIAS>` explicitly; never rely on the CLI's ambient default org.

This command has a hard stop in the middle. Steps 1 to 4 run in one turn. Step 6 runs only after the user
answers. Never collapse them.

## 1. Preconditions

| Check | How | Fail action |
| --- | --- | --- |
| Project is initialised | `<project>/.vibeforce/config.json` exists | Stop: run `/vf-init` |
| Alias is known | `ALIAS` appears in `orgs`, or the user passed it explicitly | Stop and list the configured aliases |
| Org is reachable | `sf org display --target-org <ALIAS> --json` | Stop: report the auth error |
| Working tree is deployable | `git status --short` | Report untracked or modified metadata that is about to be deployed, or is about to be left behind |

Record from `sf org display`: `username`, `instanceUrl`, `apiVersion`, and whether the org is a sandbox.

## 2. Production guard

`ALIAS` is a production target when it is listed in `productionAliases` in `.vibeforce/config.json`, or when
`sf org display` shows a non-sandbox, non-scratch org.

For a production target, all three must hold before you run anything that writes to the org:

1. The user named the alias explicitly in the command arguments. A production deploy is never the default.
2. `VF_ALLOW_PROD=1` is set in the environment. If it is not set, stop and print the exact export line the user
   has to run. Do not set it yourself, and do not inline it into the deploy command.
3. The user confirms at step 5 after seeing the validation summary.

Any one missing: stop and report which one. There is no override path inside this command.

## 3. Local gate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --json
```

Run the whole gate, not `--changed`. Exit `0` is required to continue.

Exit `1`: stop and hand the findings to `/vf-check local` for the fix plan. Exit `2`: stop, report the missing
tool. Never continue with `VF_SKIP_CHECKS=1`; that variable exists for hook-level emergencies, not for this
command.

## 4. Validate

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-validate --target-org <ALIAS> --json
```

The runner wraps `sf project deploy validate`, which is check-only, always runs Apex tests, and returns a job id
rather than deploying. It records the job id in `<project>/.vibeforce/state/deploy-jobs.json`. The default test
level is `RunLocalTests`; `testLevels.production` and `testLevels.sandbox` in `.vibeforce/config.json` decide
which one this run uses.

A validated job id is valid for **10 days**. `sf project deploy validate` is aimed at production orgs - for a
sandbox the equivalent is `sf project deploy start --dry-run --test-level RunLocalTests`, which the runner
selects for you based on the target.

On failure, report the component errors (file, line, problem) and the failed tests with their messages, then
stop. Do not retry the same payload and do not downgrade the test level to get past it.

## 5. Confirmation stop

Print this summary and **end the turn**:

```text
target org   : <ALIAS>  (<username> @ <instanceUrl>)  [production|sandbox|scratch]
validated job: <job id>   (valid 10 days from <validation time>)
components   : <n> to deploy, <n> to delete
tests        : <test level>, <passed> passed, <failed> failed, <coverage>% org coverage
gates        : local PASS, coverage <actual> vs <min>
```

Then ask, in plain text, for confirmation to run the quick deploy against that exact alias. State that the quick
deploy skips the Apex tests because the validation already ran them, and that it overwrites the corresponding
metadata in the org without merging.

Do not run step 6 in the same turn. Do not treat "looks good", a thumbs-up, or silence as confirmation for a
production alias - require the alias to be repeated back.

## 6. Quick deploy (only after confirmation)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-quick --target-org <ALIAS> --job-id <job id> --json
```

If the recorded job id is older than 10 days, it is dead: go back to step 4 and validate again.

Poll or report status with `sf project deploy report --job-id <job id> --target-org <ALIAS>` when the runner
returns before the deploy settles.

## 7. Report and hand off

| Field | Value |
| --- | --- |
| Alias / instance | |
| Job id | |
| Status | Succeeded / Failed / Partial |
| Components deployed | |
| Duration | |
| Report file | `.vibeforce/reports/deploy-quick-<ISO>.json` |

On success, the next step is `/vf-verify <ALIAS>`. Say so.

On failure, list the component errors, state that the org may be in a partially deployed state, and recommend
either a forward fix or a redeploy of the previous known-good source. For a production failure, delegate the
recovery plan to `sf-deploy-engineer` rather than improvising it here.
