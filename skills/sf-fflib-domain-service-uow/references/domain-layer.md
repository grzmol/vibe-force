# fflib Domain Layer Reference

Source of truth: `apex-enterprise-patterns/fflib-apex-common`, branch `master`, commit
`dab59777bac37f6b8a3cc2871fcf5df8d37764b4`, file
`sfdx-source/apex-common/main/classes/fflib_SObjectDomain.cls` (1264 lines) and its base
`fflib_SObjects.cls`. Every signature in this file was read from that source.

## 1. Class shape

```apex
public virtual with sharing class fflib_SObjectDomain
    extends fflib_SObjects
    implements fflib_ISObjectDomain
```

`fflib_ISObjectDomain extends fflib_IDomain` and adds `Schema.SObjectType sObjectType()` and
`List<SObject> getRecords()`. `fflib_IDomain` declares `Object getType()` and
`List<Object> getObjects()`.

Note the base class is declared `with sharing`. A subclass declared `inherited sharing` inherits the
caller's mode for its own code; the base-class members still run in the base class's `with sharing`
context. Choose deliberately and document the choice - see skill `sf-security-model`.

### Constructors

| Signature | Behaviour |
| --- | --- |
| `fflib_SObjectDomain(List<SObject> sObjectList)` | Delegates to the 2-arg form using `sObjectList.getSObjectType()`. Throws if the list is empty and the type cannot be inferred |
| `fflib_SObjectDomain(List<SObject> sObjectList, SObjectType sObjectType)` | Copies the list into the domain, sets `Configuration = new Configuration()` |

Always declare your subclass constructor with the concrete list type
(`public Opportunities(List<Opportunity> records)`), which forces bulkification at every call site.

### Members

| Member | Type | Notes |
| --- | --- | --- |
| `Records` | `public List<SObject>` (getter) | Returns `getRecords()`; the domain's own copy |
| `ExistingRecords` | `protected Map<Id,SObject>` (`@TestVisible`) | `Trigger.oldMap`, or `Test.Database.oldRecords` when running under the mock database |
| `Configuration` | `public Configuration` | Per-instance fluent configuration |
| `Errors` | `public static fflib_SObjectDomain.ErrorFactory` | Deprecated in favour of `fflib_SObjects.Errors`, still populated by `error(...)` |
| `Test` | `public static TestFactory` | `Test.Database` mock DML, see section 6 |
| `SObjectDescribe` | `public Schema.DescribeSObjectResult` (from `fflib_SObjects`) | Used by the CRUD checks |

### Inherited helpers from `fflib_SObjects`

| Method | Visibility | Purpose |
| --- | --- | --- |
| `List<SObject> getRecords()` | public virtual | Backing list |
| `Set<Id> getRecordIds()` | public virtual | Ids of the records |
| `SObjectType getSObjectType()` | public virtual | Type token |
| `Object getType()` | public virtual override | Used by `fflib_Application.DomainFactory` mock keying |
| `void addError(String message)` | public virtual | `addError` on every record |
| `void addError(Schema.SObjectField field, String message)` | public virtual | Field-level `addError` on every record |
| `void clearField(Schema.SObjectField field)` / `clearFields(Set<...>)` | public virtual | Null out fields |
| `String error(String message, SObject record)` | protected virtual | Records the error in the `ErrorFactory` and returns the message |
| `String error(String message, SObject record, SObjectField field)` | protected virtual | Field-scoped variant |
| `Set<Id> getIdFieldValues(Schema.SObjectField field)` | protected | Collect lookup Ids, bulk-safe |
| `Set<String> getStringFieldValues(Schema.SObjectField field)` | protected | Collect text values |
| `List<SObject> getRecordsByFieldValue(Schema.SObjectField field, Object value)` | protected virtual | Filter |
| `List<SObject> getRecordsByFieldValues(Schema.SObjectField field, Set<Object> values)` | protected virtual | Filter |
| `List<SObject> getRecordsWithBlankFieldValues(...)` / `WithNotBlank...` / `WithAllBlank...` | protected virtual | Filters |
| `void setFieldValue(Schema.SObjectField field, Object value)` | protected virtual | Bulk assign |

`fflib_SObjectDomain` overrides `error(String, SObject)` and `error(String, SObject, SObjectField)`
as **public** so validation code can call them directly, and routes them into
`fflib_SObjectDomain.Errors`.

Domain-specific change detection:

| Method | Returns |
| --- | --- |
| `List<SObject> getChangedRecords(Set<String> fieldNames)` | Records whose named fields differ from `ExistingRecords` |
| `List<SObject> getChangedRecords(Set<Schema.SObjectField> fieldTokens)` | Same, with field tokens |

Both skip records not present in `ExistingRecords` (that is, inserts), so they are safe to call from
`onBeforeUpdate` / `onAfterUpdate` only.

## 2. Dispatch table

`fflib_SObjectDomain.triggerHandler(Type domainClass)` maps the trigger context onto `handleXxx`,
and each `handleXxx` calls the `onXxx` overrides:

| Trigger context | `handleXxx` called | CRUD check | `onXxx` calls in order |
| --- | --- | --- | --- |
| before insert | `handleBeforeInsert()` | none | `onApplyDefaults()`, `onBeforeInsert()` |
| before update | `handleBeforeUpdate(Map<Id,SObject>)` | none | `onBeforeUpdate(existingRecords)` |
| before delete | `handleBeforeDelete()` | none | `onBeforeDelete()` |
| after insert | `handleAfterInsert()` | `isCreateable()` | `onValidate()`, `onAfterInsert()` |
| after update | `handleAfterUpdate(Map<Id,SObject>)` | `isUpdateable()` | `onValidate()` *only if* `OldOnUpdateValidateBehaviour`, then `onValidate(existingRecords)`, then `onAfterUpdate(existingRecords)` |
| after delete | `handleAfterDelete()` | `isDeletable()` | `onAfterDelete()` |
| after undelete | `handleAfterUndelete()` | `isUndeletable()` | `onAfterUndelete()` |

CRUD checks run only when `Configuration.EnforcingTriggerCRUDSecurity` is true (the default) and
throw `fflib_SObjectDomain.DomainException` with a message such as
`Permission to create an Opportunity denied.`

Record set passed to the constructor, by context:

| Context | Records |
| --- | --- |
| insert (before and after) | `Trigger.new` |
| update (before and after) | `Trigger.new` |
| delete (before and after) | `Trigger.oldMap.values()` |
| undelete | `Trigger.new` |

### Override reference

| Override | Signature | Typical content |
| --- | --- | --- |
| `onApplyDefaults` | `public virtual void onApplyDefaults()` | Defaults on insert; mutate `Records` in place |
| `onBeforeInsert` | `public virtual void onBeforeInsert()` | In-memory derivation, normalisation |
| `onBeforeUpdate` | `public virtual void onBeforeUpdate(Map<Id,SObject> existingRecords)` | Recalculate derived fields on change |
| `onBeforeDelete` | `public virtual void onBeforeDelete()` | Delete guards via `addError` |
| `onValidate` | `public virtual void onValidate()` | Insert-and-update invariants (no old values needed) |
| `onValidate` | `public virtual void onValidate(Map<Id,SObject> existingRecords)` | Transition rules and immutability |
| `onAfterInsert` | `public virtual void onAfterInsert()` | Cross-object work, delegated to a service |
| `onAfterUpdate` | `public virtual void onAfterUpdate(Map<Id,SObject> existingRecords)` | Same, change-scoped |
| `onAfterDelete` | `public virtual void onAfterDelete()` | Cleanup, delegated to a service |
| `onAfterUndelete` | `public virtual void onAfterUndelete()` | Re-establish derived state |

Only `onValidate()` and `onValidate(Map)` run inside the after phase where `addError` still blocks
the save with a usable message; `onApplyDefaults` and `onBeforeXxx` may also `addError`, but a
validation rule expressed there fires before other before-triggers may have finished normalising.

## 3. Configuration flags

`fflib_SObjectDomain.Configuration` is fluent and per-instance. Set it in the subclass constructor
after `super(...)`.

| Property | Default | Enable | Disable |
| --- | --- | --- | --- |
| `EnforcingTriggerCRUDSecurity` | `true` | `enforceTriggerCRUDSecurity()` | `disableTriggerCRUDSecurity()` |
| `TriggerStateEnabled` | `false` | `enableTriggerState()` | `disableTriggerState()` |
| `OldOnUpdateValidateBehaviour` | `false` | `enableOldOnUpdateValidateBehaviour()` | `disableOldOnUpdateValidateBehaviour()` |

```apex
public Opportunities(List<Opportunity> records)
{
    super(records);
    Configuration
        .disableTriggerCRUDSecurity()   // user-mode DML in the UoW enforces access instead
        .enableTriggerState();          // reuse the same instance across before and after
}
```

When to disable the CRUD check:

| Scenario | Decision |
| --- | --- |
| Records written only through user-mode DML (`UserModeDML`) or `WITH USER_MODE` queries | Disable - the check duplicates enforcement and blocks legitimate system-mode paths |
| Platform-event subscriber trigger, integration user context | Disable - the subscriber often lacks object CRUD on the event's related objects |
| Classic org, DML in system mode, no other enforcement | Keep enabled |

`OldOnUpdateValidateBehaviour` exists only for pre-2014 code that relied on `onValidate()` firing on
update as well as insert. New code leaves it off and puts shared rules in a private method called
from both `onValidate()` overloads.

## 4. Per-event toggles: `TriggerEvent`

`fflib_SObjectDomain.getTriggerEvent(Type domainClass)` returns a process-wide (static, per
transaction) `TriggerEvent` for that domain class. The dispatcher checks
`isEnabled(isBefore, isAfter, isInsert, isUpdate, isDelete, isUndelete)` **after** constructing the
domain and returns early when the event is disabled.

| Method group | Methods |
| --- | --- |
| Enable one | `enableBeforeInsert()`, `enableBeforeUpdate()`, `enableBeforeDelete()`, `enableAfterInsert()`, `enableAfterUpdate()`, `enableAfterDelete()`, `enableAfterUndelete()` |
| Disable one | `disableBeforeInsert()`, `disableBeforeUpdate()`, `disableBeforeDelete()`, `disableAfterInsert()`, `disableAfterUpdate()`, `disableAfterDelete()`, `disableAfterUndelete()` |
| Bulk | `enableAll()`, `disableAll()`, `enableAllBefore()`, `disableAllBefore()`, `enableAllAfter()`, `disableAllAfter()` |

All return `this`, so they chain. Use for targeted suppression inside a data-migration job:

```apex
fflib_SObjectDomain.getTriggerEvent(Opportunities.class).disableAllAfter();
try
{
    ProjectsService.backfill(scopeIds);
}
finally
{
    fflib_SObjectDomain.getTriggerEvent(Opportunities.class).enableAllAfter();
}
```

The toggle is static for the transaction: it does not survive into a Queueable or Batch chunk, and it
does not cross into the trigger of another user's transaction. Persistent, admin-visible kill
switches belong in a custom permission or custom metadata - see skill `sf-fflib-operations`.

## 5. Stateful domains and recursion

The dispatcher keeps `Map<Type, List<fflib_SObjectDomain>> TriggerStateByClass`. When
`Configuration.TriggerStateEnabled` is true:

1. In the **before** phase the dispatcher constructs a new instance and pushes it onto the stack for
   that domain type.
2. In the **after** phase it pops the top instance and calls `setObjects(records)` on it, so instance
   fields set in the before phase are visible in the after phase.
3. Recursion (a before-insert that triggers another insert of the same object) pushes another
   instance, so each recursion level gets its own state - the stack, not a single slot, is what makes
   this safe.

`fflib_SObjectDomain.getTriggerInstance(Type domainClass)` returns the top of that stack, or `null`
when the domain has not fired or is not stateful.

```apex
public inherited sharing class Opportunities extends fflib_SObjectDomain
{
    private Set<Id> accountIdsTouchedBeforeUpdate = new Set<Id>();

    public Opportunities(List<Opportunity> records)
    {
        super(records);
        Configuration.enableTriggerState();
    }

    public override void onBeforeUpdate(Map<Id, SObject> existingRecords)
    {
        for (Opportunity opp : (List<Opportunity>) getChangedRecords(
                 new Set<Schema.SObjectField>{ Opportunity.AccountId }))
        {
            Opportunity existing = (Opportunity) existingRecords.get(opp.Id);
            if (existing.AccountId != null) { accountIdsTouchedBeforeUpdate.add(existing.AccountId); }
        }
    }

    public override void onAfterUpdate(Map<Id, SObject> existingRecords)
    {
        if (accountIdsTouchedBeforeUpdate.isEmpty()) { return; }
        AccountsService.recalculatePipeline(accountIdsTouchedBeforeUpdate);
    }
}
```

The source comments refer to an `ITriggerStateful` marker interface; no such interface exists in
`fflib-apex-common` at commit `dab5977` - `Configuration.enableTriggerState()` is the only switch.
`[unverified]` whether older tagged releases shipped the interface; do not implement it.

Recursion guards that must span the whole transaction (for example "only process each Id once")
belong in a static `Set<Id>` on a dedicated class, not on the domain instance, because stateful
domain instances are per recursion level by design.

## 6. Testing domains without DML: `fflib_SObjectDomain.Test.Database`

`fflib_SObjectDomain.Test` is a `TestFactory` whose single member is
`public MockDatabase Database`. `MockDatabase` records a synthetic trigger context; when
`System.Test.isRunningTest()` is true and `Test.Database.hasRecords()` returns true,
`fflib_SObjectDomain.triggerHandler(Type)` delegates to `Test.Database.testTriggerHandler(domainClass)`,
which runs the **before** phase and then the **after** phase against the mock records.

| Method | Sets |
| --- | --- |
| `onInsert(List<SObject> records)` | `isInsert = true`, `records` |
| `onUpdate(List<SObject> records, Map<Id,SObject> oldRecords)` | `isUpdate = true`, `records`, `oldRecords` |
| `onDelete(Map<Id,SObject> records)` | `isDelete = true`, `oldRecords` |
| `onUndelete(List<SObject> records)` | `isUndelete = true`, `records` |
| `hasRecords()` | `true` when either collection is non-empty |

```apex
@IsTest
private class OpportunitiesTriggerHandlerTest
{
    @IsTest
    private static void insertValidationFailsWithoutAccount()
    {
        Opportunity opp = new Opportunity(Name = 'Test', Type = 'Existing Account');

        fflib_SObjectDomain.Test.Database.onInsert(new List<Opportunity>{ opp });
        fflib_SObjectDomain.triggerHandler(OpportunitiesTriggerHandler.class);

        Assert.areEqual(1, fflib_SObjectDomain.Errors.getAll().size());
        Assert.areEqual(
            'Existing-customer Opportunities require an Account.',
            fflib_SObjectDomain.Errors.getAll()[0].message);
        Assert.areEqual(
            Opportunity.AccountId,
            ((fflib_SObjectDomain.FieldError) fflib_SObjectDomain.Errors.getAll()[0]).field);
    }

    @IsTest
    private static void typeChangeIsRejected()
    {
        Id oppId = fflib_IDGenerator.generate(Opportunity.SObjectType);
        Opportunity oldOpp = new Opportunity(Id = oppId, Name = 'Test', Type = 'Existing Account');
        Opportunity newOpp = new Opportunity(Id = oppId, Name = 'Test', Type = 'New Account');

        fflib_SObjectDomain.Test.Database.onUpdate(
            new List<Opportunity>{ newOpp },
            new Map<Id, SObject>{ oppId => oldOpp });
        fflib_SObjectDomain.triggerHandler(OpportunitiesTriggerHandler.class);

        Assert.areEqual(1, fflib_SObjectDomain.Errors.getAll().size());
        Assert.areEqual(
            'Opportunity Type is immutable.', fflib_SObjectDomain.Errors.getAll()[0].message);
    }
}
```

Caveats:

- `MockDatabase` runs **both** phases in one call. A validation that only fires after insert still
  gets exercised; a test asserting ordering between phases needs two separate domain invocations.
- Records passed to `onInsert` have no Id unless you generate one (`fflib_IDGenerator.generate`).
- `fflib_SObjectDomain.Errors` is static and accumulates across assertions inside one test method.
  Call `fflib_SObjectDomain.Errors.clearAll()` between phases when asserting counts.
- `Test.Database` short-circuits the real trigger, so nothing reaches the database and no other
  automation (flows, roll-ups, sharing recalculation) runs. Keep at least one DML-based integration
  test per object. Full strategy: skill `sf-fflib-testing`.

Direct instantiation is the leanest option when only one override matters:

```apex
OpportunitiesTriggerHandler domain =
    new OpportunitiesTriggerHandler(new List<Opportunity>{ new Opportunity(Name = 'X') });
domain.onValidate();
```

## 7. Error handling

| Mechanism | Use |
| --- | --- |
| `record.addError(String)` / `field.addError(String)` | Block the save with a user-facing message; partial success preserved for the other rows |
| `error(message, record)` / `error(message, record, field)` | Same message, additionally captured in `fflib_SObjectDomain.Errors` for tests. Returns the message, so it composes with `addError` |
| `throw new fflib_SObjectDomain.DomainException(msg)` | Programmer error or a condition where no partial success is acceptable - kills the whole DML |
| Custom `XxxDomainException extends Exception` | Domain-specific failure surfaced to a service |

The idiom is `opp.AccountId.addError(error('message', opp, Opportunity.AccountId));` - `error(...)`
returns the string that `addError` consumes, and as a side effect registers it for assertions.

Partial-success semantics:

- `addError` inside a trigger marks only that row as failed. With `Database.insert(records, false)`
  or Bulk API, good rows still commit.
- An uncaught exception (including `DomainException`) fails the entire DML statement and rolls the
  transaction back to the start of that statement.
- Errors added in a **before** phase are surfaced before the record is written; errors added in an
  **after** phase roll back the row's insert.

Error classes carried by `fflib_SObjectDomain` (all deprecated aliases of the `fflib_SObjects`
equivalents, still used by the `Errors` factory):

