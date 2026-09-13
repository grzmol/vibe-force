# Technical Debt Signal Catalogue

Every signal this audit looks for: how to detect it, the threshold that turns it into a finding,
the remediation, and the skill that owns the fix. Commands are read-only. Replace `vf-int` with the
alias you are auditing and run from the project root.

Limits quoted here come from skill `sf-governor-limits`; CLI flags come from skill
`sf-cli-operations`. Nothing in this file invents a limit or a flag.

## 1. Version drift

| Signal | Detection | Threshold | Remediation | Skill |
| --- | --- | --- | --- | --- |
| Metadata below the project baseline | `grep -rho "<apiVersion>[0-9.]*</apiVersion>" force-app \| sort \| uniq -c` | More than two distinct versions in one package directory | Raise on touch, in the PR that touches the file | `sf-project-structure` |
| `sourceApiVersion` behind the org | `jq -r .sourceApiVersion sfdx-project.json` vs `sf org display --target-org vf-int` | Two releases behind | Bump with a regression run, never silently | `sf-deployment-strategies` |
| Test classes on an older version than the class under test | Compare the two `-meta.xml` files | Any mismatch | Align the pair | `sf-apex-testing` |
| Managed package version behind the publisher's current | `sf package installed list --target-org vf-int` | Publisher has a newer patch | Schedule the upgrade in a sandbox first | `sf-packaging-release` |

Why it is debt: behaviour is versioned per component. A class on API 45 and its caller on API 67
can disagree about `WITH USER_MODE` defaults, null handling in SOQL, and serialization - and the
difference surfaces only at runtime.

## 2. Test debt

| Signal | Detection | Threshold | Remediation | Skill |
| --- | --- | --- | --- | --- |
| Class with no test | `vf-check pairing --json` | Any | Write the test before the next change to that class | `sf-apex-testing` |
| LWC bundle with no spec | `vf-check pairing --json` | Any | Add `__tests__/<bundle>.test.js` | `sf-lwc-jest-testing` |
| Coverage below the gate | `vf-check apex --target-org vf-int --json` | Below `gates.apexClassCoverageMin` (75) or `gates.apexOrgCoverageMin` (85) | Cover the branch, not the line count | `sf-apex-testing` |
| Assertion-free tests | `grep -rli "@isTest" force-app --include="*.cls" \| while read -r f; do grep -q "Assert\.\|System.assert" "$f" \|\| echo "$f"; done` | Any | Add behavioural assertions | `sf-apex-testing` |
| `SeeAllData=true` | `grep -rn "SeeAllData\s*=\s*true" force-app --include="*.cls"` | Any outside a documented exception | Create data in the test, or `@TestSetup` | `sf-apex-testing` |
| Tests that only run in one org | `grep -rnE "'[a-zA-Z0-9]{15,18}'" force-app --include="*Test.cls"` | Any | Build records, never reference ids | `sf-apex-testing` |
| No negative-path test for a permission | Read the test class: is there a `System.runAs` block for a user without the permission set? | Any user-facing feature | Add the denial test | `sf-security-model` |
| Flow with no test coverage | `sf data query --use-tooling-api --query "SELECT MasterLabel, ProcessType, Status FROM FlowDefinitionView WHERE Status = 'Active'"` then look for matching Apex tests | Any record-triggered Flow carrying business rules | Cover through the DML that triggers it | `sf-flow-automation` |

Coverage is a floor, not a measure of quality. Report coverage percentage and the count of
assertion-free test methods side by side; a rising first number with a rising second number is debt
being added, not removed.

## 3. Automation sprawl

| Signal | Detection | Threshold | Remediation | Skill |
| --- | --- | --- | --- | --- |
| More than one trigger per object | `grep -rho "trigger [A-Za-z0-9_]* on [A-Za-z0-9_]*" force-app --include="*.trigger" \| awk '{print $4}' \| sort \| uniq -c \| sort -rn` | 2 or more | One trigger per object, dispatching to handlers | `sf-apex-development` |
| Logic in the trigger body | `wc -l force-app/main/default/triggers/*.trigger` | More than ~20 lines | Move to a handler class | `sf-apex-development` |
| Active Workflow Rules | `SELECT MasterLabel, ProcessType, Status FROM FlowDefinitionView WHERE Status = 'Active'` (Tooling API) | Any, for automation that also has a Flow | Migrate, then deactivate | `sf-flow-automation` |
| Active Process Builders | Same query; `ProcessType` `Workflow` is a record change process, `InvocableProcess` and `CustomEvent` the other two | Any | Migrate to record-triggered Flow, then deactivate | `sf-process-builder-migration` |
| Flow and Apex writing the same field | Read the Flow metadata and grep the field API name in Apex | Any overlap | Choose one owner per field | `sf-flow-automation` |
| Recursive automation | Debug log shows the same trigger context twice | Any | Static guard in the handler, or a Flow entry condition | `sf-debugging-logs` |
| Order-dependent automation with no documentation | No `.vibeforce/state/contract.md` entry naming the order | Any object with trigger + Flow + validation rules | Document the order of execution for that object | `sf-workflow-orchestration` |

The platform does not guarantee an order between two triggers on the same object. If the audit
finds two, the correct finding is "the outcome depends on an undefined order", not "style".

## 4. Structural debt

| Signal | Detection | Threshold | Remediation | Skill |
| --- | --- | --- | --- | --- |
| Hardcoded record ids | `grep -rnE "'[a-zA-Z0-9]{15}'\|'[a-zA-Z0-9]{18}'" force-app --include="*.cls" --include="*.js"` | Any | Custom Metadata, `Schema.SObjectType` describes, or a query by developer name | `sf-minimal-change` |
| Hardcoded endpoints | `grep -rnE "https?://" force-app --include="*.cls"` | Any callout target | Named Credential plus External Credential | `sf-integration-patterns` |
| Hardcoded profile or user names | `grep -rn "System Administrator\|@example.com" force-app --include="*.cls"` | Any | Permission-set check, custom permission, or custom metadata | `sf-security-model` |
| Secrets in source | `grep -rniE "password|token|secret|api[_-]?key" force-app --include="*.cls" --include="*.js"` then read each hit | Any real value | External Credential; rotate the leaked value | `sf-security-model` |
| SOQL inside loops | `vf-check analyzer --json` (PMD `OperationWithLimitsInLoop`) | Any | Bulkify; collect ids, one query outside the loop | `sf-governor-limits` |
| No selector or service layer, queries scattered across classes | Count classes containing `[SELECT` | Queries for one object in more than three classes | Consolidate, but only where the duplication actually hurts | `sf-fflib-selector-layer` |
| Two conventions for the same job | Two trigger frameworks, two HTTP clients, two test data factories | Any | Pick one, migrate on touch | `sf-minimal-change` |
| Feature access on profiles | `ls force-app/main/default/profiles/` | Any profile carrying feature permissions | Permission sets and permission set groups | `sf-security-model` |

## 5. Dead weight

| Signal | Detection | Threshold | Remediation | Skill |
| --- | --- | --- | --- | --- |
| Unreferenced Apex class | Name-grep across `force-app` excluding its own files, after skipping tests and entry points (`@isTest`, `@AuraEnabled`, `@RestResource`, `@InvocableMethod`, `webService`, `implements Schedulable/Batchable/Queueable`) - see the loop in the skill, pattern 7 | Zero references | Delete in its own PR | `sf-minimal-change` |
| Unreferenced LWC bundle | Grep the kebab-case tag (`c-account-card`) across `force-app` | Zero references and not exposed to a target in `.js-meta.xml` | Delete | `sf-minimal-change` |
| Custom field nothing reads | `SELECT QualifiedApiName, DataType FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '<Object>'` (Tooling API) minus every API name found in source | Zero hits in Apex, LWC, Flows, layouts, reports and list views | Deprecate first, delete later | `sf-data-management` |
| Unassigned permission set | `SELECT COUNT(Id) FROM PermissionSetAssignment WHERE PermissionSet.Name = '<name>'` | Zero, and not referenced by a permission set group | Delete or document why it is staged | `sf-security-model` |
| Apex volume near the org limit | `find force-app -name "*.cls" -not -name "*Test.cls" -exec cat {} + \| wc -c` | Above 80% of 6 MB (10 MB in scratch orgs) | Delete dead code before asking support to raise it | `sf-governor-limits` |
| Deployment size | `sf project deploy preview --target-org vf-int` | Approaching 7,500 code units per deployment | Split the release | `sf-deployment-strategies` |
| Debug logging left in production code | `grep -rn "System.debug" force-app --include="*.cls" \| wc -l` | Growing release over release | Structured logging behind a switch | `sf-debugging-logs` |

