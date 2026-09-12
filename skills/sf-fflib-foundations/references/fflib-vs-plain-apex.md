# fflib versus plain trigger handler plus service classes

An honest comparison. fflib is not free: it adds indirection, a vendored library, and a learning
curve. This file gives the decision matrix and the same requirement implemented both ways so the
cost is visible rather than asserted.

Library facts referenced here come from `fflib-apex-common` @ `master` commit `dab5977` and
`fflib-apex-common-samplecode` @ `master` commit `4657d63`.

## 1. Decision matrix

Score each row. Three or more "plain" answers means do not adopt fflib; three or more "fflib"
answers means adopt it wholesale rather than partially.

| Dimension | Prefer plain Apex | Prefer fflib |
| --- | --- | --- |
| SObjects with write-side business logic | 1-5 | 6+ |
| Apex classes in the package | < 40 | 40+ |
| Entry points per behaviour | trigger only | trigger + LWC + REST + batch + Flow invocable |
| DML statements in the busiest transaction | < 5, single object | many, across 3+ related objects |
| Need to unit-test service logic with zero DML | occasionally | as policy (fast suites, `RunLocalTests` under 10 min) |
| Team experience with Apex Enterprise Patterns | none, no ramp-up budget | at least one fluent engineer |
| Packaging | single org, unpackaged | 2GP, multi-package, extension packages |
| Primary automation tool | Record-Triggered Flow (skill `sf-flow-automation`) | Apex |
| Lifetime of the codebase | one-off project, < 12 months | product, multi-year |
| Number of engineers touching the same SObject | 1 | 3+ |
| Query reuse - same field set needed by 5+ callers | rare | common |
| Compliance requirement to prove FLS/CRUD enforcement centrally | no | yes (skill `sf-security-model`) |

### Costs you are accepting with fflib

| Cost | Magnitude |
| --- | --- |
| Vendored library in the repo | ~5.6k lines of Apex across 45 classes |
| Files per SObject with behaviour | selector + selector interface + domain + domain interface + service + service interface + service impl = 7 |
| Extra indirection per call | `AccountsService.x()` -> `Application.Service.newInstance` -> `Type.newInstance()` -> `AccountsServiceImpl.x()` |
| Onboarding | a new engineer cannot productively edit the codebase until they understand four layers and the factory |
| Coverage | library tests must be deployed or org coverage drops (see `install-and-layout.md` section 6) |
| Debugging | stack traces pass through `fflib_Application`, `fflib_SObjectUnitOfWork.commitWork`, and Stub API frames (skill `sf-debugging-logs`) |

### Benefits you are buying

| Benefit | Why it is hard to get otherwise |
| --- | --- |
| DML ordering solved once | `fflib_SObjectUnitOfWork` commits by registered SObjectType order and resolves `registerRelationship` lookups after parent insert |
| One SOQL definition per SObject | `getSObjectFieldList()` plus `newQueryFactory()` means every caller gets the same field set, and FLS posture changes in one constructor |
| Unit tests with no DML | `Application.*.setMock` plus `fflib_IDGenerator.generate()` gives real-looking Ids without inserting |
| Bulk safety by construction | services take `Set<Id>` / `List<SObject>`; a per-record service method looks wrong to reviewers |
| Reuse across entry points | trigger, LWC controller, REST resource and batch all call the same service method |

## 2. The requirement, implemented twice

> When an Opportunity reaches `StageName = 'Closed Won'`, create an `Invoice__c` for its Account
> with one `InvoiceLine__c` per `OpportunityLineItem`, and stamp `Account.LastInvoiceDate__c`.
> The same behaviour must be callable from a trigger and from an LWC button.

### 2a. Plain trigger handler plus service class

