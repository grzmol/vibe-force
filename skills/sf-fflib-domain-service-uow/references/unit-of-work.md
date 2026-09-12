# fflib Unit of Work Reference

Every signature below was read from `apex-enterprise-patterns/fflib-apex-common`, branch `master`,
commit `dab59777bac37f6b8a3cc2871fcf5df8d37764b4`:
`sfdx-source/apex-common/main/classes/fflib_ISObjectUnitOfWork.cls` (247 lines),
`fflib_SObjectUnitOfWork.cls` (1160 lines), `fflib_Application.cls` (507 lines).

## 1. Construction

```apex
public fflib_SObjectUnitOfWork(List<Schema.SObjectType> sObjectTypes)          // uses SimpleDML
public fflib_SObjectUnitOfWork(List<Schema.SObjectType> sObjectTypes, IDML dml)
```

The list is cloned and each type is registered, which allocates its new/dirty/upsert/deleted/
recycle-bin/relationship/publish buckets and calls the overridable `onRegisterType(SObjectType)`.

In application code you never call the constructor - you call the factory:

| `fflib_Application.UnitOfWorkFactory` method | Returns |
| --- | --- |
| `newInstance()` | UoW over the factory's configured types, `SimpleDML` |
| `newInstance(fflib_SObjectUnitOfWork.IDML dml)` | Configured types, your DML strategy |
| `newInstance(List<SObjectType> objectTypes)` | Ad-hoc type list, `SimpleDML` |
| `newInstance(List<SObjectType> objectTypes, fflib_SObjectUnitOfWork.IDML dml)` | Ad-hoc types and DML |
| `setMock(fflib_ISObjectUnitOfWork mockUow)` (`@TestVisible protected virtual`) | Every `newInstance` overload returns the mock |

Registering a type that was never passed to the constructor throws
`fflib_SObjectUnitOfWork.UnitOfWorkException`. Adding an SObject to the application factory is
therefore a required step whenever a new object joins a write path.

## 2. Commit order

`commitWork()` walks the configured `List<SObjectType>` in order for inserts, upserts and updates,
and in **reverse** order for deletes and recycle-bin emptying. That is why the type list is declared
parents-first:

```apex
public static final fflib_Application.UnitOfWorkFactory UnitOfWork =
    new fflib_Application.UnitOfWorkFactory(
        new List<SObjectType>{
            Account.SObjectType,        // parents first
            Opportunity.SObjectType,
            Project__c.SObjectType,
            ProjectTask__c.SObjectType, // children last
            ProjectEvent__e.SObjectType // platform events anywhere; they use their own buckets
        });
```

Insert order wrong => the child insert fails with `INVALID_CROSS_REFERENCE_KEY` or a null lookup,
because the relationship resolver runs immediately before each type's insert and the parent has no
Id yet.

### `commitWork()` lifecycle

| Step | Method | Hook before | Hook after |
| --- | --- | --- | --- |
| 0 | `Database.setSavepoint()` | - | - |
| 1 | - | `onCommitWorkStarting()` | - |
| 2 | publish "before" events (`m_dml.eventPublish`) | `onPublishBeforeEventsStarting()` | `onPublishBeforeEventsFinished()` |
| 3 | insert by type (relationships resolved first) | `onDMLStarting()` | - |
| 4 | upsert by type (only for non-empty buckets; casts `m_dml` to `IDMLUpsertable`) | - | - |
| 5 | update by type (relationships resolved first) | - | - |
| 6 | delete by type, reverse order | - | - |
| 7 | empty recycle bin by type, reverse order | - | - |
| 8 | resolve `Messaging.SingleEmailMessage` relationships | - | `onDMLFinished()` |
| 9 | run registered `IDoWork` items, then the email work | `onDoWorkStarting()` | `onDoWorkFinished()` |
| 10 | - | `onCommitWorkFinishing()` | - |
| 11a | on success: publish "after success" events | `onPublishAfterSuccessEventsStarting()` | `onPublishAfterSuccessEventsFinished()` |
| 11b | on failure: rollback to savepoint, rethrow, publish "after failure" events | `onPublishAfterFailureEventsStarting()` | `onPublishAfterFailureEventsFinished()` |
| 12 | - | - | `onCommitWorkFinished(Boolean wasSuccessful)` |

Steps 11 and 12 run in a `finally`, so failure events and `onCommitWorkFinished(false)` fire even
though the exception is rethrown.