Deletion needs proof, not absence of a grep hit. Reports, list views, dashboards, email templates
and Flow element references do not appear in a source grep of Apex and LWC: check `FieldDefinition`
usage and the object's metadata before proposing a field deletion.

## 6. Delivery debt

| Signal | Detection | Threshold | Remediation | Skill |
| --- | --- | --- | --- | --- |
| Components changed in the org only | `sf project retrieve preview --target-org vf-int` | Any outside the documented Setup-only list | Retrieve into source, or record an exception | `sf-deployment-strategies` |
| Source and org diverged | `sf project deploy preview --target-org vf-int` | Any unexpected component | Reconcile before the next release | `sf-deployment-strategies` |
| No package boundary | One package directory holding unrelated domains | More than one product in `force-app` | Unlocked packages by domain | `sf-packaging-release` |
| Release needs manual steps | Read the runbook: manual Setup steps per release | More than zero undocumented | Post-deploy script or metadata | `sf-post-deploy-verification` |
| No CI gate | No workflow running `vf-check` | Any | `templates/.github/workflows/ci.yml` | `sf-deployment-strategies` |
| Long-lived branches | `git for-each-ref --sort=-committerdate refs/remotes --format='%(refname:short) %(committerdate:relative)'` | Branches older than a sprint | Merge or close | `sf-workflow-orchestration` |

## 7. Scoring and the register

Impact x effort, with the definitions from the skill. Two rules keep the register honest:

1. A finding without evidence at `file:line` or a query result is not a finding.
2. A finding without a named owner is a complaint.

Worked example, three rows from a real-shaped register:

| # | Category | Finding | Evidence | Impact | Effort | Owner | Skill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Automation | `Account` has two triggers plus an active Process Builder writing `Rating` | `AccountTrigger.trigger`, `AccountAuditTrigger.trigger`, `FlowDefinitionView` row `Account_Rating_PB` | 3 | 2 | Platform team | `sf-flow-automation` |
| 2 | Test debt | 14 classes with no test, org coverage 78% against a gate of 85% | `pairing-2026-09-12.json`, `apex-2026-09-12.json` | 3 | 2 | Feature squads | `sf-apex-testing` |
| 3 | Structural | 9 hardcoded record type ids across 4 classes | `grep` output in the appendix | 2 | 1 | Integrations | `sf-minimal-change` |

## 8. What an audit cannot see

State these explicitly in every report rather than leaving them implied:

| Blind spot | Why | What to do instead |
| --- | --- | --- |
| Setup-only configuration with no metadata representation | Not every setting is retrievable | List the Setup pages reviewed by hand |
| Reports, dashboards and list views referencing a field | Not in the Apex/LWC source grep | Check before any deletion proposal |
| Managed package internals | Source is not visible | Audit the boundary: what you call and what you expose |
| Runtime behaviour under load | Static signals only | Event Monitoring or a load test (skill `sf-debugging-logs`) |
| Data quality | Debt in records, not metadata | Separate data audit (skill `sf-data-management`) |
| Anything in an org you were not given access to | - | Name the org and the gap |

## 9. Runbook: the first ninety minutes

