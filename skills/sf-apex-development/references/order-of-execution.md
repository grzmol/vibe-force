# Save Order of Execution Reference

The authoritative sequence Salesforce performs when a record is saved with `insert`, `update`, or
`upsert`. Verbatim step semantics from
[Triggers and Order of Execution](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm)
(Apex Developer Guide, Winter '27 / API 68.0). The Data Model Gallery flowchart lags the guide; the
guide page is the current source.

## Before the server

Browser-side JavaScript validation runs only for dependent picklist fields, limiting each dependent
picklist to its available values. **No other client-side validation occurs.** Never rely on UI
validation for data integrity.

## Server-side sequence

| # | Step | Notes for Apex authors |
| --- | --- | --- |
| 1 | Load the original record from the database, or initialise the record for an `upsert` | this is the basis of `Trigger.old` |
| 2 | Load new field values from the request, overwriting old values, then run request-specific system validation | see the validation-by-source table below |
| 3 | Execute record-triggered flows configured to run **before** the record is saved | before-save flows mutate the same in-memory record as before triggers; see `sf-flow-automation` |
| 4 | Execute **all before triggers** | `Trigger.new` is mutable here and costs no extra DML |
| 5 | Run most system validation again, plus custom validation rules | layout-specific rules are the only check not repeated for standard UI edits |
| 6 | Execute duplicate rules | a `block` action stops the save; no after triggers, no workflow |
| 7 | Save the record to the database — **not yet committed** | record Ids now exist |
| 8 | Execute **all after triggers** | `Trigger.new` is read-only; DML on the same record here risks recursion |
| 9 | Execute assignment rules | skipped during a recursive save |
| 10 | Execute auto-response rules | skipped during a recursive save |
| 11 | Execute workflow rules; if there are field updates: (a) update the record again, (b) re-run system validations, (c) execute before-update **and** after-update triggers exactly one more time | this is the classic "my trigger ran twice" cause |
| 12 | Execute escalation rules | |
| 13 | Execute Process Builder processes and flows launched by workflow rules — **no guaranteed order** | migrate to record-triggered flows to control ordering |
| 14 | Execute record-triggered flows configured to run **after** the record is saved | |
| 15 | Execute entitlement rules | in API 53.0 and earlier, after-save flows ran after this step |
| 16 | If the record has a roll-up summary field or is part of a cross-object workflow, recalculate and update the **parent**; the parent then goes through the whole save procedure | skipped during a recursive save |
| 17 | If the parent was updated and a **grandparent** has a roll-up or cross-object workflow, recalculate and update the grandparent; it too goes through the save procedure | skipped during a recursive save |
| 18 | Execute criteria-based sharing evaluation | |
| 19 | **Commit** all DML operations to the database | |
| 20 | Execute post-commit logic, in no particular order: sending email, enqueued asynchronous Apex (Queueable jobs and future methods), asynchronous paths in record-triggered flows | this is why `System.enqueueJob` in a trigger is safe with respect to uncommitted DML |

### Recursive save

During a recursive save — a save triggered by step 11, 13, 16, or 17 — Salesforce **skips steps 9
through 17**. Consequences:

- assignment rules, auto-response rules, workflow rules, escalation rules, Process Builder, flows,
  entitlement rules, and roll-up cascades do not re-run;
- before and after triggers **do** re-run (steps 4 and 8), so trigger logic must be idempotent;
- `Trigger.size` in a recursive save reflects the recursive batch, not the original DML.

### Validation by request source (step 2)

| Request source | System validation performed | Custom validation rules at step 2 |
| --- | --- | --- |
| Standard UI edit page | layout-specific rules, required values at layout and field-definition level, valid field formats, maximum field length | only for the User object |
| Multiline item creation (quote line items, opportunity line items) | standard checks | yes |
| Apex, SOAP API, REST API, Bulk API | foreign keys, field formats, maximum field lengths, restricted picklists; custom foreign keys verified not to reference the object itself before a trigger runs | no — custom rules run at step 5 |

## Trigger re-fire arithmetic

A single `update` on a record that has a workflow field update produces this trigger sequence:

| Order | Trigger | Cause |
| --- | --- | --- |
| 1 | `before update` | step 4 |
| 2 | `after update` | step 8 |
| 3 | `before update` | step 11c, after the workflow field update |
| 4 | `after update` | step 11c |

`Trigger.old` in invocations 3 and 4 holds the state **before the initial user update**, not the
post-update, pre-workflow state. Documented example: a number field starts at 1, a user sets it to
10, a workflow field update increments it to 11 — in the trigger that fires after the workflow
update, `Trigger.old` reports **1**, not 10.

Workflow field updates re-fire triggers **once and only once**. Custom validation rules, flows,
duplicate rules, Process Builder processes, and escalation rules are not re-run at step 11b.

## Recursion control

| Mechanism | Depth | What it counts |
| --- | --- | --- |
| Platform: total stack depth for Apex that recursively fires triggers via `insert`/`update`/`delete` | 16 | new Apex invocations spawned by trigger-firing DML |
| Platform: recursive Apex that fires no triggers | governed by CPU and heap, single stack | ordinary recursive method calls |
| Application: `TriggerHandler` loop budget | default 5 per handler and operation | handler entries; see [trigger-framework.md](trigger-framework.md) |
| Application: Id-set guard | 1 pass per record | records already processed in this transaction |

Spawning a new Apex invocation is more expensive than a recursive call in a single stack, which is
why the platform applies a tighter restriction (16) to trigger-firing recursion.

Static-variable facts that make naive guards fail:

| Fact | Implication |
| --- | --- |
| Static variables are **not** reverted by `Database.rollback(savepoint)` | a one-shot boolean set before a rolled-back branch stays set |
| Static variables are **not** reset between the retry attempts of a partial-success bulk DML call | triggers refire on the successful subset with the guard already tripped, silently skipping work |
| Static variables in a test class are not preserved across test methods | each test method sees the original value |
| Governor limits **are** reset between partial-success retry attempts | limit-based reasoning about retries is invalid |

Pattern that survives all four:

```apex
public with sharing class AccountRollupGuard {
    @TestVisible
    private static Map<String, Set<Id>> processed = new Map<String, Set<Id>>();

    public static List<Account> claim(String phase, List<Account> candidates) {
        Set<Id> seen = processed.get(phase);
        if (seen == null) {
            seen = new Set<Id>();
            processed.put(phase, seen);
        }
        List<Account> fresh = new List<Account>();
        for (Account a : candidates) {
            if (seen.add(a.Id)) {
                fresh.add(a);
            }
        }
        return fresh;
    }
}
```

## Roll-up and cross-object cascades

Steps 16 and 17 mean a child DML can cause up to two additional full save procedures (parent, then
grandparent). Each of those executes its own triggers and its own before/after flows.

| Scenario | Saves executed | Trigger invocations |
| --- | --- | --- |
| Insert child with a roll-up on parent | child save, parent save | child before/after, parent before/after |
| Insert grandchild with roll-ups on parent and grandparent | grandchild, parent, grandparent | three before/after pairs |
| Declarative Lookup Rollup Summaries (DLRS) in real-time mode | child save, then a parent `update` issued from Apex | parent triggers fire as normal Apex DML, **not** as a native roll-up |
| DLRS in scheduled mode | child save only | parent triggers fire later, in the scheduled job's transaction |

DLRS is a managed package, not a platform feature. In real-time mode it is a trigger on the child
that performs `update` on the parent, so it participates in step 8 of the child's save, not step 16.
Budget its DML and SOQL against your own transaction limits. Native roll-up summary fields (steps 16
and 17) do not consume your SOQL or DML allowance.

## Operations that do not invoke triggers

Triggers fire for DML that the Java application server initiates or processes. These do not:

| Category | Examples |
| --- | --- |
| Cascades | cascading deletes (only the record that initiates the delete causes trigger evaluation); cascading updates of child records reparented by a `merge` |
| Mass admin actions | mass campaign status changes, mass division transfers, mass address updates, mass approval-request transfers, mass email actions |
| Schema changes | modifying custom field data types, renaming or replacing picklists |
| Other | managing price books; changing a user's default division with "transfer division" checked |
| Specific objects | `BrandTemplate`, `MassEmailTemplate`, `Folder` |

Related fact: inserts, updates, and deletes on **person accounts** fire Account triggers, not
Contact triggers.

## Multi-object DML chunking

A single `insert`/`update` call containing more than one sObject type is split into chunks. A chunk
is a contiguous run of one sObject type.

| Rule | Value |
| --- | --- |
| Maximum records passed to one `insert`/`update`/`delete`/`undelete` | 10,000 |
| Maximum object types per call | 10 |
| Maximum chunks per call | 10 |
| Default chunk size within one type | 200 |
| Triggers per chunk | invoked once per chunk |

Input `account1, account2, contact1, contact2, contact3, case1, account3, account4, contact4` splits
into five chunks: `[account1, account2]`, `[contact1..contact3]`, `[case1]`, `[account3, account4]`,
`[contact4]`. Chunking arises from **both** type changes and the 200-record default size, and both
count toward the 10-chunk cap — 1,001 leads followed by 1,001 contacts produces 12 chunks and fails.
Workaround: one DML call per object type.

Each `upsert` is two operations (insert and update), each subject to its own runtime limits. An
`upsert` of more than 10,000 records that all resolve to updates fails.

## Duplicate Id handling in a single call

`insert` and `update` check each batch of records for duplicate Id values. The first five duplicates
are processed; from the sixth onward the `SaveResult` carries
`Maximum number of duplicate updates in one batch (5 allowed). Attempt to update Id more than once
in this API call: <n>`. De-duplicate by Id with a `Map<Id, SObject>` before DML.

## Diagnosing order-of-execution problems

| Symptom | Most likely step | Confirmation | Fix |
| --- | --- | --- | --- |
| Trigger ran twice for one user edit | 11c workflow field update | debug log shows two `CODE_UNIT_STARTED` pairs for the same trigger | make the handler idempotent, or replace the workflow field update with a before-save flow |
| `Trigger.old` shows a stale value | 11c re-fire semantics | compare against the pre-update value in the log | read the prior value from `Trigger.oldMap`, and do not assume it reflects the immediately preceding state |
| Field set in a before trigger is lost | 11a workflow update overwrote it | log shows `WF_FIELD_UPDATE` after the trigger | move the logic to a before-save flow that runs at step 3, or stop the workflow from writing that field |
| Validation rule blocks data set by a before trigger | 5 runs after 4 | log shows `VALIDATION_RULE` after `CODE_UNIT_FINISHED` | relax the rule, or move the logic earlier |
| Roll-up value stale inside an after trigger | 16 runs after 8 | log shows the parent save after the child's after trigger | read the roll-up in a follow-up async job (`sf-async-apex-patterns`) |
| Duplicate rule silently blocks a save | 6 | log shows `DUPLICATE_DETECTION_RULE_INVOCATION` | adjust the rule, or set `Database.DMLOptions.duplicateRuleHeader.allowSave` |
| Assignment rule did not run | recursive save skips 9–17 | the save originated from step 11/13/16/17 | issue the assignment explicitly, or restructure so the record is saved by a top-level transaction |
| Email or Queueable job not observed in a test | 20 is post-commit; tests do not commit | test asserts before `Test.stopTest()` | assert after `Test.stopTest()`; see `sf-apex-testing` |
| Order between two automations unpredictable | 13 has no guaranteed order | two Process Builder processes on the same object | consolidate into record-triggered flows with explicit order values |

Capture the evidence with the `sf` CLI:

```bash
# Stream the log while reproducing the save in the UI
sf apex tail log --color --target-org vf-dev

# Or reproduce headlessly and read the resulting log
sf apex run --file scripts/apex/repro-save-order.apex --target-org vf-dev
sf apex list log --target-org vf-dev
sf apex get log --number 1 --target-org vf-dev > /tmp/save-order.log
```

Log-event vocabulary for save order (full table in `sf-debugging-logs`):

| Event | Step it marks |
| --- | --- |
| `VALIDATION_RULE` / `VALIDATION_PASS` / `VALIDATION_FAIL` | 5 |
| `DUPLICATE_DETECTION_RULE_INVOCATION` | 6 |
| `CODE_UNIT_STARTED` with `TriggerHandler` unit name | 4 and 8 |
| `WF_RULE_EVAL_BEGIN`, `WF_FIELD_UPDATE` | 11 |
| `FLOW_START_INTERVIEW` | 3, 13, 14 |
| `SAVEPOINT_SET`, `SAVEPOINT_ROLLBACK`, `SAVEPOINT_RELEASE` | Apex transaction control |
| `ENTERING_MANAGED_PKG` | managed-package automation inside the save |

## Sources

| Topic | URL |
| --- | --- |
| Triggers and order of execution | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm |
| Operations that don't invoke triggers | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_ignoring_operations.htm |
| Context variable considerations | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables_considerations.htm |
| Fields that are not updatable from a trigger | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_fields_not_updated.htm |
| Bulk DML exception handling and retry semantics | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dml_bulk_exceptions.htm |
| Things you should know about data in Apex (chunking, duplicate Ids, 10,000-record cap) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_dml_limitations.htm |
| Transaction control and savepoints | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction.htm |
| Execution governors and limits (stack depth 16, trigger batch size 200) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm |
| Salesforce CLI `apex` commands | https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_apex_commands_unified.htm |