The hooks are `public virtual` on the **concrete** `fflib_SObjectUnitOfWork`, not on
`fflib_ISObjectUnitOfWork`. To use them, subclass and return the subclass from a custom factory:

```apex
public class AuditedUnitOfWork extends fflib_SObjectUnitOfWork
{
    private Long startedAt;

    public AuditedUnitOfWork(List<SObjectType> types, IDML dml) { super(types, dml); }

    public override void onCommitWorkStarting() { startedAt = System.currentTimeMillis(); }

    public override void onCommitWorkFinished(Boolean wasSuccessful)
    {
        System.debug(LoggingLevel.INFO, String.format(
            'UoW commit success={0} ms={1} dml={2}/{3} rows={4}',
            new List<String>{
                String.valueOf(wasSuccessful),
                String.valueOf(System.currentTimeMillis() - startedAt),
                String.valueOf(Limits.getDmlStatements()),
                String.valueOf(Limits.getLimitDmlStatements()),
                String.valueOf(Limits.getDmlRows()) }));
    }
}
```

## 3. Registration API

All methods below are declared on `fflib_ISObjectUnitOfWork` and implemented on
`fflib_SObjectUnitOfWork`.

### Inserts

| Method | Notes |
| --- | --- |
| `void registerNew(SObject record)` | Record must have a null Id; asserts a non-event SObjectType |
| `void registerNew(List<SObject> records)` | Bulk form |
| `void registerNew(SObject record, Schema.SObjectField relatedToParentField, SObject relatedToParentRecord)` | Registers the child **and** the deferred lookup assignment to the parent |

### Relationships

| Method | Use |
| --- | --- |
| `void registerRelationship(SObject record, Schema.SObjectField relatedToField, SObject relatedTo)` | Both records in the same UoW; the lookup is populated once `relatedTo` has an Id |
| `void registerRelationship(Messaging.SingleEmailMessage email, SObject relatedTo)` | Sets the email's `WhatId` to the record once inserted |
| `void registerRelationship(SObject record, Schema.SObjectField relatedToField, Schema.SObjectField externalIdField, Object externalId)` | Resolves the lookup by external Id without querying: `uow.registerRelationship(line, InvoiceLine__c.Product__c, Product2.ExternalId__c, 'SKU-42')` |

Relationships are resolved per type immediately before that type's insert/update, so a relationship
whose target type appears **later** in the configured list will still be unresolved at insert time.
Order the type list by dependency, not alphabetically.

### Updates

| Method | Notes |
| --- | --- |
| `void registerDirty(SObject record)` | Record must have an Id |
| `void registerDirty(List<SObject> records)` | Bulk form |
| `void registerDirty(SObject record, List<SObjectField> dirtyFields)` | Merges only the named fields onto the already-registered copy; last write wins per field |
| `void registerDirty(List<SObject> records, List<SObjectField> dirtyFields)` | Bulk field-scoped form |
| `void registerDirty(SObject record, Schema.SObjectField relatedToParentField, SObject relatedToParentRecord)` | Dirty plus deferred parent lookup |

The field-scoped overloads are the tool for "two domains both touch this record": each registers
only its own fields, so neither clobbers the other's values.

### Upserts

| Method | Notes |
| --- | --- |
| `void registerUpsert(SObject record)` | Mixed new/existing |
| `void registerUpsert(List<SObject> records)` | Bulk form |
| `void registerUpsert(List<SObject> records, Schema.SObjectField externalIdField)` | Upsert on an external Id |
| `void registerUpsert(SObject record, Schema.SObjectField externalIdField, Schema.SObjectField relatedToParentField, SObject relatedToParentRecord)` | External-Id upsert plus deferred parent lookup |

`upsertDmlByType` casts the configured `IDML` to `fflib_SObjectUnitOfWork.IDMLUpsertable`. A custom
`IDML` that does not implement `IDMLUpsertable` throws a `System.TypeException` the first time any
upsert is registered and committed. Implement both interfaces in every custom DML class.

### Deletes

| Method | Notes |
| --- | --- |
| `void registerDeleted(SObject record)` / `(List<SObject> records)` | Deleted in reverse type order |
| `void registerPermanentlyDeleted(SObject record)` / `(List<SObject> records)` | Delete plus recycle-bin removal |
| `void registerEmptyRecycleBin(SObject record)` / `(List<SObject> records)` | Recycle-bin removal only, for records already deleted |

