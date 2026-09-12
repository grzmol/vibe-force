# Troubleshooting the Local Loop

Symptom-to-cause tables for Live Preview (`sf lightning dev`), source tracking, the offline gate,
and the surrounding toolchain.

## 1. Live Preview server

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| `sf lightning dev component` is not a recognized command | Live Preview plugin missing or CLI outdated | `sf update`; if it was explicitly removed, `sf plugins install @salesforce/plugin-lightning-dev` |
| CLI prompts to enable Live Preview every run | Feature not enabled in the org, or the user lacks permission | Answer `y` once with **View Setup** and **Customize Application** permissions |
| "No components found" / empty picker | No `lwc` directory in a package directory | Confirm `force-app/main/default/lwc` exists and `sfdx-project.json` lists the package directory |
| Command fails asking for a target org | `--target-org` omitted and no `target-org` config var | Pass `--target-org vf-dev` or `sf config set target-org=vf-dev` |
| Preview opens but the component is blank | The component threw during construction or the wire never provisioned | Open the browser console; check `@api` inputs and the wire configuration |
| Edits to `.js`/`.html`/`.css` do not appear | The change is one of the non-reloadable kinds (public API, wire, new scoped import, `.js-meta.xml`) | Deploy the bundle, then restart the server (app/site) or refresh the browser (component) |
| Edits to `.js-meta.xml` do not appear | Only `.js`, `.html`, and `.css` hot-reload | Deploy and restart |
| New file in an existing bundle is ignored | CLI predates Spring '25 file detection | `sf update`, then restart the server |
| Aura component missing from the preview | Aura is not supported by Live Preview | Verify Aura directly in the org |
| Experience site preview shows stale content | The cached site bundle is old | Re-run with `--get-latest`; republish the site after structural changes |
| Experience site command fails immediately | The LWR site has never been published | Publish it in Experience Builder first |
| `--ssr` flag rejected or ignored | Not supported from Spring '26 | Remove the flag |
| Landing Page will not preview | Explicitly unsupported | Verify in the org |
| Mobile preview never starts | Xcode simulators or Android Studio emulators not installed/configured | Install the platform tooling; then `--device-type ios|android` |
| Named device not found | `--device-id` does not match an available device | Omit `--device-id` to use the first available device, or list devices in Xcode/Android Studio |
| Session expires mid-session | Org session timeout or a revoked token | `sf org login web --alias vf-dev`, restart the preview |
| Port already in use | A previous preview process is still running | Stop the old process (CTRL-C in its pane), then restart |
| Browser warns about the local certificate | Live Preview serves over a local HTTPS endpoint | Accept the local certificate for the preview host; never disable browser security globally |

## 2. Source tracking

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `deploy preview` lists conflicts you did not create | Someone (or App Builder / Setup) changed the component in the org | `sf project retrieve start`, diff in git, merge deliberately |
| Deploy overwrote an org change | `--ignore-conflicts` was used | Retrieve the overwritten component from version control or the org's file history; stop using `-c` on shared orgs |
| Local file never deploys | It matches a `.forceignore` entry | `sf project list ignored` |
| Conflict flags have no effect | The org is not source-tracked (Developer Edition, production) | Use manifests and `deploy validate` instead |
| Tracking state looks wrong after a manual git operation | Local tracking metadata out of step | `sf project reset tracking --target-org vf-dev` (scratch orgs and disposable sandboxes only) |
| Deploy says "nothing to deploy" but files changed | Changes are outside a package directory, or tracking thinks they are already deployed | Check `sfdx-project.json`; pass `--source-dir` explicitly |

`sf project delete tracking` clears all local tracking information; `sf project reset tracking`
resets local and remote tracking. Both discard information - use them on disposable orgs only.

## 3. Offline gate (`vf-check local`)

| Symptom | Cause | Resolution |
| --- | --- | --- |
| Exit code 2 | Tooling missing (`node_modules`, Salesforce CLI, Code Analyzer plugin) | `npm install`; `sf update`; re-run |
| Exit code 1 on `format` | Files are not Prettier-formatted | `vf-check format --changed --fix` |
| Exit code 1 on `lint` | ESLint error-severity rule (commonly `no-console`, unused import, `@lwc/lwc/no-api-reassignments`) | Fix the code; do not add a blanket `eslint-disable` |
| Exit code 1 on `analyzer` | A violation at or above `gates.analyzerFailSeverity` | Fix it, or justify a suppression per skill `sf-code-analyzer-quality` |
| Exit code 1 on `jest` with "no tests" | `gates.requireJestForLwc` and a bundle without `__tests__` | Add the suite (skill `sf-lwc-jest-testing`) |
| Exit code 1 on `jest` coverage | Below `gates.jestCoverageMin` (80) | Cover the missing branches; do not lower the gate |
| Gate passes locally, fails in CI | Different Node version or a missing `npm ci` | Pin Node in CI; use `npm ci`, not `npm install` |
| `--changed` reports nothing | No diff against `git merge-base origin/main HEAD` | Run without `--changed`, or check the branch base |

## 4. Apex feedback loop

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `--dry-run` deploy succeeds but the real deploy fails | Test level differs, or another component changed in between | Re-run `--dry-run` with the same `--test-level` right before deploying |
| `sf apex run` reports success but nothing happened | Anonymous Apex rolled back due to an uncaught exception after partial work | Read the returned log; anonymous blocks are a single transaction |
| Anonymous Apex cannot see a class | The class is not deployed to that org | Deploy first |
| Apex test passes locally-created data but fails in the sandbox | The test depends on org data | Create data in the test (skill `sf-apex-testing`) |
| Debug output missing | Log levels too low, or the trace flag expired | `sf apex tail log --target-org vf-dev`; see skill `sf-debugging-logs` |

