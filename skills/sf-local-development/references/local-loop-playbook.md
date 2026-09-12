# Local Loop Playbook

Command-by-command procedures for the first run on a machine, the daily development loop, and the
handoff checkpoint before wave 3 (deploy). Every command uses `sf` v2 syntax with an explicit
`--target-org`.

Aliases follow `.vibeforce/config.json`: `vf-dev`, `vf-int`, `vf-uat`, `vf-prod`. Never target
`vf-prod` from this playbook.

## 1. First run on a new machine

```bash
# 1. toolchain
sf --version
node --version
sf update

# 2. project dependencies (Jest, ESLint, Prettier, plugins)
npm ci

# 3. authorize the dev org
sf org login web --alias vf-dev --set-default
sf org list --all

# 4. confirm the project is a valid DX project with an lwc directory
sf project deploy preview --target-org vf-dev
```

If `npm ci` has no lockfile yet, use `npm install` once and commit `package-lock.json`.

## 2. First run against a fresh scratch org

```bash
sf org create scratch \
  --definition-file config/project-scratch-def.json \
  --alias vf-dev --duration-days 7 --set-default

sf project deploy start --target-org vf-dev
sf org assign permset --name Vf_App_Access --target-org vf-dev
sf data import tree --plan ./data/data-plan.json --target-org vf-dev

sf org open --target-org vf-dev
```

Scratch org definition, features, and shape belong to skill `sf-scratch-orgs-sandboxes`; data plans
belong to skill `sf-data-management`.

## 3. Daily loop for an LWC slice

```bash
# pane 1: live preview of the component under construction
sf lightning dev component --name accountCard --target-org vf-dev

# pane 2: unit tests in watch mode
npm run test:unit:watch

# pane 3: commands
```

Cycle:

1. Edit `accountCard.html` / `.js` / `.css`. The preview reloads; the watch run re-executes the
   suite for that bundle.
2. When the public API, a wire adapter, a new `@salesforce` import, or `.js-meta.xml` changes:
   ```bash
   sf project deploy start --source-dir force-app/main/default/lwc/accountCard --target-org vf-dev
   ```
   Refresh the browser (component preview) or restart the server (app/site preview).
3. Before every commit:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed
   ```
4. Fix formatting automatically when the gate reports `format` failures:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" format --changed --fix
   ```

## 4. Daily loop for an Apex slice

There is no local Apex runtime; the loop is compile-and-probe.

```bash
# 1. compile server-side without saving
sf project deploy start --source-dir force-app/main/default/classes --dry-run --target-org vf-dev

# 2. save it once it compiles
sf project deploy start --source-dir force-app/main/default/classes --target-org vf-dev

# 3. run only the relevant tests, synchronously, with coverage
sf apex run test --tests AccountServiceTest --synchronous \
  --code-coverage --result-format human --target-org vf-dev

# 4. probe behaviour interactively
sf apex run --file scripts/apex/probe.apex --target-org vf-dev

# 5. read the log if something surprises you
sf apex list log --target-org vf-dev
sf apex get log --number 1 --target-org vf-dev
```

`scripts/apex/probe.apex`:

```apex
// probe only - never a substitute for an @IsTest class
List<Case> open = [
    SELECT Id, CaseNumber, Priority
    FROM Case
    WHERE IsClosed = false
    WITH USER_MODE
    ORDER BY CreatedDate DESC
    LIMIT 5
];
System.debug(LoggingLevel.ERROR, 'open=' + open.size());
for (Case c : open) {
    System.debug(LoggingLevel.ERROR, c.CaseNumber + ' ' + c.Priority);
}
```

Coverage gates (`apexOrgCoverageMin` 85, `apexClassCoverageMin` 75) are enforced by
`vf-check apex`; see skills `sf-apex-testing` and `sf-governor-limits`.

## 5. Keeping project and org in sync

```bash
# before starting work in the morning
sf project retrieve preview --target-org vf-dev     # what changed in the org
sf project retrieve start --target-org vf-dev       # pull it

# before deploying
sf project deploy preview --target-org vf-dev       # what would go up, what conflicts
```

Conflict resolution, in order of preference:

1. Read the preview table and decide per component.
2. Retrieve the org version, diff it in git, and merge by hand.
3. Only for a disposable scratch org: `sf project deploy start --ignore-conflicts --target-org vf-dev`.

