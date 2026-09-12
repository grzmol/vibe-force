# Apex Enterprise Patterns Reference

Runnable, dependency-free implementations of the four layers used by `vibe-force` projects:
Selector, Domain, Service, Unit of Work. The patterns originate in the Dreamforce 2012 "Apex
Enterprise Patterns" session and are maintained as
[fflib-apex-common](https://github.com/apex-enterprise-patterns/fflib-apex-common). The code below
is a minimal equivalent that can be dropped into any project without installing a package, so a
`vibe-force` story never blocks on an unmanaged dependency.

Trailhead modules: [Separation of Concerns](https://trailhead.salesforce.com/en/content/learn/modules/apex_patterns_sl/apex_patterns_sl_soc),
[Service Layer](https://trailhead.salesforce.com/en/content/learn/modules/apex_patterns_sl),
[Domain and Selector Layer](https://trailhead.salesforce.com/en/content/learn/modules/apex_patterns_dsl).

## Layer contract

| Layer | Naming | Owns | Must not |
| --- | --- | --- | --- |
| Selector | `<Object>Selector` | every SOQL statement for one sObject, its field list, the access mode, `ORDER BY` | business rules, DML, cross-object joins beyond declared relationships |
| Domain | `<Object>Domain` | per-record defaulting, validation, `addError` for one sObject | queries for other objects, orchestration, DML |
| Service | `<Capability>Service` | one named business transaction, ordering, transaction boundary | inline SOQL, inline DML ordering, presentation concerns |
| Unit of Work | `UnitOfWork` | registration of new/dirty/deleted records and a single ordered commit | business rules, validation |
| Controller | `<Feature>Controller` | `@AuraEnabled` surface, DTO shaping, `AuraHandledException` | business rules, SOQL |

Dependency direction is one-way: Controller → Service → (Domain, Selector, UnitOfWork). A Selector
never calls a Service. A Domain never calls a Service.

## Selector

```apex
/**
 * Base selector. Centralises the access mode and the "always these fields" rule so a
 * reviewer can verify field-level security posture in one place.
 */
public inherited sharing abstract class SObjectSelector {
    protected abstract SObjectType getSObjectType();
    protected abstract List<SObjectField> getSObjectFieldList();

    /** Override to false only for a documented privilege elevation. */
    protected virtual Boolean isEnforcingFls() {
        return true;
    }

    protected String fieldList() {
        List<String> names = new List<String>();
        for (SObjectField f : getSObjectFieldList()) {
            names.add(f.getDescribe().getName());
        }
        return String.join(names, ', ');
    }

    protected String baseQuery() {
        return 'SELECT ' + fieldList() + ' FROM ' + getSObjectType().getDescribe().getName();
    }

    protected AccessLevel accessLevel() {
        return isEnforcingFls() ? AccessLevel.USER_MODE : AccessLevel.SYSTEM_MODE;
    }

    protected List<SObject> run(String soql, Map<String, Object> binds) {
        return Database.queryWithBinds(soql, binds, accessLevel());
    }
}
```

`Database.queryWithBinds` **requires** the `accessLevel` argument, which is why it is the right
primitive for a selector: the mode can never be left implicit. Bind maps also remove the
`String.escapeSingleQuotes` class of defect.

```apex
public inherited sharing class OpportunitySelector extends SObjectSelector {
    protected override SObjectType getSObjectType() {
        return Opportunity.SObjectType;
    }

    protected override List<SObjectField> getSObjectFieldList() {
        return new List<SObjectField>{
            Opportunity.Id,
            Opportunity.Name,
            Opportunity.AccountId,
            Opportunity.Amount,
            Opportunity.CloseDate,
            Opportunity.StageName
        };
    }

    public List<Opportunity> selectById(Set<Id> ids) {
        return (List<Opportunity>) run(
            baseQuery() + ' WHERE Id IN :ids ORDER BY CloseDate',
            new Map<String, Object>{ 'ids' => ids }
        );
    }

    public List<Opportunity> selectOpenByIds(Set<Id> ids) {
        return (List<Opportunity>) run(
            baseQuery()
                + ' WHERE Id IN :ids AND StageName NOT IN :closed'
                + ' ORDER BY CloseDate',
            new Map<String, Object>{
                'ids' => ids,
                'closed' => new List<String>{ 'Closed Won', 'Closed Lost' }
            }
        );
    }

    /** Parent-child subquery: each relationship subquery counts as an extra SOQL query. */
    public List<Opportunity> selectByIdWithLineItems(Set<Id> ids) {
        return (List<Opportunity>) run(
            'SELECT ' + fieldList()
                + ', (SELECT Id, Quantity, UnitPrice, PricebookEntryId FROM OpportunityLineItems)'
                + ' FROM Opportunity WHERE Id IN :ids',
            new Map<String, Object>{ 'ids' => ids }
        );
    }
}
```

Static SOQL is still preferred when the query shape is fixed — it is compile-checked and
dependency-tracked by the Metadata API. Use the dynamic base only where the field list is shared:

```apex
public List<Opportunity> selectRecentlyClosed(Integer days) {
    Date since = Date.today().addDays(-days);
    return [
        SELECT Id, Name, Amount, CloseDate, AccountId, StageName
        FROM Opportunity
        WHERE StageName = 'Closed Won' AND CloseDate >= :since
        WITH USER_MODE
        ORDER BY CloseDate DESC
        LIMIT 2000
    ];
}
```

Selector rules:

| Rule | Reason |
| --- | --- |
| One selector class per sObject | field lists and index-friendly filters stay in one place |
| Always `ORDER BY` when order matters to a caller | record Ids are not created in ascending order |
| Always an explicit `LIMIT` on unbounded reads | 50,000-row SOQL limit; see `sf-governor-limits` |
| Never accept a raw SOQL fragment from a caller | injection surface; accept typed arguments |
| Subqueries counted | relationship subqueries each consume a query against the aggregate limit |
| Large volumes | return `Database.QueryLocator` and hand it to Batch Apex (`sf-async-apex-patterns`) |

## Domain

```apex
/** Base domain: holds the records for one sObject and the change context. */
public inherited sharing abstract class Domain {
    protected List<SObject> records;
    protected Map<Id, SObject> priorById;

    protected Domain(List<SObject> records, Map<Id, SObject> priorById) {
        this.records = records == null ? new List<SObject>() : records;
        this.priorById = priorById;
    }

    protected Boolean hasChanged(SObject rec, SObjectField field) {
        if (priorById == null) {
            return true;
        }
        SObject prior = priorById.get((Id) rec.get('Id'));
        return prior == null || prior.get(field) != rec.get(field);
    }
}
```

```apex
public inherited sharing class OpportunityDomain extends Domain {
    public OpportunityDomain(List<Opportunity> records, Map<Id, Opportunity> priorById) {
        super(records, priorById);
    }

    public void applyDefaults() {
        for (Opportunity o : (List<Opportunity>) records) {
            if (o.StageName == null) {
                o.StageName = 'Prospecting';
            }
            if (o.CloseDate == null) {
                o.CloseDate = Date.today().addDays(30);
            }
        }
    }

    public void validate() {
        for (Opportunity o : (List<Opportunity>) records) {
            if (o.Amount != null && o.Amount < 0) {
                o.Amount.addError(Label.Opportunity_Amount_Negative);
            }
            if (hasChanged(o, Opportunity.StageName)
                && o.StageName == 'Closed Won'
                && o.Amount == null) {
                o.Amount.addError(Label.Opportunity_Amount_Required_To_Close);
            }
        }
    }
}
```

Why `addError` instead of a thrown exception: the runtime still processes every record to build a
complete error list, and partial saves from the API keep the valid subset. An unhandled exception
marks every record in scope as failed.

## Unit of Work

```apex
/**
 * Registers records and commits them in a declared sObject order inside one savepoint.
 * Order matters because parents must exist before children.
 */
public inherited sharing class UnitOfWork {
    private final List<SObjectType> order;
    private final Map<String, List<SObject>> newByType = new Map<String, List<SObject>>();
    private final Map<String, Map<Id, SObject>> dirtyByType = new Map<String, Map<Id, SObject>>();
    private final Map<String, Map<Id, SObject>> deletedByType = new Map<String, Map<Id, SObject>>();
    private final List<Relationship> relationships = new List<Relationship>();

    private class Relationship {
        SObject child;
        SObjectField field;
        SObject parent;
    }

    public UnitOfWork(List<SObjectType> commitOrder) {
        this.order = commitOrder;
        for (SObjectType t : commitOrder) {
            String key = String.valueOf(t);
            newByType.put(key, new List<SObject>());
            dirtyByType.put(key, new Map<Id, SObject>());
            deletedByType.put(key, new Map<Id, SObject>());
        }
    }

    public void registerNew(SObject record) {
        assertKnown(record);
        newByType.get(String.valueOf(record.getSObjectType())).add(record);
    }

    /** Register a child whose lookup is resolved after the parent is inserted. */
    public void registerNew(SObject child, SObjectField lookup, SObject parent) {
        registerNew(child);
        Relationship r = new Relationship();
        r.child = child;
        r.field = lookup;
        r.parent = parent;
        relationships.add(r);
    }

    public void registerDirty(SObject record) {
        assertKnown(record);
        dirtyByType.get(String.valueOf(record.getSObjectType())).put(record.Id, record);
    }

    public void registerDeleted(SObject record) {
        assertKnown(record);
        deletedByType.get(String.valueOf(record.getSObjectType())).put(record.Id, record);
    }

    public void commitWork() {
        Savepoint sp = Database.setSavepoint();
        try {
            for (SObjectType t : order) {
                String key = String.valueOf(t);
                List<SObject> inserts = newByType.get(key);
                if (!inserts.isEmpty()) {
                    insert as user inserts;
                    resolveRelationships();
                }
                Map<Id, SObject> updates = dirtyByType.get(key);
                if (!updates.isEmpty()) {
                    update as user updates.values();
                }
            }
            // Children first on the way out.
            for (Integer i = order.size() - 1; i >= 0; i--) {
                Map<Id, SObject> deletes = deletedByType.get(String.valueOf(order[i]));
                if (!deletes.isEmpty()) {
                    delete as user deletes.values();
                }
            }
        } catch (Exception e) {
            Database.rollback(sp);
            Database.releaseSavepoint(sp);
            throw e;
        }
    }

    private void resolveRelationships() {
        for (Relationship r : relationships) {
            if (r.parent.Id != null && r.child.get(r.field) == null) {
                r.child.put(r.field, r.parent.Id);
            }
        }
    }

    private void assertKnown(SObject record) {
        if (!newByType.containsKey(String.valueOf(record.getSObjectType()))) {
            throw new UnitOfWorkException(
                String.valueOf(record.getSObjectType()) + ' is not in the declared commit order.'
            );
        }
    }

    public class UnitOfWorkException extends Exception {}
}
```

Savepoint budget: `Database.setSavepoint()` costs one DML statement (of 150) and zero DML rows; the
rollback costs one more DML statement. One savepoint per `commitWork()` is the intended cost. Never
create a savepoint per record.

## Service

```apex
public with sharing class OpportunityCloseService {
    public class CloseRequest {
        public Id opportunityId;
        public Decimal finalAmount;
    }

    /**
     * One named business transaction: close the opportunities, stamp the amount, create the
     * delivery kickoff task, and roll the whole thing back on any failure.
     */
    public static void closeWon(List<CloseRequest> requests) {
        if (requests == null || requests.isEmpty()) {
            return;
        }

        Map<Id, Decimal> amountById = new Map<Id, Decimal>();
        for (CloseRequest r : requests) {
            amountById.put(r.opportunityId, r.finalAmount);
        }

        List<Opportunity> open = new OpportunitySelector().selectOpenByIds(amountById.keySet());
        if (open.isEmpty()) {
            throw new OpportunityCloseException('No open opportunities matched the request.');
        }

        UnitOfWork uow = new UnitOfWork(
            new List<SObjectType>{ Opportunity.SObjectType, Task.SObjectType }
        );

        for (Opportunity o : open) {
            Opportunity change = new Opportunity(
                Id = o.Id,
                StageName = 'Closed Won',
                Amount = amountById.get(o.Id) != null ? amountById.get(o.Id) : o.Amount,
                CloseDate = Date.today()
            );
            uow.registerDirty(change);
            uow.registerNew(new Task(
                WhatId = o.Id,
                Subject = 'Kick off delivery for ' + o.Name,
                Status = 'Not Started',
                ActivityDate = Date.today().addDays(3)
            ));
        }

        uow.commitWork();
    }

    public class OpportunityCloseException extends Exception {}
}
```

Service rules:

| Rule | Reason |
| --- | --- |
| `public static` methods, bulk signatures (`List<...>`) | a service called from a trigger receives up to 200 records |
| `with sharing` on the class | the transaction runs as the user who started it |
| One transaction boundary per public method | callers can compose without nested savepoints |
| Throw typed exceptions | callers (controller, Queueable, REST) map them to their own surface |
| No SOQL, no ordering of DML | delegated to Selector and Unit of Work |
| Callouts never inside `commitWork()` | savepoints must be released before a callout |

## Controller layer

```apex
public with sharing class OpportunityCloseController {
    public class Result {
        @AuraEnabled public Integer closed;
        @AuraEnabled public String message;
    }

    @AuraEnabled
    public static Result closeWon(List<Id> opportunityIds, Decimal finalAmount) {
        List<OpportunityCloseService.CloseRequest> requests =
            new List<OpportunityCloseService.CloseRequest>();
        for (Id oppId : opportunityIds) {
            OpportunityCloseService.CloseRequest r = new OpportunityCloseService.CloseRequest();
            r.opportunityId = oppId;
            r.finalAmount = finalAmount;
            requests.add(r);
        }

        try {
            OpportunityCloseService.closeWon(requests);
            Result res = new Result();
            res.closed = opportunityIds.size();
            res.message = 'Closed ' + res.closed + ' opportunities.';
            return res;
        } catch (OpportunityCloseService.OpportunityCloseException e) {
            throw new AuraHandledException(e.getMessage());
        } catch (DmlException e) {
            throw new AuraHandledException(e.getDmlMessage(0));
        }
    }
}
```

`AuraHandledException` is the only exception type whose message reaches the LWC without a stack
trace. DTO inner classes need `@AuraEnabled` on each exposed member.

## Testability payoff

The layering exists so tests can be fast and narrow. With a Selector interface the Service is
testable with the Stub API and zero DML:

```apex
public interface IOpportunitySelector {
    List<Opportunity> selectOpenByIds(Set<Id> ids);
}
```

```apex
@IsTest
private class OpportunityCloseServiceTest {
    private class SelectorStub implements System.StubProvider {
        private final List<Opportunity> canned;
        SelectorStub(List<Opportunity> canned) { this.canned = canned; }
        public Object handleMethodCall(
            Object stubbed, String method, Type returnType,
            List<Type> paramTypes, List<String> paramNames, List<Object> args
        ) {
            return method == 'selectOpenByIds' ? canned : null;
        }
    }

    @IsTest
    static void closeWonStampsStageAndAmount() {
        // Arrange: no DML, synthetic Ids, stubbed selector.
        Id oppId = TestIds.next(Opportunity.SObjectType);
        IOpportunitySelector stub = (IOpportunitySelector) Test.createStub(
            IOpportunitySelector.class,
            new SelectorStub(new List<Opportunity>{
                new Opportunity(Id = oppId, Name = 'Deal', Amount = 100, StageName = 'Proposal')
            })
        );

        List<Opportunity> selected = stub.selectOpenByIds(new Set<Id>{ oppId });

        Assert.areEqual(1, selected.size(), 'Stub should return the canned record');
        Assert.areEqual('Proposal', selected[0].StageName);
    }
}
```

Stub API constraints that shape the interfaces above: static, private, and inner-class methods
cannot be stubbed, nor can properties, triggers, system types, or `Batchable` implementations —
which is exactly why Selector methods are instance methods on a top-level class implementing an
interface. Full mocking recipes live in `sf-apex-testing`.

## Migration checklist: monolith to layers

| Step | Action | Proof |
| --- | --- | --- |
| 1 | Inventory every SOQL statement in the class; move each into a `<Object>Selector` method | `grep -c "SELECT" <Class>.cls` drops to 0 |
| 2 | Move per-record validation into `<Object>Domain`, switching `throw` to `addError` | existing negative tests still pass |
| 3 | Extract the orchestration body into a `<Capability>Service` static method with a bulk signature | trigger handler shrinks to one call per phase |
| 4 | Replace ad-hoc DML ordering with `UnitOfWork` and a declared commit order | one savepoint per transaction in the debug log |
| 5 | Reduce the controller to DTO shaping plus `AuraHandledException` | controller has no `SELECT` and no `insert`/`update` |
| 6 | Introduce a Selector interface only where a Service test needs a stub | Service tests run with 0 DML statements |
| 7 | Run the gates | `vf-check local --changed` then `vf-check apex --target-org vf-dev` |

Do not introduce a layer that has no second caller and no test benefit. A single-object, single-rule
automation is legitimately a handler plus a domain method; the Service layer earns its place when
two or more objects are written in one transaction.

## Sources

| Topic | URL |
| --- | --- |
| Apex Enterprise Patterns: Service Layer (Trailhead) | https://trailhead.salesforce.com/en/content/learn/modules/apex_patterns_sl |
| Apex Enterprise Patterns: Domain and Selector Layer (Trailhead) | https://trailhead.salesforce.com/en/content/learn/modules/apex_patterns_dsl |
| Separation of Concerns (Trailhead) | https://trailhead.salesforce.com/en/content/learn/modules/apex_patterns_sl/apex_patterns_sl_soc |
| fflib-apex-common | https://github.com/apex-enterprise-patterns/fflib-apex-common |
| fflib sample application | https://github.com/apex-enterprise-patterns/fflib-apex-common-samplecode |
| Access mode for database and search methods | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_enforce_usermode.htm |
| Sharing keywords | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_keywords_sharing.htm |
| Transaction control and savepoints | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction.htm |
| Bulk DML exception handling | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dml_bulk_exceptions.htm |
| Build a mocking framework with the Stub API | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_stub_api.htm |
| Execution governors and limits | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm |
