# Trigger Framework Reference

A complete, dependency-free trigger handler framework for `vibe-force` projects: one trigger per
object, one handler class per object, deterministic dispatch, a bypass API for data loads and
migrations, and a recursion budget. Copy the three base classes once per project into
`force-app/main/default/classes/framework/`, then write one handler per object.

Grounding: [Triggers and Order of Execution](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm),
[Trigger Context Variables](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables.htm),
[Trigger and Bulk Request Best Practices](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_bestpract.htm),
[Trigger Exceptions](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_exceptions.htm).

## Why the framework exists

| Platform fact (documented) | Consequence for design |
| --- | --- |
| If more than one trigger is defined on an object for the same event, the order of execution is not guaranteed | Exactly one trigger per object; ordering lives in Apex you control |
| Triggers always run implicitly in a `without sharing` context; they cannot carry a sharing declaration | Delegate to a handler class that declares `with sharing`, so record visibility is explicit |
| From API 67.0, database operations inside a trigger body run in **user mode**, overriding the trigger's `without sharing` | State the access mode on every query and DML in the handler |
| Apex trigger batch size is 200 (2,000 for platform events and Change Data Capture) | A single DML of 10,000 records invokes the trigger 50 times; per-invocation static state is reused |
| Total stack depth for Apex that recursively fires triggers is 16 | A recursion budget must be enforced in code, not left to the limit |
| Static variables are not reset between the retry attempts of a partial-success bulk DML call, and are not reverted by `Database.rollback` | Guards must be idempotent and re-entrant, not one-shot booleans |
| An unhandled exception in a trigger marks every record in scope as failed | Validation uses `addError`, not `throw` |
| Users experience less delay when errors are added in before triggers | Field-level validation belongs in `beforeInsert` / `beforeUpdate` |

## Files

| File | Role |
| --- | --- |
| `TriggerHandler.cls` | abstract base: dispatch, bypass, recursion budget |
| `TriggerContext.cls` | typed view of `Trigger.*` so handlers are unit-testable without DML |
| `TriggerBypass.cls` | named bypass registry shared with Flows via an invocable action |
| `<Object>TriggerHandler.cls` | one per object, overrides only the events it needs |
| `<Object>Trigger.trigger` | 3 lines, no logic |

## `TriggerHandler` base class

```apex
/**
 * Base class for all trigger handlers. Subclasses override only the phases they use.
 * Dispatch is driven by Trigger.operationType so a subclass can never be wired to the
 * wrong phase by accident.
 */
public inherited sharing abstract class TriggerHandler {
    /** Per-handler invocation counter, keyed by concrete handler name. */
    @TestVisible
    private static Map<String, Integer> loopCounts = new Map<String, Integer>();

    /** Default recursion budget: handler re-entry beyond this throws. */
    @TestVisible
    private static Map<String, Integer> loopMax = new Map<String, Integer>();

    private static final Integer DEFAULT_MAX_LOOPS = 5;

    @TestVisible
    protected TriggerContext context;

    private String handlerName {
        get {
            return String.valueOf(this).substringBefore(':');
        }
    }

    /** Entry point called from the trigger. */
    public void run() {
        run(TriggerContext.fromTrigger());
    }

    /** Test-friendly entry point: pass a synthetic context, no DML required. */
    @TestVisible
    protected void run(TriggerContext ctx) {
        this.context = ctx;

        if (ctx == null || ctx.operation == null) {
            throw new TriggerHandlerException(
                'TriggerHandler.run() requires a trigger context. Call it from a trigger.'
            );
        }
        if (TriggerBypass.isBypassed(handlerName) || TriggerBypass.isBypassed(ctx.sObjectName)) {
            return;
        }

        guardRecursion();

        switch on ctx.operation {
            when BEFORE_INSERT   { beforeInsert(); }
            when BEFORE_UPDATE   { beforeUpdate(); }
            when BEFORE_DELETE   { beforeDelete(); }
            when AFTER_INSERT    { afterInsert(); }
            when AFTER_UPDATE    { afterUpdate(); }
            when AFTER_DELETE    { afterDelete(); }
            when AFTER_UNDELETE  { afterUndelete(); }
        }
    }

    /** Raise or lower the recursion budget for this handler, e.g. in a data-migration script. */
    public void setMaxLoopCount(Integer max) {
        loopMax.put(handlerName, max);
    }

    private void guardRecursion() {
        String key = handlerName + '|' + context.operation.name();
        Integer count = loopCounts.containsKey(key) ? loopCounts.get(key) + 1 : 1;
        loopCounts.put(key, count);

        Integer max = loopMax.containsKey(handlerName)
            ? loopMax.get(handlerName)
            : DEFAULT_MAX_LOOPS;

        if (max != null && count > max) {
            throw new TriggerHandlerException(
                'Maximum trigger recursion of ' + max + ' exceeded for ' + key
                + '. Review the handler for self-triggering DML.'
            );
        }
    }

    @TestVisible
    private static void resetLoopCounts() {
        loopCounts = new Map<String, Integer>();
        loopMax = new Map<String, Integer>();
    }

    // Overridable phases. Defaults are intentionally empty.
    protected virtual void beforeInsert() {}
    protected virtual void beforeUpdate() {}
    protected virtual void beforeDelete() {}
    protected virtual void afterInsert() {}
    protected virtual void afterUpdate() {}
    protected virtual void afterDelete() {}
    protected virtual void afterUndelete() {}

    public class TriggerHandlerException extends Exception {}
}
```

