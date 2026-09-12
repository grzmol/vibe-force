# Declarative First, Code When It Breaks

Rung 3 of the ladder in `SKILL.md`. For each requirement shape: the declarative artefact that
covers it, the point where the declarative option stops being viable, and the code fallback.

Every claim below is either traced to a documentation URL or marked `[unverified]`. Items marked
`[unverified]` are edition- or org-dependent allocations that are published in Salesforce Help and
must be confirmed in the target org (Setup > *feature* page, or `sf sobject describe`) before you
rely on the exact number.

## How to use this file

1. Express the requirement as a sentence starting with a verb: "block", "derive", "aggregate",
   "route", "notify", "grant", "load", "expose".
2. Find the row. Read the **breaking point** column before the **code fallback** column.
3. If no breaking point applies, the declarative artefact is the answer. Write the rejected code
   option into the decision log (`references/scope-contract.md`).
4. If a breaking point applies, quote it in the decision log. "Flow could not do it" is not a
   reason; "the requirement needs a callout inside the same transaction as the save, before commit"
   is.

## Capability table

| Requirement | Declarative option | Breaking point (move to code) | Code fallback |
| --- | --- | --- | --- |
| Block a save when field values are inconsistent | Validation rule on the object | Rule needs data from unrelated records, needs aggregation across siblings, or needs a callout; compound fields are unusable in rules as of API 20.0 | `before insert`/`before update` trigger calling a domain method, `addError()` per record |
| Block a save based on the child collection | Roll-up summary + validation rule on the parent | Roll-up not available for the relationship (lookup instead of master-detail), or the aggregate is not `Count`/`Min`/`Max`/`Sum` | Trigger on the child recalculating onto the parent |
| Derive a value from the same record or its parents | Formula field | Value must be searchable/indexed for a selective filter, must be frozen at a point in time, needs data from children, or exceeds the formula size allocation `[unverified]` | Stored field populated in a `before` trigger or a record-triggered Flow |
| Aggregate children onto a parent | Roll-up summary field (`Count`, `Min`, `Max`, `Sum`, optional `summaryFilterItems`) | Relationship is not master-detail, operation is not one of the four, the child is an external object, or the aggregate needs cross-object joins | Trigger-based rollup or scheduled recalculation batch (skill `sf-async-apex-patterns`) |
| Aggregate across a lookup relationship | Record-triggered Flow on the child updating the parent | Volume makes per-record Flow updates too expensive, or ordering with other automation becomes ambiguous | Trigger with a single bulk DML on the parents |
| Prevent or warn on duplicates | Duplicate rule + matching rule | Matching logic needs fuzzy rules the matching rule cannot express, or dedupe must run outside the save path (batch cleanup) | Apex with an external-ID upsert, or a batch job using `MatchingRule`-equivalent logic in SOQL |
| Route a record for sign-off | Approval process | Approver selection needs a callout, a rules engine, or more steps than the process supports `[unverified]` | Apex submitting `Approval.process()` with a computed approver, or a custom state machine |
| Assign an owner by criteria | Assignment rule (lead/case) or record-triggered Flow | Assignment needs load balancing, round-robin state, or an external system's answer | Apex with a queueable assignment service |
| Escalate on age or SLA breach | Escalation rule (case) or scheduled-triggered Flow | Escalation depends on data outside Salesforce or needs sub-hour precision at volume | Scheduled Apex (`System.schedule`) or platform event consumer |
| React to a record change | Record-triggered Flow (before-save or after-save) | Needs `before delete` handling, recursion control, complex bulk logic, callouts inside the transaction, or must run in a specific order relative to existing triggers | Apex trigger routed through the project's existing framework (rung 5) |
| Run work on a schedule | Scheduled-triggered Flow | Needs chaining, stateful progress, or more than the Flow batch scope allows | `System.schedule` / `System.scheduleBatch`; at most 100 scheduled Apex jobs at one time |
| Mass-update existing records once | Data Loader / `sf data update bulk` / list view inline edit | The update requires per-record business logic that is not expressible as a static value | One-off batch Apex or a Bulk API 2.0 ingest job |
| Grant record access | Sharing rule (criteria-based or owner-based), role hierarchy, manual share | Access depends on a runtime computation or a relationship the platform cannot express | Apex managed sharing (`__Share` records, `SharingReason`) |
| Gate a feature for some users | Custom permission on a permission set (API 31.0+) | Gate depends on record data, not user identity | Apex check plus a field or custom metadata row |
| Keep picklist values consistent across fields | Global value set (fields based on it are of type `ValueSet`) | Values must be maintained by non-admins at runtime | Custom object with a lookup, or custom metadata type |
| Expose configuration to admins | Custom metadata type or custom setting | Configuration is a single value that never varies by environment - then it is a constant, not configuration (rung 1) | Constant in Apex |
| Show a record form | `lightning-record-form` / dynamic forms on the record page | See `references/base-components-first.md` | Custom LWC |
| Show a filtered list | List view, related list, report | Needs cross-object filters the list view cannot express, or a computed column | `lightning-datatable` over a wire adapter or an Apex query |
| Notify a user | Flow email/notification action, workflow alert | Content needs data assembly or attachments generated at send time | Apex `Messaging.sendEmail` |
| Call an external system | Flow HTTP callout action with an external service registration | Requires signing, retries with backoff, chunking, or non-JSON payloads | Apex callout via a named credential (skill `sf-integration-patterns`) |
| Publish a change to subscribers | Change Data Capture on the object | Consumers need a filtered or enriched payload | Platform event published from Apex or Flow |
| Load more than 2,000 records from outside | Bulk API 2.0 job (no custom code at all) | Records need per-record Apex-only logic that cannot run in triggers | Batch Apex over staged records |

## Limits that actually force code

These are the documented hard boundaries most often decisive.

| Limit | Value | Effect on the decision | Source |
| --- | --- | --- | --- |
| Roll-up summary operations | `Count`, `Min`, `Max`, `Sum` only | Averages, medians, concatenations, distinct counts need code or a Flow | [CustomField](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm) |
| Roll-up summary requires a master-detail relationship | Rollup summary is not available for external objects; `summarizedField`, `summaryForeignKey`, `summaryOperation` define it | Lookup relationships need a Flow or trigger rollup | [CustomField](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm) |
| Validation rules and compound fields | Compound fields (addresses, name, dependent picklists) unusable as of API 20.0 | Address-shaped validation must target the component fields or move to code | [ValidationRule](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_validationformulas.htm) |
| SOQL queries per synchronous transaction | 100 (200 asynchronous) | A per-record Flow loop with a Get is the same budget as Apex; volume forces bulk code | [Governor Limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) |
| DML statements per transaction | 150 | Automation chains that each perform DML hit this long before record volume does | [Governor Limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) |
| Records processed by DML per transaction | 10,000 | Cascading updates from a rollup-by-automation design break here | [Governor Limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) |
| CPU time per transaction | 10,000 ms synchronous / 60,000 ms asynchronous | Heavy formula + Flow stacking is measured here too | [Governor Limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) |
| Trigger recursion stack depth | 16 | Rollup-by-trigger designs that write back to the source object fail here | [Governor Limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) |
| Scheduled Apex jobs at one time | 100 | A "scheduler per feature" design exhausts the org; one scheduler with a dispatch list does not | [Apex Scheduler](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_scheduler.htm) |
| Bulk API threshold | More than 2,000 records: Bulk API 2.0; fewer: bulkified synchronous REST/SOAP | Do not write batch Apex for a one-time 5,000-record load | [Bulk API intro](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-intro.html) |
| Bulk DML chunking | Each chunk of 200 records is a separate transaction | Trigger logic must be bulk-safe at 200, not at 1 | [Bulk API limits](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-concepts-limits.html) |
| Validation rules per object, formula size, roll-up summaries per object, active duplicate rules per object, Flow elements executed per interview | `[unverified]` - edition-dependent allocations published in Salesforce Help | Check before designing anything that consumes many of them | Salesforce Help, Salesforce Features and Edition Allocations |

## Breaking points in detail

### Validation rule vs Apex `addError()`

A validation rule holds a formula or expression evaluated on save; when it returns true the save is
blocked with the rule's error message
([ValidationRule](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_validationformulas.htm)).
It applies to every entry path - UI, API, Bulk API, Flow - with no test to write.

Keep the rule when the condition is expressible over the record and its parent fields:

```
AND(
  ISPICKVAL(StageName, "Closed Won"),
  OR(ISBLANK(Amount), Amount <= 0)
)
```

Move to code when the condition needs sibling records, aggregates that are not roll-up summaries,
or state that only Apex can compute:

```apex
public with sharing class OpportunityGuards {
    // Requires the count of competing open opportunities per account: not a formula, not a rollup.
    public static void blockDuplicateOpenDeals(List<Opportunity> records) {
        Set<Id> accountIds = new Set<Id>();
        for (Opportunity opp : records) {
            if (opp.AccountId != null) {
                accountIds.add(opp.AccountId);
            }
        }
        if (accountIds.isEmpty()) {
            return;
        }
        Map<Id, Integer> openByAccount = new Map<Id, Integer>();
        for (AggregateResult row : [
            SELECT AccountId accId, COUNT(Id) total
            FROM Opportunity
            WHERE AccountId IN :accountIds AND IsClosed = false
            GROUP BY AccountId
            WITH USER_MODE
        ]) {
            openByAccount.put((Id) row.get('accId'), (Integer) row.get('total'));
        }
        for (Opportunity opp : records) {
            Integer existing = openByAccount.get(opp.AccountId);
            if (existing != null && existing > 0) {
                opp.addError('This account already has an open opportunity.');
            }
        }
    }
}
```

`WITH USER_MODE` is the enforcement clause at API version 67.0 and later; `WITH SECURITY_ENFORCED`
is not allowed in Apex SOQL at that version. The class declares `with sharing` explicitly even
though a class with no declaration behaves that way at 67.0+. See skill `sf-security-model`.

### Formula field vs stored field

| Property | Formula field | Stored field written by automation |
| --- | --- | --- |
| Value freshness | Always current at read time | As of the last write |
| Historical accuracy | No - recalculates with the formula | Yes - frozen at write |
| Selective filtering | Not a standard custom index candidate in the same way as a stored field `[unverified]` | Indexable, filterable at scale (skill `sf-soql-sosl-optimization`) |
| Cost | Evaluated per read | Evaluated once per write |
| Children data | Not available | Available via trigger or Flow |

Prefer the formula until a query filters on it at volume, or the business needs the value as it was
at the moment of the event.

### Roll-up summary vs Flow rollup vs Apex rollup

```
Master-detail + Count/Min/Max/Sum  ->  roll-up summary field (zero code, zero tests)
Lookup + simple recalculation      ->  record-triggered Flow on the child
Lookup + volume, ordering, or a non-standard aggregate  ->  Apex, bulk-safe, one DML per parent set
```

An Apex rollup is the most expensive of the three: it needs bulk safety, recursion control, tests,
and it competes for the 150-DML and 16-stack-depth budgets. Do not write one when the relationship
can be a master-detail.

### Record-triggered Flow vs Apex trigger

| Factor | Flow wins | Apex wins |
| --- | --- | --- |
| Field updates on the saving record | Before-save Flow - no DML, no test | - |
| Related-record creation with simple mapping | Yes | - |
| `before delete` behaviour | Not available | Yes |
| Deterministic ordering with existing triggers | Only via `TriggerOrder` on the Flow | Single dispatch point in the framework the repo already uses |
| Bulk logic with maps, sets, partial success | - | Yes |
| Callouts around the save | - | Yes, asynchronously |
| Complex error handling and retry | - | Yes |

If the object already has an Apex trigger routed through the project's framework, adding a Flow
creates a second automation entry point with its own ordering rules. That is a new convention -
rung 5 says no. Inventory first (`references/reuse-discovery.md`), then choose. Flow authoring
details: skill `sf-flow-automation`.

### Custom permission vs custom setting vs custom metadata type

| Need | Artefact |
| --- | --- |
| "Some users may do X" | `CustomPermission` assigned via permission set (API 31.0+) |
| "This environment points at endpoint Y" | Named credential; never a custom setting holding a URL and a token |
| "These 12 rows of reference data drive behaviour and ship with the package" | Custom metadata type |
| "One value, identical in every org, never changed by an admin" | A constant in code - rung 1 deletes the configuration |

## Worked decisions

### 1. "Warn the user when the close date is in the past"

| Rung | Outcome |
| --- | --- |
| 1 | Criterion AC-1: saving an Opportunity with `CloseDate` before today is rejected with a readable message. |
| 2 | No existing validation rule on `CloseDate`; `sf data query --use-tooling-api` over `EntityDefinition.ValidationRules` returns none matching. |
| 3 | Validation rule `CloseDate < TODAY()`. Stop. |

