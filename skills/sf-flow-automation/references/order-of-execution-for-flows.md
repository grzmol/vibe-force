# Order of execution, annotated for flow authors

Source: Apex Developer Guide, "Triggers and Order of Execution", Summer '26 / API version 67.0.

When you save a record with `insert`, `update` or `upsert`, Salesforce performs a sequence of
events in a fixed order. Before the server runs any of it, the browser runs JavaScript validation
if the record contains dependent picklist fields; that limits each dependent picklist to its
available values. No other client-side validation occurs.

> During a **recursive save**, Salesforce skips steps 9 (assignment rules) through 17 (roll-up
> summary field in the grandparent record).

## The sequence

| # | Event | What it means for a flow author |
| --- | --- | --- |
| 1 | Loads the original record from the database, or initializes it for an upsert | The "prior value" your entry conditions compare against |
| 2 | Loads new field values from the request, overwriting old ones, then runs type-specific validation | Standard UI edits check layout rules, required values, field formats, max length. Apex and SOAP API requests validate foreign keys, formats, lengths and restricted picklists |
| 3 | **Executes record-triggered flows configured to run before the record is saved** | Your before-save flow. Mutating `$Record` here is free |
| 4 | Executes all `before` triggers | Runs **after** your before-save flow. A trigger writing the same field overwrites the flow's value |
| 5 | Runs most system validation again, plus custom validation rules | Layout-specific rules are the only check not repeated for standard UI edits |
| 6 | Executes duplicate rules | A `block` action here stops everything: no save, no after triggers, no workflow |
| 7 | Saves the record to the database, **not committed** | The record now has an Id |
| 8 | Executes all `after` triggers | |
| 9 | Executes assignment rules | Skipped during a recursive save |
| 10 | Executes auto-response rules | |
| 11 | Executes workflow rules | If there are field updates: the record is updated again, system validations run again, and before-update plus after-update triggers fire **one more time, exactly once**. Custom validation rules, flows, duplicate rules, Process Builder processes and escalation rules do **not** run again |
| 12 | Executes escalation rules | |
| 13 | Executes Process Builder processes and flows launched by workflow rules, **in no guaranteed order** | This is why record-triggered flows exist. Do not rely on ordering here |
| 14 | **Executes record-triggered flows configured to run after the record is saved** | Your after-save flow. Anything it writes re-enters this whole procedure |
| 15 | Executes entitlement rules | |
| 16 | Roll-up summary or cross-object workflow recalculation on the **parent**; the parent goes through the save procedure | A parent rollup can trigger the parent's own automation |
| 17 | The same for the **grandparent** | Skipped during a recursive save |
| 18 | Executes Criteria Based Sharing evaluation | |
| 19 | **Commits all DML operations to the database** | |
| 20 | Post-commit logic, in no particular order: sending email, enqueued asynchronous Apex including queueable jobs and future methods, **asynchronous paths in record-triggered flows** | Where your async flow path and your callouts belong |

The guide notes that the Order of Execution Flowchart in the Salesforce Data Model Gallery is
specific to the API version printed on it and can be out of sync; the Apex Developer Guide page for
your API version is authoritative.

## Consequences a flow author must internalise

### Before-save flow beats before trigger, by position

Step 3 precedes step 4. Both operate on the same in-memory record. Whichever writes **last** wins,
so a before trigger overwrites a before-save flow. If both maintain a field, the trigger's value
survives - until someone moves the logic.

### After-save writes are not free

An after-save flow (step 14) that updates a related record sends that record through steps 1-20 of
its own. Two after-save flows that update each other's objects will loop until a governor limit or
a recursion guard stops them.

### Workflow field updates re-fire triggers but not flows

Step 11's field update re-runs before-update and after-update triggers exactly once more. It does
**not** re-run flows, custom validation rules, duplicate rules or Process Builder. Code that
assumes "my automation always sees the final value" is wrong on one side or the other.

### Async paths run after commit

An asynchronous path in a record-triggered flow runs at step 20, after the transaction commits. It
cannot roll the save back and it does not extend the user's save time. That is the correct home for
a callout.