`inherited sharing` on the base class is deliberate: it lets the concrete handler decide, and the
base never performs a database operation of its own.

## `TriggerContext`

```apex
/**
 * Immutable, typed snapshot of Trigger.* state. Handlers read this instead of Trigger.*,
 * which makes every handler unit-testable with synthetic records and no DML.
 */
public inherited sharing class TriggerContext {
    public System.TriggerOperation operation { get; private set; }
    public List<SObject> newList { get; private set; }
    public Map<Id, SObject> newMap { get; private set; }
    public List<SObject> oldList { get; private set; }
    public Map<Id, SObject> oldMap { get; private set; }
    public String sObjectName { get; private set; }

    private TriggerContext() {}

    public static TriggerContext fromTrigger() {
        if (!Trigger.isExecuting) {
            return null;
        }
        TriggerContext ctx = new TriggerContext();
        ctx.operation = Trigger.operationType;
        ctx.newList = Trigger.new;
        ctx.newMap = Trigger.newMap;
        ctx.oldList = Trigger.old;
        ctx.oldMap = Trigger.oldMap;
        List<SObject> sample = Trigger.new != null ? Trigger.new : Trigger.old;
        ctx.sObjectName = sample.getSObjectType().getDescribe().getName();
        return ctx;
    }

    /** Build a synthetic context in tests. */
    @TestVisible
    public static TriggerContext forTest(
        System.TriggerOperation op,
        List<SObject> newRecords,
        List<SObject> oldRecords
    ) {
        TriggerContext ctx = new TriggerContext();
        ctx.operation = op;
        ctx.newList = newRecords;
        ctx.oldList = oldRecords;
        ctx.newMap = newRecords == null ? null : new Map<Id, SObject>(newRecords);
        ctx.oldMap = oldRecords == null ? null : new Map<Id, SObject>(oldRecords);
        List<SObject> sample = newRecords != null ? newRecords : oldRecords;
        ctx.sObjectName = sample.getSObjectType().getDescribe().getName();
        return ctx;
    }

    /** True when the named field differs between the old and new version of the record. */
    public Boolean hasChanged(SObject record, SObjectField field) {
        if (oldMap == null) {
            return true;
        }
        SObject prior = oldMap.get((Id) record.get('Id'));
        return prior == null || prior.get(field) != record.get(field);
    }

    /** Records whose named field changed. */
    public List<SObject> changed(SObjectField field) {
        List<SObject> out = new List<SObject>();
        for (SObject rec : newList) {
            if (hasChanged(rec, field)) {
                out.add(rec);
            }
        }
        return out;
    }
}
```

## `TriggerBypass`

A bypass registry is mandatory for data loads, one-off migrations, and cross-object cascades that
must not re-enter. Keep it explicit and auditable; never a boolean `Test.isRunningTest()` escape.

```apex
public inherited sharing class TriggerBypass {
    @TestVisible
    private static Set<String> bypassed = new Set<String>();

    public static void bypass(String name) {
        bypassed.add(name.toLowerCase());
    }

    public static void clear(String name) {
        bypassed.remove(name.toLowerCase());
    }

    public static void clearAll() {
        bypassed = new Set<String>();
    }

    public static Boolean isBypassed(String name) {
        return name != null && bypassed.contains(name.toLowerCase());
    }

    /** Setting-driven bypass so admins can disable automation without a deployment. */
    public static void applyOrgDefaults() {
        Trigger_Settings__c settings = Trigger_Settings__c.getInstance();
        if (settings != null && String.isNotBlank(settings.Bypassed_Handlers__c)) {
            for (String name : settings.Bypassed_Handlers__c.split(',')) {
                bypass(name.trim());
            }
        }
    }
}
```