## 5. Toolchain and environment

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `sf: command not found` | CLI not installed or not on `PATH` | Install `@salesforce/cli`; reopen the shell |
| Commands work for one project but not another | Wrong working directory; `sf` requires a DX project for project commands | Run from the directory containing `sfdx-project.json` |
| `sf org list` shows an expired scratch org | Scratch org duration elapsed | Recreate it; automate creation (skill `sf-scratch-orgs-sandboxes`) |
| Auth works in the terminal but not in a devcontainer | `~/.sfdx` not mounted into the container | Mount the directory, or run `sf org login device` inside the container |
| VS Code Apex language server not resolving classes | Project not opened at the DX root, or the server is still indexing | Open the folder containing `sfdx-project.json`; wait for indexing |
| `SFDX: Open in Lightning Preview` missing | Salesforce Live Preview extension not installed | Install the extension from the VS Code Marketplace |
| npm scripts fail with engine warnings | Node version does not match what the installed CLI and `sfdx-lwc-jest` support | Switch to the supported Node LTS release |

## 6. Escalation order when the preview disagrees with the org

1. Refresh the browser (component preview) or restart the server (app/site preview).
2. Deploy the bundle: `sf project deploy start --source-dir <bundle> --target-org vf-dev`.
3. Confirm nothing else is pending: `sf project deploy preview --target-org vf-dev`.
4. Pull org-side drift: `sf project retrieve start --target-org vf-dev`.
5. Re-run the offline gate: `vf-check local --changed`.
6. Only then suspect the org configuration (permissions, FLS, record types) and switch to the org
   tooling in skills `sf-security-model` and `sf-debugging-logs`.

## 7. Things that are not bugs

| Observation | Explanation |
| --- | --- |
| The org reflects local edits during a preview session | Documented behaviour: hot-reloadable edits are applied to the org for the session |
| Org-side edits appear in the preview but not in your files | Documented behaviour: retrieve them with `sf project retrieve start` |
| Preview builds no longer appear in Static Resources | Removed in Spring '25; they no longer count against the 250 MB limit |
| The feature is called Live Preview in the UI but the command says `lightning dev` | Renamed in Spring '26; command names unchanged |

## 8. Diagnostic commands

| Question | Command |
| --- | --- |
| Which CLI and plugin versions am I running? | `sf version --verbose` |
| Is the org still authorized and not expired? | `sf org display --target-org vf-dev` |
| Which org is the default for this project? | `sf config list` |
| What does the org think is deployed? | `sf project deploy preview --target-org vf-dev` |
| What changed in the org since my last pull? | `sf project retrieve preview --target-org vf-dev` |
| Is this file being ignored? | `sf project list ignored` |
| Does the metadata compile? | `sf project deploy start --source-dir <dir> --dry-run --target-org vf-dev` |
| What did the last deploy actually do? | `sf project deploy report --target-org vf-dev` |
| What is the org logging right now? | `sf apex tail log --target-org vf-dev` |
| Does the record the component needs exist? | `sf data query --query "<SOQL>" --target-org vf-dev` |

## 9. Frequent root causes behind "it works locally"

| Observation | Root cause | Where to look |
| --- | --- | --- |
| Component renders in Jest but is blank in the org | The wire config depends on a record id the page never supplies | `js-meta.xml` target and `@api recordId` |
| Component renders for you but not for another user | FLS or sharing on a wired field | Skill `sf-security-model` |
| Apex returns data in anonymous Apex but not from the component | Anonymous Apex ran in your context; the controller runs `WITH USER_MODE` for the caller | Skill `sf-apex-development` |
| Deploy succeeds but the component is missing from App Builder | `isExposed` false, or no matching `<target>` | `js-meta.xml` |
| Component appears but its properties are missing in the builder | `targetConfig` missing for that target | `js-meta.xml` |
| Toast never appears | The container does not support toasts (for example an LWR site) | Skill `sf-lwc-development` |
| Preview works, deploy validation fails | LWC compiles client-side but a referenced Apex method or field does not exist in the org | `--dry-run` deploy output |

## 10. When to stop debugging locally

Escalate out of this skill when the evidence points at the org rather than the loop:

| Evidence | Next skill |
| --- | --- |
| Apex exception in a debug log | `sf-debugging-logs` |
| Permission or sharing behaviour | `sf-security-model` |
| Governor limit exceptions | `sf-governor-limits` |
| Slow SOQL or non-selective filters | `sf-soql-sosl-optimization` |
| Deployment or test-level failures | `sf-deployment-strategies` |
| Behaviour only reproducible after deploy | `sf-post-deploy-verification` |

## 11. Reporting a preview problem

Capture this before asking anyone for help, so the answer does not start with three questions:

| Item | Command |
| --- | --- |
| CLI, Node, OS, plugin versions | `sf version --verbose` |
| Exact command and flags used | Copy the full line, including `--target-org` |
| Org type and alias | `sf org display --target-org vf-dev` |
| Whether the change is hot-reloadable | Compare against the reload matrix in `references/local-dev-server.md` |
| Offline gate result | `vf-check local --changed --json` report path |
| Browser console output | Copy errors, not screenshots of them |

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/get-started-test-components.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_lightning_dev_app.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_lightning_dev_component.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_lightning_dev_site.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project.html (`project reset tracking`, `project delete tracking`, `project list ignored`)
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_preview.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_run.html
