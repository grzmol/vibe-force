# Local vs Org Capability Matrix

What can be proven offline, what needs a scratch org, what needs a sandbox, and what only
production can answer. Use this to decide where to spend a verification cycle instead of deploying
by reflex.

## 1. Verification capability matrix

| Capability | Offline (no org) | Scratch org | Sandbox | Production |
| --- | --- | --- | --- | --- |
| Prettier formatting | Yes | - | - | - |
| ESLint on LWC/Aura JS | Yes | - | - | - |
| `sf code-analyzer run` (PMD, ESLint, Regex, RetireJS) | Yes | - | - | - |
| LWC unit tests (`sfdx-lwc-jest`) | Yes | - | - | - |
| LWC template compile errors | Mostly (Jest/ESLint) | Full at deploy | Full at deploy | Full at deploy |
| Apex syntax and semantics | No | `--dry-run` deploy | `--dry-run` deploy | `deploy validate` |
| Apex unit tests and coverage | No | Yes | Yes | Yes (validate) |
| SOQL results | No | Yes (seeded data) | Yes (realistic data) | Yes (real data) |
| Sharing rules and FLS | No | Partially (config must be deployed) | Yes | Yes |
| Validation rules, flows, approval processes | No | Yes | Yes | Yes |
| Named credentials and callouts | No | Only to reachable endpoints | Yes (integration endpoints) | Yes |
| Platform events, CDC | No | Yes | Yes | Yes |
| Governor limit behaviour under volume | No | Weak (little data) | Yes (data-loaded sandbox) | Definitive |
| Managed package interactions | No | Only if installed | Yes | Yes |
| Real user profiles and permission set assignments | No | Synthetic | Realistic | Definitive |
| Experience Cloud site rendering | No | Yes (published site) | Yes | Yes |
| Performance and page-load profiling | No | Misleading | Indicative | Definitive |
| Component rendering with live org data | No | Yes via Live Preview | Yes via Live Preview | Not recommended |

## 2. Which environment for which question

| Question | Cheapest environment that answers it |
| --- | --- |
| Does this template render the right branch? | Offline - Jest |
| Does this getter compute correctly? | Offline - Jest |
| Does the component call Apex with the right arguments? | Offline - Jest mock assertion |
| Does the Apex class compile? | Scratch org - `--dry-run` deploy |
| Does the SOQL return what I expect? | Scratch org - `sf data query` |
| Does the trigger bulkify to 200 records? | Scratch org - Apex test with 200 records |
| Does FLS hide the field for the support profile? | Sandbox - assign the real profile |
| Does the integration callout succeed? | Sandbox with the integration endpoint |
| Will the deploy pass the org's test suite? | Sandbox - `sf project deploy validate` |
| Is the release safe for users? | Production - `deploy validate` + `deploy quick` + smoke |

## 3. Cost of each loop

| Loop | Typical duration | Notes |
| --- | --- | --- |
| Jest watch rerun | Under a second | Highest-frequency loop; keep it green |
| ESLint / Prettier on changed files | Seconds | Automatable with `--fix` |
| Code Analyzer on changed files | Seconds to a minute | Scales with rule set and file count |
| Live Preview hot reload | Near-instant | Only for `.js`, `.html`, `.css` changes |
| `sf project deploy start --source-dir <one bundle>` | Tens of seconds | Use the narrowest `--source-dir` |
| `sf project deploy start --dry-run` over `force-app` | Minutes | Compiles everything; run at checkpoints |
| `sf apex run test --synchronous --tests <Class>` | Seconds to minutes | Synchronous run needed for deterministic output |
| `sf project deploy validate` with `RunLocalTests` | Many minutes | Wave 3 only |
| Scratch org creation plus source deploy plus seed | Several minutes | Automate it; never do it by hand per change |

Rule of thumb: never buy an expensive loop to answer a question a cheaper loop can answer. The
wave model exists to keep expensive loops out of waves 1 and 2.

## 4. Source tracking by org type

| Org type | Source tracking | Consequence |
| --- | --- | --- |
| Scratch org | On by default (off with `--no-track-source` at creation) | `deploy preview` / `retrieve preview` show conflicts; `--ignore-conflicts` applies |
| Sandbox | On by default (off with `--no-track-source` at creation) | Same, but conflicts are usually another developer's work - resolve, do not override |
| Developer Edition / trial | Not source-tracked | Conflict flags have no effect; deploys always overwrite |
| Production | Never source-tracked | `--ignore-conflicts` has no effect; only `deploy validate` + `deploy quick` are safe |

## 5. Data availability

| Environment | Data source | How to seed |
| --- | --- | --- |
| Offline | None | Jest fixtures under `__tests__/data/` |
| Scratch org | Empty at creation | `sf data import tree --plan data/plan.json --target-org vf-dev` |
| Sandbox (Developer) | Metadata only | Same tree import, or a dataset script |
| Sandbox (Partial Copy) | Sample of production per template | Refresh cadence governs freshness |
| Sandbox (Full Copy) | Complete production copy | Long refresh interval; data masking required |
| Production | Real | Never write test data |

Details on sandbox types and refresh intervals: skill `sf-scratch-orgs-sandboxes`. Seeding
strategy: skill `sf-data-management`.

## 6. What Live Preview does and does not prove

| Proves | Does not prove |
| --- | --- |
| Markup, styling, and layout against real org data | That FLS hides the fields for other profiles |
| Wire adapters resolve and return data for the running user | That sharing rules behave for other users |
| Apex controllers are reachable and return the expected shape | That Apex tests pass or coverage is sufficient |
| Component composition and event wiring in a real page context | That the deploy will succeed |
| That the `.js-meta.xml` targets already deployed are correct | That an edited `.js-meta.xml` is valid - it does not hot-reload |

Live Preview is manual verification. It never replaces `vf-check jest`, `vf-check apex`, or
`vf-check smoke`.

## 7. Mapping to vibe-force checks

| Check | Org required | Environment it belongs in |
| --- | --- | --- |
| `format`, `lint`, `analyzer`, `jest`, `static`, `local` | No | Developer machine and CI, waves 1-2 |
| `apex` | Yes | Scratch org or sandbox, wave 2 (org-side) and wave 4 |
| `deploy-validate` | Yes | Target org, wave 3 |
| `deploy-quick` | Yes | Target org, wave 3 |
| `smoke` | Yes | Target org, wave 4 |
| `verify` | Yes | Target org, wave 4 |
| `all` | Yes | Full pipeline |

## 8. Failure-cost asymmetry

| Mistake caught in | Cost |
| --- | --- |
| Jest | Seconds; no org state changed |
| Code Analyzer | Seconds; no org state changed |
| `--dry-run` deploy | Minutes; nothing saved |
| `deploy validate` | Tens of minutes; nothing saved |
| `deploy start` to a sandbox | Requires a corrective deploy |
| `deploy start` to production | Incident; requires a rollback deploy and possibly data repair |

This asymmetry is the entire justification for the offline gate. A change that skips `vf-check
local` and fails in wave 3 costs three orders of magnitude more time than one that fails in wave 2.

## 9. Choosing the org for a slice

| Slice | Org | Rationale |
| --- | --- | --- |
| New LWC with mocked data | None (Jest) plus a scratch org for Live Preview | Fastest loop; no shared state |
| New Apex service and tests | Scratch org | Deterministic, disposable, source-tracked |
| Trigger change on a high-volume object | Sandbox with representative data | Governor limits and recursion only show up with volume |
| Integration with an external system | Sandbox wired to the integration endpoint | Named credentials and IP allow-lists exist there |
| Permission set or profile change | Sandbox with real profiles | Scratch org profiles are synthetic |
| Managed package interaction | Sandbox or a scratch org with the package installed | Package namespace must exist |
| Release rehearsal | Full or Partial Copy sandbox | Closest approximation to production |

## 10. Offline-first checklist before requesting an org

| Question | Answer it offline first |
| --- | --- |
| Does the component render the right branch for each state? | Jest with fixture data |
| Are the Apex method names and argument shapes correct? | `.vibeforce/state/contract.md` plus Jest argument assertions |
| Is the code formatted and lint-clean? | `vf-check format`, `vf-check lint` |
| Are there security or quality findings? | `vf-check analyzer` |
| Is every LWC bundle covered by tests? | `vf-check jest` |

Only questions that survive this checklist justify an org round trip. That discipline is what keeps
wave 1 and wave 2 parallel: agents that do not contend for an org do not block each other.

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/get-started-test-components.html (Live Preview scope, recommended org types, limitations)
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_start.html (source tracking availability, `--dry-run`, test levels)
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_retrieve_start.html (source tracking and `--ignore-conflicts`)
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_data_import_tree.html (plan-based seeding)
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_run_test.html