The order matters - each step narrows the next. Write every raw output into
`.vibeforce/reports/` so the register can cite it.

```bash
ISO=$(date -u +%Y-%m-%dT%H-%M-%SZ); OUT=.vibeforce/reports; mkdir -p "$OUT"

# 1. Scope: what org, what source, what baseline
sf org display --target-org vf-int --json            > "$OUT/audit-org-$ISO.json"
jq '{sourceApiVersion, packageDirectories}' sfdx-project.json

# 2. Divergence first - it tells you whether the source is worth auditing at all
sf project deploy preview   --target-org vf-int --json > "$OUT/audit-deploy-preview-$ISO.json"
sf project retrieve preview --target-org vf-int --json > "$OUT/audit-retrieve-preview-$ISO.json"

# 3. Static gates over the whole tree, not the diff
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" static  --json --report "$OUT/audit-static-$ISO.json"
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" pairing --json --report "$OUT/audit-pairing-$ISO.json"

# 4. Org-side inventory
sf org list limits --target-org vf-int --json        > "$OUT/audit-limits-$ISO.json"
sf data query --use-tooling-api --target-org vf-int --json \
  --query "SELECT MasterLabel, ProcessType, TriggerType, Status FROM FlowDefinitionView WHERE Status = 'Active'" \
  > "$OUT/audit-automation-$ISO.json"

# 5. Source-side counters
grep -rho "<apiVersion>[0-9.]*</apiVersion>" force-app | sort | uniq -c | sort -rn
grep -rho "trigger [A-Za-z0-9_]* on [A-Za-z0-9_]*" force-app --include="*.trigger" | awk '{print $4}' | sort | uniq -c | sort -rn
find force-app -name "*.cls" -not -name "*Test.cls" -exec cat {} + | wc -c
```

Stop at ninety minutes and write the register with what you have. An audit that runs for three days
produces a document nobody reads; one that produces five ranked items produces work.

## 10. Remediation ladders

Each category has a cheapest-first order. Stop at the first rung that removes the cost.

| Category | Rung 1 | Rung 2 | Rung 3 |
| --- | --- | --- | --- |
| Version drift | Raise the version on files you touch anyway | Batch-raise one package directory with a regression run | Org-wide bump with a release freeze |
| Test debt | Add the missing test to the class you are changing | Cover the lowest-coverage class blocking releases | Coverage sprint with the gate raised afterwards |
| Automation sprawl | Document the order of execution for the worst object | Merge two triggers into one dispatcher | Migrate Workflow and Process Builder to Flow |
| Structural | Replace one hardcoded id with a describe or custom metadata | Add a Code Analyzer regex rule so it cannot come back | Extract a selector or service where duplication is measurable |
| Dead weight | Delete unreferenced classes in a standalone PR | Deprecate fields (rename with a `_deprecated` label, remove from layouts) | Delete the fields after a release with no references |
| Delivery | Retrieve org-only changes into source | Add the CI gate | Split into unlocked packages |

Rung 3 in any row is a project, not a chore: it needs a plan, a rollback path, and someone who owns
the outcome. If a finding can only be fixed at rung 3, say so in the register - that is the
difference between debt you pay down incrementally and debt you have to schedule.

## 11. Reporting cadence

| Frequency | Scope | Output |
| --- | --- | --- |
| Per release | The gates only (`static`, `pairing`, coverage) | Three numbers in the release notes |
| Quarterly | The full catalogue in this file | Register diffed against the previous one |
| On handover | Full catalogue plus the blind-spot table | Register plus a named owner per category |

The quarterly diff is what makes the audit worth running: the same command producing the same
metrics, so "Apex volume grew 18% while coverage fell 4 points" is a fact rather than an opinion.

## References

- Skill `sf-governor-limits` - the limit tables quoted here.
- Skill `sf-cli-operations` - the verified command and flag matrix.
- Skill `sf-minimal-change` - the ladder every remediation must pass.
- Skill `sf-org-security-audit` - the security half of the same sweep.