### Platform events

| Method | Published |
| --- | --- |
| `void registerPublishBeforeTransaction(SObject record)` / `(List<SObject>)` | Step 2, before any DML in this commit |
| `void registerPublishAfterSuccessTransaction(SObject record)` / `(List<SObject>)` | Step 11a, only when the commit succeeded |
| `void registerPublishAfterFailureTransaction(SObject record)` / `(List<SObject>)` | Step 11b, only when the commit threw |

All three go through `IDML.eventPublish(List<SObject>)`, which `SimpleDML` implements as
`System.EventBus.publish(objList)` guarded by an `isEmpty()` check.

These control **when fflib calls `EventBus.publish`**. They are orthogonal to the platform event's
own *Publish Behavior* setting. The combination that matters:

| fflib registration | Event `Publish Behavior` | Net effect |
| --- | --- | --- |
| `registerPublishAfterSuccessTransaction` | Publish After Commit | Published after the outer transaction commits; subscribers see committed data. Safest default |
| `registerPublishAfterSuccessTransaction` | Publish Immediately | Published as soon as the commit block finished; a later failure in the *same outer transaction* cannot retract it |
| `registerPublishBeforeTransaction` | Publish After Commit | Discarded if the transaction later rolls back - useful for "work started" signals that must not outlive the work |
| `registerPublishAfterFailureTransaction` | Publish Immediately | The reliable choice for failure telemetry: the commit already rolled back, so an After-Commit event would be discarded with it |

Publish-After-Commit events count as a DML statement; Publish-Immediately events count against a
separate limit of 150 `EventBus.publish` calls per transaction, readable via
`Limits.getPublishImmediateDML()`
([Publish platform events with Apex](https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_publish_apex.htm)).
Subscriber-side patterns: skill `sf-integration-patterns`.

```apex
fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();

Project__c project = new Project__c(Name = 'Rollout', Stage__c = 'Planning');
uow.registerNew(project);

uow.registerPublishAfterSuccessTransaction(
    new ProjectEvent__e(Action__c = 'Created', CorrelationId__c = correlationId));
uow.registerPublishAfterFailureTransaction(
    new ProjectEvent__e(Action__c = 'CreateFailed', CorrelationId__c = correlationId));

uow.commitWork();
```

### Other work

| Method | Notes |
| --- | --- |
| `void registerWork(fflib_SObjectUnitOfWork.IDoWork work)` | Arbitrary work run at step 9, after all DML; the place for a callout-free side effect that needs committed Ids |
| `void registerEmail(Messaging.Email email)` | Queued into the built-in `SendEmailWork`, sent at step 9 |
| `void commitWork()` | See section 2 |

```apex
public class EnqueueProjectSyncWork implements fflib_SObjectUnitOfWork.IDoWork
{
    private final List<Project__c> projects;
    public EnqueueProjectSyncWork(List<Project__c> projects) { this.projects = projects; }

    public void doWork()
    {
        Set<Id> ids = new Set<Id>();
        for (Project__c project : projects) { ids.add(project.Id); }  // Ids exist by step 9
        System.enqueueJob(new ProjectSyncQueueable(ids));
    }
}
```

`registerWork` runs **inside** the try block, so a throwing `IDoWork` rolls the whole commit back.

## 4. The `IDML` seam

```apex
public interface IDML
{
    void dmlInsert(List<SObject> objList);
    void dmlUpdate(List<SObject> objList);
    void dmlDelete(List<SObject> objList);
    void eventPublish(List<SObject> objList);
    void emptyRecycleBin(List<SObject> objList);
}

public interface IDMLUpsertable
{
    void dmlUpsert(List<SObject> objList, Schema.SObjectField externalId);
}
```

Shipped implementations:

| Class | Behaviour |
| --- | --- |
| `fflib_SObjectUnitOfWork.SimpleDML implements IDML, IDMLUpsertable` | `System.Database.insert/update/upsert/delete(objList, AccessLevel.SYSTEM_MODE)`; `EventBus.publish` and `Database.emptyRecycleBin` guarded by `isEmpty()` |
| `fflib_SObjectUnitOfWork.UserModeDML extends SimpleDML` | `UserModeDML()` uses `AccessLevel.USER_MODE`; `UserModeDML(AccessLevel access)` takes any level. Overrides insert/update/delete/upsert only - `eventPublish` and `emptyRecycleBin` stay system mode |

`UserModeDML.dmlUpsert` calls `System.Database.upsert(objList, externalId, true, m_accessLevel)`, so
upserts are all-or-none regardless of the access level.

### 4.1 User-mode DML wired once

```apex
public class Application
{
    public static final fflib_Application.UnitOfWorkFactory UnitOfWork =
        new UserModeUnitOfWorkFactory(
            new List<SObjectType>{
                Account.SObjectType, Opportunity.SObjectType,
                Project__c.SObjectType, ProjectTask__c.SObjectType,
                ProjectEvent__e.SObjectType });

    private class UserModeUnitOfWorkFactory extends fflib_Application.UnitOfWorkFactory
    {
        public UserModeUnitOfWorkFactory(List<SObjectType> objectTypes) { super(objectTypes); }

        public override fflib_ISObjectUnitOfWork newInstance()
        {
            if (m_mockUow != null) { return m_mockUow; }
            return new fflib_SObjectUnitOfWork(
                m_objectTypes, new fflib_SObjectUnitOfWork.UserModeDML());
        }
    }
}
```

Consequences, all deliberate:

- Object and field permissions of the running user are enforced by the platform on every UoW write.
- A domain class that also runs `Configuration.EnforcingTriggerCRUDSecurity` now checks twice; turn
  the domain check off (see [domain-layer.md](domain-layer.md) section 3).
- Integration and batch users need explicit permission sets. Sharing and permission design: skill
  `sf-security-model`.
- Static analysis stops flagging the UoW writes; see the `ApexFLSViolationRule` notes in skill
  `sf-fflib-operations`.

### 4.2 Partial-success DML

```apex
public class PartialSuccessDML implements fflib_SObjectUnitOfWork.IDML,
                                          fflib_SObjectUnitOfWork.IDMLUpsertable
{
    public final List<Database.Error> failures = new List<Database.Error>();
    private final AccessLevel level;

    public PartialSuccessDML() { this(AccessLevel.USER_MODE); }
    public PartialSuccessDML(AccessLevel level) { this.level = level; }

    public void dmlInsert(List<SObject> objList)
    {
        collect(Database.insert(objList, false, level));
    }

    public void dmlUpdate(List<SObject> objList)
    {
        collect(Database.update(objList, false, level));
    }

    public void dmlUpsert(List<SObject> objList, Schema.SObjectField externalId)
    {
        for (Database.UpsertResult result : Database.upsert(objList, externalId, false, level))
        {
            if (!result.isSuccess()) { failures.addAll(result.getErrors()); }
        }
    }

    public void dmlDelete(List<SObject> objList)
    {
        for (Database.DeleteResult result : Database.delete(objList, false, level))
        {
            if (!result.isSuccess()) { failures.addAll(result.getErrors()); }
        }
    }

    public void eventPublish(List<SObject> objList)
    {
        if (objList.isEmpty()) { return; }
        EventBus.publish(objList);
    }

    public void emptyRecycleBin(List<SObject> objList)
    {
        if (objList.isEmpty()) { return; }
        Database.emptyRecycleBin(objList);
    }

    private void collect(List<Database.SaveResult> results)
    {
        for (Database.SaveResult result : results)
        {
            if (!result.isSuccess()) { failures.addAll(result.getErrors()); }
        }
    }
}
```

```apex
PartialSuccessDML dml = new PartialSuccessDML();
fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance(dml);
// ... register work ...
uow.commitWork();
if (!dml.failures.isEmpty()) { LoggingService.recordDmlFailures(dml.failures); }
```

Caution: with `allOrNone = false` the commit does **not** throw, so `commitWork()` reports success,
`onCommitWorkFinished(true)` fires and after-success events publish even though some rows failed. If
that is unacceptable, inspect `failures` and throw from an `IDoWork` registered with `registerWork`,
which still runs inside the try block.

## 5. Governor arithmetic

| Cost | Where it comes from |
| --- | --- |
| 1 DML statement | `Database.setSavepoint()` at the start of `commitWork()` |
| 1 DML statement | `Database.rollback()` when the commit throws |
| 1 DML statement per SObject type with **non-empty** work per operation | `insertDmlByType`, `updateDmlByType`, `upsertDmlByType`, `deleteDmlByType` iterate every configured type |
| 0 | Types whose bucket is empty - DML against an empty list does not increment `Limits.getDmlStatements()` |
| 1 DML statement per non-empty publish bucket | Publish-After-Commit events; Publish-Immediately events use `Limits.getPublishImmediateDML()` instead |