Never pass `--ignore-conflicts` against a shared sandbox.

## 6. Seeding data for a preview

```bash
# bulk plan (relationships preserved)
sf data import tree --plan ./data/data-plan.json --target-org vf-dev

# one record
sf data create record --sobject Account --values "Name='Acme' Rating='Hot'" --target-org vf-dev

# confirm what the component will see
sf data query --query "SELECT Id, Name, Rating FROM Account ORDER BY CreatedDate DESC LIMIT 5" \
  --target-org vf-dev

# export a realistic payload to use as a Jest fixture
sf data query --query "SELECT Id, CaseNumber, Subject FROM Case LIMIT 3" --json --target-org vf-dev \
  > force-app/main/default/lwc/casePanel/__tests__/data/cases.json
```

Trim exported JSON to the shape the component actually consumes before committing it.

## 7. Preview an app or Experience site

```bash
# Lightning app
sf lightning dev app --name "Service Console" --device-type desktop --target-org vf-dev

# after a non-hot-reloadable change
sf project deploy start --source-dir force-app --target-org vf-dev
# stop the dev server (CTRL-C) and start it again

# Experience LWR site (publish it in Experience Builder first)
sf lightning dev site --name "Partner Central" --get-latest --target-org vf-dev
```

For a site, the order after any structural change is: deploy, republish the site, restart the
server.

## 8. Handoff checkpoint (end of wave 1 / wave 2)

```bash
# 1. offline gate
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed --json

# 2. server-side compile of everything the slice touches
sf project deploy start --source-dir force-app --dry-run --target-org vf-dev

# 3. nothing unexpected is pending
sf project deploy preview --target-org vf-dev

# 4. visual confirmation
sf lightning dev component --name accountCard --target-org vf-dev
```

Checklist before declaring the slice done:

| Item | Proof |
| --- | --- |
| Component renders with real org data | Live Preview screenshot or observation |
| All branches covered by tests | `vf-check jest` coverage report |
| No lint or analyzer findings at or above severity 3 | `vf-check local` output |
| Apex contract matches `.vibeforce/state/contract.md` | Signature diff |
| No leftover demo data, `console.log`, or `TODO` in the bundle | `vf-check lint` plus a read of the diff |
| Ownership respected (only `lwc/` and `aura/` paths touched by the LWC slice) | `git status` |

## 9. Cleanup

```bash
sf org list --all
sf org delete scratch --target-org vf-dev --no-prompt
```

Delete scratch orgs you no longer need: active scratch org count is a limited resource in the Dev
Hub (skill `sf-scratch-orgs-sandboxes`).

## 10. Command index for this loop

| Purpose | Command |
| --- | --- |
| Refresh CLI | `sf update` |
| Authorize org | `sf org login web --alias vf-dev --set-default` |
| List orgs | `sf org list --all` |
| Create scratch org | `sf org create scratch --definition-file config/project-scratch-def.json --alias vf-dev` |
| Open org | `sf org open --path lightning/setup/SetupOneHome/home --target-org vf-dev` |
| Preview deploy | `sf project deploy preview --target-org vf-dev` |
| Check-only deploy | `sf project deploy start --dry-run --target-org vf-dev` |
| Deploy | `sf project deploy start --source-dir <dir> --target-org vf-dev` |
| Preview retrieve | `sf project retrieve preview --target-org vf-dev` |
| Retrieve | `sf project retrieve start --target-org vf-dev` |
| Component preview | `sf lightning dev component --name <bundle> --target-org vf-dev` |
| App preview | `sf lightning dev app --name "<App>" --target-org vf-dev` |
| Site preview | `sf lightning dev site --name "<Site>" --target-org vf-dev` |
| Anonymous Apex | `sf apex run --file scripts/apex/probe.apex --target-org vf-dev` |
| Apex tests | `sf apex run test --tests <Class> --synchronous --target-org vf-dev` |
| Query data | `sf data query --query "<SOQL>" --target-org vf-dev` |
| Offline gate | `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed` |

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/get-started-test-components.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_start.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_preview.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_retrieve_start.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_run.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_org_open.html
- https://github.com/trailheadapps/lwc-recipes/blob/main/README.md (scratch org, permset, data plan sequence)