```apex
// classes/InvoicingService.cls - 1 file, no interface, no factory
public with sharing class InvoicingService {
    public class InvoicingException extends Exception {}

    public static List<Id> createInvoices(Set<Id> opportunityIds) {
        if (opportunityIds == null || opportunityIds.isEmpty()) {
            return new List<Id>();
        }

        List<Opportunity> opps = [
            SELECT Id, AccountId, CloseDate, Name,
                   (SELECT Id, Quantity, UnitPrice, PricebookEntry.Product2Id
                      FROM OpportunityLineItems)
              FROM Opportunity
             WHERE Id IN :opportunityIds AND StageName = 'Closed Won'
              WITH USER_MODE
        ];

        List<Invoice__c> invoices = new List<Invoice__c>();
        Map<Id, Invoice__c> invoiceByOppId = new Map<Id, Invoice__c>();
        Set<Id> accountIds = new Set<Id>();
        for (Opportunity opp : opps) {
            if (opp.AccountId == null) {
                throw new InvoicingException('Opportunity ' + opp.Id + ' has no Account');
            }
            Invoice__c inv = new Invoice__c(
                Account__c = opp.AccountId,
                Opportunity__c = opp.Id,
                InvoiceDate__c = opp.CloseDate);
            invoices.add(inv);
            invoiceByOppId.put(opp.Id, inv);
            accountIds.add(opp.AccountId);
        }

        Savepoint sp = Database.setSavepoint();
        try {
            insert as user invoices;                       // 1st DML: parents

            List<InvoiceLine__c> lines = new List<InvoiceLine__c>();
            for (Opportunity opp : opps) {
                for (OpportunityLineItem oli : opp.OpportunityLineItems) {
                    lines.add(new InvoiceLine__c(
                        Invoice__c = invoiceByOppId.get(opp.Id).Id,   // needs the parent Id
                        Product__c = oli.PricebookEntry.Product2Id,
                        Quantity__c = oli.Quantity,
                        UnitPrice__c = oli.UnitPrice));
                }
            }
            insert as user lines;                          // 2nd DML: children

            List<Account> accounts = new List<Account>();
            for (Id accountId : accountIds) {
                accounts.add(new Account(Id = accountId, LastInvoiceDate__c = System.today()));
            }
            update as user accounts;                       // 3rd DML
        } catch (Exception e) {
            Database.rollback(sp);
            throw e;
        }
        return new List<Id>(new Map<Id, Invoice__c>(invoices).keySet());
    }
}
```

```apex
// classes/OpportunitiesTriggerHandler.cls
public with sharing class OpportunitiesTriggerHandler {
    public static void afterUpdate(List<Opportunity> newRecords, Map<Id, Opportunity> oldMap) {
        Set<Id> newlyWon = new Set<Id>();
        for (Opportunity opp : newRecords) {
            if (opp.StageName == 'Closed Won' && oldMap.get(opp.Id).StageName != 'Closed Won') {
                newlyWon.add(opp.Id);
            }
        }
        if (!newlyWon.isEmpty()) {
            InvoicingService.createInvoices(newlyWon);
        }
    }
}
```

```apex
// classes/OpportunityInvoiceController.cls - LWC entry point
public with sharing class OpportunityInvoiceController {
    @AuraEnabled
    public static List<Id> createInvoice(Id opportunityId) {
        try {
            return InvoicingService.createInvoices(new Set<Id>{ opportunityId });
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
```

**Files: 3.** Testing requires DML: you must insert an Account, Opportunity, Pricebook entry,
Product and OpportunityLineItem before asserting anything. A typical test is 60 lines of setup and
runs in seconds, not milliseconds.

### 2b. fflib

```apex
// service/IInvoicingService.cls
public interface IInvoicingService {
    List<Id> createInvoices(Set<Id> opportunityIds);
}

// service/InvoicingService.cls - static facade
public with sharing class InvoicingService {
    public static List<Id> createInvoices(Set<Id> opportunityIds) {
        return service().createInvoices(opportunityIds);
    }
    private static IInvoicingService service() {
        return (IInvoicingService) Application.Service.newInstance(IInvoicingService.class);
    }
}

// service/InvoicingServiceImpl.cls
public with sharing class InvoicingServiceImpl implements IInvoicingService {
    public class InvoicingException extends Exception {}

    public List<Id> createInvoices(Set<Id> opportunityIds) {
        if (opportunityIds == null || opportunityIds.isEmpty()) {
            return new List<Id>();
        }
        fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();

        // One SOQL, field set owned by the selector, parent+child in a single query.
        List<Opportunity> opps = OpportunitiesSelector.newInstance()
            .selectByIdWithProducts(opportunityIds);

        List<Invoice__c> invoices = new List<Invoice__c>();
        Set<Id> accountIds = new Set<Id>();
        for (Opportunity opp : opps) {
            if (opp.StageName != 'Closed Won') { continue; }
            if (opp.AccountId == null) {
                throw new InvoicingException('Opportunity ' + opp.Id + ' has no Account');
            }
            Invoice__c inv = new Invoice__c(
                Account__c = opp.AccountId,
                Opportunity__c = opp.Id,
                InvoiceDate__c = opp.CloseDate);
            uow.registerNew(inv);                          // no Id yet - that is fine
            invoices.add(inv);
            accountIds.add(opp.AccountId);

            for (OpportunityLineItem oli : opp.OpportunityLineItems) {
                InvoiceLine__c line = new InvoiceLine__c(
                    Product__c = oli.PricebookEntry.Product2Id,
                    Quantity__c = oli.Quantity,
                    UnitPrice__c = oli.UnitPrice);
                // Parent Id resolved by the UoW after the Invoice__c insert.
                uow.registerNew(line, InvoiceLine__c.Invoice__c, inv);
            }
        }
        for (Id accountId : accountIds) {
            uow.registerDirty(new Account(Id = accountId, LastInvoiceDate__c = System.today()));
        }
        uow.commitWork();                                   // one transaction boundary

        List<Id> invoiceIds = new List<Id>();
        for (Invoice__c inv : invoices) { invoiceIds.add(inv.Id); }
        return invoiceIds;
    }
}
```

```apex
// triggerHandlers/OpportunitiesTriggerHandler.cls - domain-driven trigger, see sf-fflib-operations
public with sharing class OpportunitiesTriggerHandler extends fflib_SObjectDomain {
    public OpportunitiesTriggerHandler(List<Opportunity> records) { super(records); }

    public override void onAfterUpdate(Map<Id, SObject> existingRecords) {
        Set<Id> newlyWon = new Set<Id>();
        for (Opportunity opp : (List<Opportunity>) Records) {
            Opportunity old = (Opportunity) existingRecords.get(opp.Id);
            if (opp.StageName == 'Closed Won' && old.StageName != 'Closed Won') {
                newlyWon.add(opp.Id);
            }
        }
        if (!newlyWon.isEmpty()) { InvoicingService.createInvoices(newlyWon); }
    }

    public class Constructor implements fflib_SObjectDomain.IConstructable {
        public fflib_SObjectDomain construct(List<SObject> records) {
            return new OpportunitiesTriggerHandler((List<Opportunity>) records);
        }
    }
}
```

The LWC controller is identical to 2a. Registrations needed in `Application.cls`:

```apex
IInvoicingService.class => InvoicingServiceImpl.class      // Service map
Opportunity.SObjectType => OpportunitiesSelector.class     // Selector map
// UnitOfWork list must contain, in this order:
// Account, Opportunity, OpportunityLineItem, Invoice__c, InvoiceLine__c
```

**Files: 3 service + 2 selector + 1 trigger handler + 1 controller + `Application.cls` = 8.**

### 2c. What the extra five files bought

| Concern | Plain | fflib |
| --- | --- | --- |
| DML ordering and parent Id propagation | hand-written: `insert` parents, build a `Map`, stamp `Invoice__c` on children, `insert` children | `uow.registerNew(line, InvoiceLine__c.Invoice__c, inv)` |
| Rollback on partial failure | explicit `Database.setSavepoint()` + `rollback` | `commitWork()` wraps the whole commit in a savepoint |
| Query field set reuse | the inline SOQL is private to the service | `OpportunitiesSelector` is reused by 5 other callers |
| FLS/CRUD posture change | edit every `[SELECT ...]` and every DML statement | change the selector constructor and the UoW `IDML` |
| Unit test without DML | impossible | `Application.Selector.setMock` + `Application.UnitOfWork.setMock` |
| Third entry point (batch) | copy the `Set<Id>` marshalling | `queryLocatorReadyToInvoice()` on the selector, same service call |

Unit test of 2b, no DML at all:

```apex
@IsTest
private class InvoicingServiceTest {
    @IsTest
    static void itShouldCreateInvoicesForClosedWonOpportunities() {
        Id oppId = fflib_IDGenerator.generate(Opportunity.SObjectType);
        Id accountId = fflib_IDGenerator.generate(Account.SObjectType);
        List<Opportunity> opps = new List<Opportunity> {
            new Opportunity(Id = oppId, AccountId = accountId,
                            StageName = 'Closed Won', CloseDate = System.today()) };

        fflib_ApexMocks mocks = new fflib_ApexMocks();
        fflib_ISObjectUnitOfWork uowMock =
            (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);
        IOpportunitiesSelector selectorMock =
            (IOpportunitiesSelector) mocks.mock(IOpportunitiesSelector.class);

        mocks.startStubbing();
        mocks.when(selectorMock.sObjectType()).thenReturn(Opportunity.SObjectType);
        mocks.when(selectorMock.selectByIdWithProducts(new Set<Id>{ oppId })).thenReturn(opps);
        mocks.stopStubbing();

        Application.UnitOfWork.setMock(uowMock);
        Application.Selector.setMock(Opportunity.SObjectType, selectorMock);

        System.Test.startTest();
        new InvoicingServiceImpl().createInvoices(new Set<Id>{ oppId });
        System.Test.stopTest();

        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock)).commitWork();
        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1))
            .registerDirty(fflib_Match.sObjectWithId(accountId));
    }
}
```

`fflib_Match.sObjectWithId(Id)` is verified in `fflib-apex-mocks` @ `d81e9e1`,
`sfdx-source/apex-mocks/main/classes/fflib_Match.cls`, alongside `sObjectWith`, `sObjectWithName`,
`sObjectOfType` and `anySObject`. Full matcher inventory: skill `sf-fflib-testing`.

The equivalent test for 2a needs `@TestSetup` with an Account, Product2, Pricebook2,
PricebookEntry, Opportunity and OpportunityLineItem inserted - roughly 50 extra lines and real DML.

## 3. Hybrid positions and why most of them are traps

| Hybrid | Verdict |
| --- | --- |
| Selectors only, no Domain/Service/UoW | **Viable.** Centralises SOQL and FLS posture for a small cost. The most common sensible partial adoption |
| Unit of Work only, no layers | **Viable** for a single complex multi-object transaction |
| Service + Domain but no Selector (inline SOQL in services) | Trap: services become untestable without DML, defeating the main benefit |
| Interfaces everywhere but no `Application` factory | Trap: interfaces with no injection point are ceremony; use plain classes |
| fflib for new code, plain for old, indefinitely | Trap unless there is a dated migration plan (see `SKILL.md` section 6) |
| fflib layers implemented by hand without the library | Trap: you now maintain a worse `fflib_SObjectUnitOfWork` |
| fflib plus a second DI framework | Trap: two registries, two mock mechanisms |

## 4. Signals that fflib was the wrong choice here

- Most service methods contain one query and one DML statement, and the interface exists only to satisfy the factory.
- Tests set mocks but still insert records, because the mock setup was harder than DML.
- `Application.cls` has fewer than four selector registrations after six months.
- Engineers bypass the layers (`new XSelector()`, inline SOQL in a domain) because the layers get in the way.
- Most automation lives in Flow and Apex is glue.

Removal checklist: `install-and-layout.md` section 11.

## 5. Signals fflib is paying off

- Adding a new entry point (batch, REST, Flow invocable) requires no new business logic, only marshalling.
- A field-set change in one selector fixes five callers.
- Switching the org to user-mode enforcement was a constructor change per selector plus one `IDML` swap.
- Service test suites run without `@TestSetup` DML and the full local run stays under the CI budget.

## Related

- Skill `sf-apex-development` - plain Apex service class and trigger handler conventions
- Skill `sf-fflib-domain-service-uow` - the Unit of Work behaviour used in 2b
- Skill `sf-fflib-selector-layer` - `selectByIdWithProducts` and subselects
- Skill `sf-fflib-testing` - the no-DML test style
- Skill `sf-flow-automation` - when the answer is neither Apex option
- Skill `sf-governor-limits` - why bulk-shaped service signatures matter