A UoW configured with 12 types that actually writes 3 of them (insert) and 2 of them (update) spends
1 (savepoint) + 3 + 2 = 6 DML statements, not 24. Rows still count against the 10,000 DML-rows limit
per transaction. Limit figures and the full table: skill `sf-governor-limits` and
[Execution governors and limits](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm).

Practical ceilings:

| Pattern | Effect |
| --- | --- |
| One `commitWork()` per service call | 1 savepoint per transaction; cheapest |
| `commitWork()` inside a loop over records | 1 savepoint plus N type-DMLs per iteration - the fastest way to hit 150 |
| Two UoW instances committed in sequence | 2 savepoints, 2 sets of type-DMLs; acceptable when one must survive the other's rollback |
| Nested: service A commits, then service B (called from A's trigger) commits | Separate savepoints; B's rollback does not undo A's committed work inside the same transaction |

## 6. Triggers during `commitWork()`

`commitWork()` issues ordinary DML, so triggers, workflow, flows, roll-up recalculations and sharing
recalculations all fire inside it:

- An fflib domain trigger on the object being inserted runs during step 3, **before** the UoW inserts
  the next type. Logic in that domain that assumes the child records already exist will not find them.
- An after-trigger that itself opens a UoW and commits produces a nested commit with its own
  savepoint. This is supported but multiplies DML statements.
- A trigger error inside `commitWork()` surfaces as a `DmlException`, triggers `Database.rollback`,
  and the after-failure events publish.
- Order of execution between triggers, flows and validation rules is unchanged by fflib. See
  [Triggers and order of execution](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm)
  and skill `sf-flow-automation`.

## 7. Multiple and nested Unit of Work instances

| Situation | Approach |
| --- | --- |
| Business work plus audit rows that must persist even on failure | Two UoW instances: business UoW committed inside `try`; audit UoW committed in the `catch`. The business rollback does not touch the audit UoW because it was never part of that savepoint |
| Per-chunk commit in a Batch `execute` | One UoW per `execute` invocation - each chunk is its own transaction anyway |
| Service A composing service B | Pass A's `fflib_ISObjectUnitOfWork` into B's `uow`-taking overload; only A commits |
| Different DML strategies in one transaction (user mode for business, system mode for logs) | Two UoW instances constructed with different `IDML` implementations |

Never share one UoW across asynchronous boundaries: a UoW holds SObject references, and a Queueable
runs in a different transaction where those references have no committed context.

## 8. Verification

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-dev

sf apex run test --target-org vf-dev --synchronous --code-coverage --result-format human \
  --tests ProjectsServiceTest
```

Measure the real DML cost of a commit with an anonymous probe:

```apex
// scripts/apex/uow-cost.apex
Integer dmlBefore = Limits.getDmlStatements();
Integer rowsBefore = Limits.getDmlRows();

ProjectsService.createFromOpportunities(new Set<Id>{ '006xx0000000001AAA' });

System.debug(LoggingLevel.ERROR, 'DML statements: ' + (Limits.getDmlStatements() - dmlBefore)
    + ' of ' + Limits.getLimitDmlStatements());
System.debug(LoggingLevel.ERROR, 'DML rows: ' + (Limits.getDmlRows() - rowsBefore)
    + ' of ' + Limits.getLimitDmlRows());
```

```bash
sf apex run --target-org vf-dev --file scripts/apex/uow-cost.apex
```

Reading the resulting log and setting trace flags: skill `sf-debugging-logs`.

## 9. Checklist

| # | Check |
| --- | --- |
| 1 | Every SObject written by the feature appears in the `Application.UnitOfWork` type list |
| 2 | Type list ordered parents before children |
| 3 | `registerNew(child, Child__c.Parent__c, parent)` used instead of a manual second pass to set lookups |
| 4 | Field-scoped `registerDirty` used where two code paths update the same record |
| 5 | Platform events registered with the variant matching the desired failure semantics |
| 6 | Custom `IDML` implements both `IDML` and `IDMLUpsertable` |
| 7 | Partial-success DML inspected after `commitWork()`; success is not assumed |
| 8 | Exactly one `commitWork()` per service method, none inside loops |
| 9 | No outer `Database.setSavepoint()` wrapping a single `commitWork()` |
| 10 | No UoW instance passed into a Queueable, Batch or future method |