`Trigger_Settings__c` is a hierarchy custom setting with a single text field
`Bypassed_Handlers__c`; `getInstance()` reads from the application cache and costs no SOQL.

## Concrete handler

```apex
public with sharing class CaseTriggerHandler extends TriggerHandler {
    protected override void beforeInsert() {
        CaseDomain.applyDefaults((List<Case>) context.newList);
        CaseDomain.validate((List<Case>) context.newList, null);
    }

    protected override void beforeUpdate() {
        CaseDomain.validate((List<Case>) context.newList, (Map<Id, Case>) context.oldMap);
    }

    protected override void afterInsert() {
        CaseEscalationService.escalate((List<Case>) context.newList);
    }

    protected override void afterUpdate() {
        // Only records whose Priority actually changed need re-escalation.
        List<Case> priorityChanged = (List<Case>) context.changed(Case.Priority);
        if (!priorityChanged.isEmpty()) {
            CaseEscalationService.escalate(priorityChanged);
        }
    }
}
```

```apex
trigger CaseTrigger on Case (
    before insert, before update, before delete,
    after insert, after update, after delete, after undelete
) {
    new CaseTriggerHandler().run();
}
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>67.0</apiVersion>
    <status>Active</status>
</ApexTrigger>
```

## Phase placement rules

| Work | Phase | Why |
| --- | --- | --- |
| Field defaulting on the triggering record | `before insert` / `before update` | `Trigger.new` is mutable only in before triggers; no extra DML |
| Field validation and `addError` | `before insert` / `before update` | documented as producing less delay for users |
| Reading the record Id, or related-record DML | `after insert` | Ids do not exist before the save |
| Creating or updating child records | `after insert` / `after update` | needs committed parent Ids |
| Roll-ups onto a parent | `after` phases | must read the post-save child state |
| Enqueueing async work | `after` phases | jobs are enqueued at commit; see `sf-async-apex-patterns` |
| Preventing a delete | `before delete` with `addError` on `Trigger.old` | `Trigger.new` is unavailable in `before delete` |
| Reacting to a recycle-bin restore | `after undelete` | only phase where `Trigger.isUndelete` is true |

Mutation legality, straight from the platform documentation:

| Trigger event | Change fields via `Trigger.new` | Update original via DML | Delete original via DML |
| --- | --- | --- | --- |
| `before insert` | allowed | n/a | n/a |
| `after insert` | not allowed (runtime error) | allowed | allowed but pointless |
| `before update` | allowed | not allowed (runtime error) | not allowed (runtime error) |
| `after update` | not allowed (runtime error) | allowed (recursion risk) | allowed |
| `before delete` | not allowed; `Trigger.new` unavailable | allowed | not allowed (runtime error) |
| `after delete` | not allowed | n/a | n/a |

## Handler tests

Two shapes. Synthetic-context tests exercise branch logic with zero DML; DML tests prove the
trigger is actually wired and that the framework dispatches.

```apex
@IsTest
private class TriggerHandlerTest {
    /** A minimal handler that records which phases ran. */
    private class SpyHandler extends TriggerHandler {
        public List<String> calls = new List<String>();
        protected override void beforeInsert() { calls.add('beforeInsert'); }
        protected override void afterUpdate()  { calls.add('afterUpdate'); }
        @TestVisible
        public void runWith(TriggerContext ctx) { run(ctx); }
    }

    @IsTest
    static void dispatchesOnOperationType() {
        SpyHandler h = new SpyHandler();
        TriggerContext ctx = TriggerContext.forTest(
            System.TriggerOperation.BEFORE_INSERT,
            new List<Case>{ new Case(Subject = 'a') },
            null
        );

        h.runWith(ctx);

        Assert.areEqual(new List<String>{ 'beforeInsert' }, h.calls,
            'Only the beforeInsert phase should run for BEFORE_INSERT');
    }

    @IsTest
    static void bypassSuppressesEveryPhase() {
        TriggerBypass.bypass('SpyHandler');
        SpyHandler h = new SpyHandler();

        h.runWith(TriggerContext.forTest(
            System.TriggerOperation.BEFORE_INSERT,
            new List<Case>{ new Case(Subject = 'a') },
            null
        ));

        Assert.isTrue(h.calls.isEmpty(), 'A bypassed handler must not run any phase');
        TriggerBypass.clearAll();
    }

    @IsTest
    static void recursionBudgetThrowsBeyondMax() {
        TriggerHandler.resetLoopCounts();
        SpyHandler h = new SpyHandler();
        h.setMaxLoopCount(2);
        TriggerContext ctx = TriggerContext.forTest(
            System.TriggerOperation.BEFORE_INSERT,
            new List<Case>{ new Case(Subject = 'a') },
            null
        );

        h.runWith(ctx);
        h.runWith(ctx);
        try {
            h.runWith(ctx);
            Assert.fail('Expected TriggerHandler.TriggerHandlerException on the third entry');
        } catch (TriggerHandler.TriggerHandlerException e) {
            Assert.isTrue(e.getMessage().contains('Maximum trigger recursion'), e.getMessage());
        }
    }

    @IsTest
    static void changedDetectsOnlyModifiedRecords() {
        Id a = TestIds.next(Case.SObjectType);
        Id b = TestIds.next(Case.SObjectType);
        TriggerContext ctx = TriggerContext.forTest(
            System.TriggerOperation.AFTER_UPDATE,
            new List<Case>{ new Case(Id = a, Priority = 'High'), new Case(Id = b, Priority = 'Low') },
            new List<Case>{ new Case(Id = a, Priority = 'Low'),  new Case(Id = b, Priority = 'Low') }
        );

        List<SObject> changed = ctx.changed(Case.Priority);

        Assert.areEqual(1, changed.size(), 'Only the record whose Priority moved should be returned');
        Assert.areEqual(a, changed[0].Id);
    }
}
```