No Apex, no Flow, no component, no tests. Decision log records "rejected: before-save Flow
(unnecessary), rejected: trigger (unnecessary)".

### 2. "Show total open pipeline on the Account"

| Rung | Outcome |
| --- | --- |
| 1 | Criterion AC-2: Account page shows the sum of `Amount` for open Opportunities. |
| 2 | No existing field; checked `FieldDefinition` for `Pipeline`, `Open_Amount`, `Total_*`. |
| 3 | Opportunity-to-Account is a lookup, not master-detail, so a roll-up summary is unavailable. A record-triggered Flow on Opportunity updating the Account covers it at current volume. |
| 4-7 | Not reached. |

If the volume made per-record Flow updates unacceptable, the decision log would say so and the
fallback would be an Apex rollup with one DML per parent batch - not both.

### 3. "Send the order to the ERP when it is approved"

| Rung | Outcome |
| --- | --- |
| 1 | Criterion AC-3: on approval, the ERP receives the order once, with retry on failure. |
| 3 | Approval process covers the sign-off. The callout does not fit: it needs signing and idempotent retry. |
| 4 | Named credential supplies the endpoint and auth, so no custom auth code. |
| 7 | Minimum Apex: one queueable that performs the callout with the external ID as the idempotency key. |

Floor items that survive: idempotency, no secrets in metadata, error handling, tests for the
retry path.

## Anti-patterns at this rung

| Anti-pattern | Why it is wrong | Replacement |
| --- | --- | --- |
| Apex trigger that only copies a parent field onto the child | Formula field or cross-object formula does it with no code | Formula field |
| Apex that only validates and throws | Validation rule covers every entry path | Validation rule |
| Flow **and** a trigger on the same object for the same event | Two ordering models, undebuggable interactions | One entry point, per rung 5 |
| "Framework" Flow with a subflow per object | Recreates a trigger framework in Flow | The convention already in the repo |
| Custom setting with one value per org that is always the same | Configuration nobody changes | Constant |
| Batch Apex for a one-time data fix | Bulk API 2.0 or Data Loader does it with no deployable metadata | Bulk API 2.0 job |
| Validation implemented only in the LWC | API, Bulk, and Flow writes bypass it | Validation rule, surfaced automatically by `lightning-record-edit-form` |
| Custom scheduler object plus a runner class | Platform scheduler exists; 100-job cap applies to real jobs, not to invented ones | `System.schedule` / `System.scheduleBatch` |

## Verification for this rung

```bash
# What did the change actually add, by metadata type?
git diff --name-only | grep -oE '(objects|flows|classes|triggers|permissionsets)/' | sort | uniq -c

# Prove that no declarative artefact already exists for the object you touched
sf data query --use-tooling-api -q "SELECT QualifiedApiName, (SELECT DeveloperName FROM ValidationRules) FROM EntityDefinition WHERE QualifiedApiName = 'Opportunity'" --target-org vf-dev
sf org list metadata --metadata-type Flow --target-org vf-dev
sf org list metadata --metadata-type DuplicateRule --target-org vf-dev

# Local gate
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local
```

## Sources

- [CustomField (Metadata API)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm) - rollup summary type, `summaryOperation` values `Count`/`Min`/`Max`/`Sum`, `summaryFilterItems`, `summarizedField`, field types unavailable for external objects.
- [ValidationRule (Metadata API)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_validationformulas.htm) - formula/expression semantics, error message, API 20.0 compound-field restriction, API 40.0 custom metadata type support.
- [DuplicateRule](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_duplicaterule.htm) and [MatchingRule](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_matchingrule.htm).
- [ApprovalProcess](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_approvalprocess.htm), [SharingRules](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_sharingrules.htm), [GlobalValueSet](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_globalvalueset.htm), [CustomPermission](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_custompermission.htm), [Flow](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm).
- [Apex Governor Limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm) - SOQL 100/200, DML 150, DML rows 10,000, stack depth 16, CPU 10,000/60,000 ms.
- [Apex Scheduler](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_scheduler.htm) - `System.schedule`, `System.scheduleBatch`, 100 scheduled Apex jobs.
- [Introduction to Bulk API 2.0 and Bulk API](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-intro.html) - 2,000-record threshold.
- [Bulk API Limits](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-concepts-limits.html) - 200-record transaction chunks, 7-day result retention.
- [Enforce Object and Field Permissions](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_perms_enforcing.htm) - access-mode selection, sharing keywords.