| Class | Fields |
| --- | --- |
| `abstract class Error` | `String message`, `fflib_SObjectDomain domain` |
| `virtual class ObjectError extends Error` | `SObject record` |
| `virtual class FieldError extends ObjectError` | `SObjectField field` |
| `class ErrorFactory` | `error(...)` overloads, `List<Error> getAll()`, `void clearAll()` |

## 8. Domain classes beyond triggers

A domain class is a behaviour-bearing collection, not only a trigger handler. Two further shapes:

**Custom-object domain with business methods.** Registered in `Application.Domain` and constructed
by the service:

```apex
public inherited sharing class Projects extends fflib_SObjects implements IProjects
{
    public static IProjects newInstance(List<Project__c> records)
    {
        return (IProjects) Application.Domain.newInstance(records);
    }

    public Projects(List<Project__c> records) { super(records); }

    public void advanceStage(String newStage, fflib_ISObjectUnitOfWork uow)
    {
        for (Project__c project : (List<Project__c>) getRecords())
        {
            if (project.Stage__c == newStage) { continue; }
            project.Stage__c = newStage;
            uow.registerDirty(project, new List<SObjectField>{ Project__c.Stage__c });
        }
    }

    public class Constructor implements fflib_IDomainConstructor
    {
        public fflib_IDomain construct(List<Object> objectList)
        {
            return new Projects((List<Project__c>) objectList);
        }
    }
}
```

`fflib_IDomainConstructor.construct(List<Object>)` is the modern constructor interface accepted by
`fflib_Application.DomainFactory`; `fflib_SObjectDomain.IConstructable.construct(List<SObject>)` is
the one the **trigger** dispatcher requires. A class used for both needs the `IConstructable` form -
`fflib_Application.DomainFactory.newInstance` explicitly tests for `IConstructable2`, then
`IConstructable`, and only then falls back to `fflib_IDomainConstructor`.

The samplecode `Opportunities.Constructor` declares the return type as `fflib_SObjects` rather than
the interface's `fflib_IDomain`, which implies Apex accepts a covariant return here; that behaviour
is `[unverified]` against the Apex Developer Guide. Declare your own `construct` with the exact
interface return type (`fflib_IDomain` or `fflib_SObjectDomain`) and the question never arises.

**Child-collection domain.** Keep child logic in the child's own domain and let the parent domain
delegate, exactly as samplecode `Opportunities.applyDiscount` hands off to
`IOpportunityLineItems.applyDiscount(...)`. This keeps each domain's record type homogeneous and
keeps the UoW registration close to the records being changed.

## 9. Domain validation versus validation rules versus Flow

| Rule | Put it in |
| --- | --- |
| Single-field format or required-if, expressible in formula syntax, must apply to every API caller | Validation rule (fastest, declarative, no test coverage cost) |
| Cross-record or cross-object invariant, needs a query or iteration | Domain `onValidate` |
| Rule with an admin-tunable threshold | Domain `onValidate`, threshold in custom metadata |
| Screen-time guidance that should not block API writes | Flow / LWC validation, never the domain |
| Rule that must be bypassable for data loads | Domain, gated by the bypass switch (skill `sf-fflib-operations`) |

Order of execution matters: validation rules run before after-triggers, so an `onValidate` message
is only seen once all validation rules pass. See
[Triggers and order of execution](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm)
and skill `sf-flow-automation` for the record-triggered-flow interleaving.

## 10. Review checklist

| # | Check |
| --- | --- |
| 1 | Trigger body is a single `fflib_SObjectDomain.triggerHandler(X.class)` call, all seven events declared |
| 2 | Domain exposes `public class Constructor implements fflib_SObjectDomain.IConstructable` |
| 3 | Subclass constructor takes the concrete `List<Xxx>` type |
| 4 | No SOQL, no DML, no `commitWork()`, no `System.enqueueJob` inside the domain |
| 5 | Loops iterate `Records` / `getRecords()`; no single-record assumptions, no `Records[0]` |
| 6 | `onValidate(Map)` used for change rules; `getChangedRecords` used instead of manual old/new diffing |
| 7 | `Configuration.disableTriggerCRUDSecurity()` present only where user-mode DML or an event subscriber justifies it |
| 8 | `enableTriggerState()` only where before/after state transfer is genuinely needed |
| 9 | Validation messages are user-readable and created through `error(...)` so tests can assert them |
| 10 | Cross-object work delegated to a service, never inlined in the domain |
| 11 | A DML-free test exists per validation rule plus one DML integration test per object |
| 12 | `vf-check analyzer --changed` clean at severity 3 or better |