`TestIds` is a two-line helper that fabricates deterministic sObject Ids so map-based logic can be
tested without DML:

```apex
@IsTest
public class TestIds {
    private static Integer counter = 1;
    public static Id next(SObjectType type) {
        return Id.valueOf(
            type.getDescribe().getKeyPrefix()
                + '000000000'
                + String.valueOf(counter++).leftPad(3, '0')
        );
    }
}
```

Bulk wiring test — proves the trigger file exists, is active, and survives 200 records:

```apex
@IsTest
private class CaseTriggerTest {
    @IsTest
    static void bulkInsertEscalatesPlatinumAccountsOnly() {
        Account platinum = new Account(Name = 'Platinum Co', Tier__c = 'Platinum');
        Account standard = new Account(Name = 'Standard Co', Tier__c = 'Standard');
        insert new List<Account>{ platinum, standard };

        List<Case> cases = new List<Case>();
        for (Integer i = 0; i < 200; i++) {
            cases.add(new Case(
                Subject = 'Case ' + i,
                Priority = 'Low',
                AccountId = (i % 2 == 0) ? platinum.Id : standard.Id
            ));
        }

        Test.startTest();
        insert cases;
        Test.stopTest();

        Integer escalated = [
            SELECT COUNT() FROM Case WHERE Priority = 'High' AND AccountId = :platinum.Id
        ];
        Assert.areEqual(100, escalated, 'Every Platinum case should be escalated');
        Assert.areEqual(
            0,
            [SELECT COUNT() FROM Case WHERE Priority = 'High' AND AccountId = :standard.Id],
            'Standard-tier cases must be left alone'
        );
    }
}
```

Assertion style, coverage rules, and mocking are covered in `sf-apex-testing`. Limit consumption
per trigger invocation is covered in `sf-governor-limits`.

## Review checklist

| Check | Pass condition |
| --- | --- |
| Trigger count per object | exactly one `*.trigger` file |
| Trigger body | a single `new <Object>TriggerHandler().run();` |
| Handler sharing | explicit `with sharing` (or a justified `inherited sharing`) |
| Access mode | every SOQL/DML in the handler chain states `WITH USER_MODE`/`WITH SYSTEM_MODE` or `as user`/`as system` |
| Queries in loops | none — `vf-check analyzer` flags `AvoidSoqlInLoops` |
| DML in loops | none — `vf-check analyzer` flags `AvoidDmlStatementsInLoops` |
| Validation mechanism | `addError`, not `throw`, for user-facing rules |
| Recursion | Id-set or budget guard present when the handler writes to its own object |
| Bypass | registry-based, never `Test.isRunningTest()` |
| Tests | one synthetic-context test per branch plus one 200-record bulk test |
| Gate | `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed` passes |

## Sources

| Topic | URL |
| --- | --- |
| Triggers and order of execution | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm |
| Trigger context variables | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables.htm |
| Context variable considerations | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables_considerations.htm |
| Trigger and bulk request best practices | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_bestpract.htm |
| Trigger exceptions and `addError` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_exceptions.htm |
| Sharing keywords, trigger implementation section | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_keywords_sharing.htm |
| `TriggerOperation` enum | https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_enum_System_TriggerOperation.htm |
| Static Apex limits (trigger batch size 200) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm |
| Custom settings access from Apex | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_custom_settings.htm |