### Recursive saves skip the middle

Steps 9 through 17 are skipped during a recursive save, which includes assignment rules,
auto-response rules, workflow, escalation, Process Builder, **after-save record-triggered flows**,
entitlement rules and rollups. A flow that works when a user edits a record may simply not run when
another automation makes the same edit.

## Choosing a slot

| You need to | Slot | Mechanism |
| --- | --- | --- |
| Default or derive a field on this record | 3 | Before-save flow assigning `$Record` |
| Enforce a cross-record rule before the save | 4 | Before trigger, or a validation rule at 5 |
| Create or update related records | 14 | After-save flow |
| Publish an event or call out | 20 | Async path in the flow, or a queueable from an after trigger |
| Guarantee ordering against other logic on this object | any | Use **one** mechanism for the whole object |

## Related

- Trigger context variables, handler structure and recursion guards: skill `sf-apex-development`
- Limits shared across the whole transaction: skill `sf-governor-limits`
- Reading `FLOW_*` and `CODE_UNIT_STARTED` markers in a debug log: skill `sf-debugging-logs`

## A worked trace

Setup on `Opportunity`:

- Before-save flow `Set_Renewal_Date`, entry condition `StageName = 'Closed Won'`, assigns
  `Renewal_Date__c = CloseDate + 365`.
- Before trigger `OpportunityTrigger` (before update) that normalises `Name`.
- After-save flow `Create_Renewal_Task`, entry condition `StageName = 'Closed Won'`, creates a
  `Task`.
- A validation rule requiring `Renewal_Date__c` when `StageName = 'Closed Won'`.
- A roll-up summary on `Account.Total_Won__c`.

A user changes `StageName` to `Closed Won` and saves.

| Step | What happens here |
| --- | --- |
| 1 | Original Opportunity loaded. `StageName` is still the prior value at this point |
| 2 | New values applied. `StageName` is now `Closed Won`. Layout and format validation runs |
| 3 | `Set_Renewal_Date` matches. `$Record.Renewal_Date__c` assigned in memory. **No DML** |
| 4 | `OpportunityTrigger` before update runs. It normalises `Name`. If it also wrote `Renewal_Date__c`, that value would replace the flow's |
| 5 | Validation rule runs. It passes **because step 3 already populated the field**. Had the flow been after-save, this rule would have failed the save |
| 6 | Duplicate rules |
| 7 | Row written, uncommitted. The Opportunity has an Id |
| 8 | After triggers |
| 9-12 | Assignment, auto-response, workflow, escalation |
| 13 | Process Builder, if any, in no guaranteed order |
| 14 | `Create_Renewal_Task` matches. Inserts a `Task`. That insert starts its **own** pass through steps 1-20 for the Task |
| 15 | Entitlement rules |
| 16 | `Account.Total_Won__c` recalculated. The Account goes through the save procedure, so Account automation fires here |
| 17 | Grandparent rollup, if any |
| 18 | Criteria based sharing |
| 19 | **Commit.** Everything above is now durable |
| 20 | Async paths, queued jobs, email |

Two lessons from this trace:

1. Moving `Set_Renewal_Date` from before-save to after-save breaks the validation rule at step 5.
   The slot is part of the design, not an implementation detail.
2. The Account automation at step 16 runs inside the Opportunity's transaction and spends the same
   governor budget. A heavy Account trigger makes Opportunity saves fail.

## What re-enters the save procedure

| Action | Re-enters? |
| --- | --- |
| Assigning `$Record` in a before-save flow | No |
| Update Records on the triggering record in a before-save flow | **Yes** - avoid |
| Create or Update Records on a different record, any flow | Yes, for that record |
| Workflow field update | Partially - re-runs system validation and update triggers once, not flows |
| Roll-up summary recalculation | Yes, for the parent and grandparent |
| Async path in a record-triggered flow | Yes, but after commit, in a new transaction |
| `@InvocableMethod` performing DML | Yes, for the records it touches |

Anything in the "yes" column can recurse. Step 20's async path is the one place where recursion
costs a fresh transaction and a fresh governor budget instead of eating the current one.
