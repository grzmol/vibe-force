# Test-variant cookbook

One complete, compile-plausible test class per row of the decision table in `SKILL.md`. Each recipe
states what it proves and what it does not. Names follow `fflib-apex-common-samplecode`; adapt
names, not structure. Assertions use the modern `Assert` class (`areEqual`, `areNotEqual`,
`isTrue`, `isFalse`, `isNull`, `isNotNull`, `fail`), never `System.assertEquals`.

## 1. Service unit test with mocks

Proves: the service queries through the selector, delegates to the domain, registers on the Unit of
Work, and commits. Does not prove: SOQL validity, DML success, triggers, or FLS.

```apex
@IsTest
private class AccountsServiceTest {
    @IsTest
    static void updateOpportunityActivityQueriesDelegatesAndCommits() {
        List<Account> accounts = new List<Account>{
            new Account(Id = fflib_IDGenerator.generate(Account.SObjectType), Name = 'A'),
            new Account(Id = fflib_IDGenerator.generate(Account.SObjectType), Name = 'B')
        };
        Set<Id> accountIds = new Map<Id, SObject>(accounts).keySet();

        fflib_ApexMocks mocks = new fflib_ApexMocks();
        fflib_ISObjectUnitOfWork uowMock = (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);
        IAccountsSelector selectorMock = (IAccountsSelector) mocks.mock(IAccountsSelector.class);
        IAccounts domainMock = (IAccounts) mocks.mock(IAccounts.class);

        mocks.startStubbing();
        mocks.when(selectorMock.sObjectType()).thenReturn(Account.SObjectType);
        mocks.when(selectorMock.selectSObjectsById(accountIds)).thenReturn(accounts);
        mocks.when(domainMock.getType()).thenReturn(Account.SObjectType);
        mocks.when(domainMock.getRecords()).thenReturn(accounts);
        mocks.stopStubbing();

        Application.UnitOfWork.setMock(uowMock);
        Application.Selector.setMock(Account.SObjectType, selectorMock);
        Application.Domain.setMock(Account.SObjectType, domainMock);

        System.Test.startTest();
        new AccountsServiceImpl().updateOpportunityActivity(accountIds);
        System.Test.stopTest();

        ((IAccountsSelector) mocks.verify(selectorMock, 1)).selectSObjectsById(accountIds);
        ((IAccounts) mocks.verify(domainMock, 1)).updateOpportunityActivity();
        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).registerDirty(accounts);
        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).commitWork();
    }
}
```

## 2. Domain unit test, no DML, direct construction

Proves: field-level business logic on in-memory records, and the negative path. Does not prove:
trigger routing or persistence.

```apex
@IsTest
private class OpportunitiesDomainTest {
    @IsTest
    static void applyDiscountReducesAmountAndRegistersDirty() {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        fflib_ISObjectUnitOfWork uowMock = (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);

        Opportunity opp = new Opportunity(
            Id = fflib_IDGenerator.generate(Opportunity.SObjectType),
            Name = 'Test Opportunity', StageName = 'Open',
            CloseDate = System.today(), Amount = 1000);

        System.Test.startTest();
        Opportunities.newInstance(new List<Opportunity>{ opp }).applyDiscount(10, uowMock);
        System.Test.stopTest();

        Assert.areEqual(900, opp.Amount, 'A 10% discount on 1000 leaves 900');
        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).registerDirty(
            fflib_Match.sObjectWith(new Map<SObjectField, Object>{
                Opportunity.Id => opp.Id, Opportunity.Amount => 900 }));
    }
}
```

## 3. Domain trigger test via fflib_SObjectDomain.Test.Database

Proves: `onApplyDefaults` / `onValidate` routing and error registration for insert and update, with
no DML. Does not prove: the trigger is deployed, or that the record is actually rejected.

```apex
@IsTest
private class OpportunitiesTriggerHandlerTest {
    @IsTest
    static void insertWithoutAccountRegistersAFieldError() {
        fflib_SObjectDomain.Test.Database.onInsert(new List<Opportunity>{
            new Opportunity(Name = 'Test', Type = 'Existing Account') });
        fflib_SObjectDomain.triggerHandler(OpportunitiesTriggerHandler.class);

        List<fflib_SObjectDomain.Error> errors = fflib_SObjectDomain.Errors.getAll();
        Assert.areEqual(1, errors.size(), 'Exactly one validation error expected');
        Assert.areEqual('You must provide an Account for existing Customers.', errors[0].message);
        Assert.areEqual(Opportunity.AccountId, ((fflib_SObjectDomain.FieldError) errors[0]).field,
            'The error must be attached to AccountId so the UI highlights it');
    }
}
```

`fflib_SObjectDomain.Errors` is a transaction-scoped singleton: call `Errors.clearAll()` between
phases. `Test.Database` also offers `onDelete(Map<Id, SObject>)` and `onUndelete(List<SObject>)`.

## 4. Selector test against real data

Proves: the SOQL compiles, the field list contains what callers read, the filter and ordering are
right. Never mock a selector in its own test.

```apex
@IsTest
private class OpportunitiesSelectorTest {
    @TestSetup
    static void makeData() {
        Account acct = new Account(Name = 'Selector Test Account');
        insert acct;
        insert new List<Opportunity>{
            new Opportunity(Name = 'Open A', StageName = 'Prospecting', CloseDate = System.today().addDays(10),
                Amount = 100, AccountId = acct.Id),
            new Opportunity(Name = 'Open B', StageName = 'Prospecting', CloseDate = System.today().addDays(20),
                Amount = 200, AccountId = acct.Id),
            new Opportunity(Name = 'Closed', StageName = 'Closed Won', CloseDate = System.today(),
                Amount = 300, AccountId = acct.Id) };
    }

    @IsTest
    static void selectOpenByAccountReturnsOnlyOpenOrderedByCloseDate() {
        Account acct = [SELECT Id FROM Account WHERE Name = 'Selector Test Account' LIMIT 1];

        System.Test.startTest();
        List<Opportunity> results = new OpportunitiesSelector().selectOpenByAccountId(new Set<Id>{ acct.Id });
        System.Test.stopTest();

        Assert.areEqual(2, results.size(), 'Closed Won must be excluded');
        Assert.areEqual('Open A', results[0].Name, 'Results must be ordered by CloseDate ascending');
        // Reading a field absent from the SELECT throws SObjectException, so these assert the field list.
        Assert.areEqual(100, results[0].Amount, 'Amount must be in the selector field list');
        Assert.areEqual(acct.Id, results[0].AccountId, 'AccountId must be in the selector field list');
    }
}
```

## 5. Service integration test with real DML

Proves: the whole stack - service, domain, selector, Unit of Work, triggers, validation rules. Going
through the static facade also proves the `Application.Service` registration. Keep few of these.

```apex
@IsTest
private class OpportunitiesServiceIntegrationTest {
    @IsTest
    static void applyDiscountsPersistsThroughTheWholeStack() {
        Account acct = new Account(Name = 'Integration Account');
        insert acct;
        Opportunity opp = new Opportunity(Name = 'Integration Opp', StageName = 'Prospecting',
            CloseDate = System.today().addDays(30), Amount = 1000, AccountId = acct.Id);
        insert opp;

        System.Test.startTest();
        OpportunitiesService.applyDiscounts(new Map<Id, Decimal>{ opp.Id => 10 });
        System.Test.stopTest();

        Assert.areEqual(900, [SELECT Amount FROM Opportunity WHERE Id = :opp.Id].Amount,
            'Discount must be committed to the database');
    }
}
```

## 6. Trigger test with real DML

Proves: the trigger is deployed and active, save order holds, cross-object effects land, domain
validation surfaces as `DmlException`, and the handler is bulkified.

```apex
@IsTest
private class OpportunityTriggerDmlTest {
    @IsTest
    static void insertingAnOpportunityStampsTheAccountDescription() {
        Account acct = new Account(Name = 'Trigger Account', Description = null);
        insert acct;

        System.Test.startTest();
        insert new Opportunity(Name = 'Trigger Opp', Type = 'Existing Account', StageName = 'Prospecting',
            CloseDate = System.today().addDays(30), AccountId = acct.Id);
        System.Test.stopTest();

        Assert.areEqual('Last Opportunity Raised ' + System.today(),
            [SELECT Description FROM Account WHERE Id = :acct.Id].Description,
            'The after-insert domain handler must update the parent account');
    }

    @IsTest
    static void existingAccountOpportunityWithoutAnAccountIsRejected() {
        System.Test.startTest();
        try {
            insert new Opportunity(Name = 'Bad Opp', Type = 'Existing Account',
                StageName = 'Prospecting', CloseDate = System.today().addDays(30));
            Assert.fail('DmlException expected');
        } catch (DmlException e) {
            Assert.isTrue(e.getMessage().contains('You must provide an Account'),
                'Domain validation must surface as a DML error: ' + e.getMessage());
        }
        System.Test.stopTest();
    }
}
```

## 7. Controller / @AuraEnabled test

Proves: the controller delegates. For the failure-wrapping variant with `doThrowWhen`, see
`mock-injection.md`.

```apex
@IsTest
private class OpportunityDiscountControllerTest {
    @IsTest
    static void applyDiscountDelegatesToTheService() {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        IOpportunitiesService serviceMock = (IOpportunitiesService) mocks.mock(IOpportunitiesService.class);
        Application.Service.setMock(IOpportunitiesService.class, serviceMock);
        Id oppId = fflib_IDGenerator.generate(Opportunity.SObjectType);

        System.Test.startTest();
        OpportunityDiscountController.applyDiscount(oppId, 10);
        System.Test.stopTest();

        ((IOpportunitiesService) mocks.verify(serviceMock, 1))
            .applyDiscounts(new Map<Id, Decimal>{ oppId => 10 });
    }
}
```

## 8. Flow-invocable test

Proves: the bulk request/response contract and per-row mapping. Invocable methods are `static` and
cannot be stubbed - call them directly and mock what they call.

```apex
@IsTest
private class ApplyDiscountInvocableTest {
    @IsTest
    static void invocableMapsRequestRowsToOneBulkServiceCall() {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        IOpportunitiesService serviceMock = (IOpportunitiesService) mocks.mock(IOpportunitiesService.class);
        Application.Service.setMock(IOpportunitiesService.class, serviceMock);

        Id oppA = fflib_IDGenerator.generate(Opportunity.SObjectType);
        Id oppB = fflib_IDGenerator.generate(Opportunity.SObjectType);
        ApplyDiscountInvocable.Request a = new ApplyDiscountInvocable.Request();
        a.opportunityId = oppA;
        a.percentage = 10;
        ApplyDiscountInvocable.Request b = new ApplyDiscountInvocable.Request();
        b.opportunityId = oppB;
        b.percentage = 20;

        System.Test.startTest();
        List<ApplyDiscountInvocable.Result> results =
            ApplyDiscountInvocable.apply(new List<ApplyDiscountInvocable.Request>{ a, b });
        System.Test.stopTest();

        Assert.areEqual(2, results.size(), 'Flow requires one result per request row');
        Assert.isTrue(results[0].success, 'Row 0 should succeed');
        ((IOpportunitiesService) mocks.verify(serviceMock, 1))
            .applyDiscounts(new Map<Id, Decimal>{ oppA => 10, oppB => 20 });
    }
}
```

## 9. Async test: Queueable

Proves: the job enqueues, runs at `Test.stopTest()`, and delegates. Flush semantics and chaining
limits: `async-and-events-testing.md`.

```apex
@IsTest
private class RecalculateInvoicesQueueableTest {
    @IsTest
    static void queueableRunsTheServiceOnStopTest() {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        IInvoicingService serviceMock = (IInvoicingService) mocks.mock(IInvoicingService.class);
        Application.Service.setMock(IInvoicingService.class, serviceMock);
        Set<Id> invoiceIds = new Set<Id>{ fflib_IDGenerator.generate(Invoice__c.SObjectType) };

        System.Test.startTest();
        System.enqueueJob(new RecalculateInvoicesQueueable(invoiceIds));
        // Queued, not executed.
        ((IInvoicingService) mocks.verify(serviceMock, fflib_ApexMocks.NEVER)).recalculate(invoiceIds);
        System.Test.stopTest();   // flushes the queue synchronously

        ((IInvoicingService) mocks.verify(serviceMock, 1)).recalculate(invoiceIds);
    }
}
```

## 10. Async test: Batchable

`Batchable` implementers cannot be stubbed (Stub API limitation), so run one real chunk and assert
persisted state.

```apex
@IsTest
private class CreateInvoicesJobTest {
    @TestSetup
    static void makeData() {
        Account acct = new Account(Name = 'Batch Account');
        insert acct;
        insert new Opportunity(Name = 'Batch Opp', StageName = 'Closed Won',
            CloseDate = System.today(), Amount = 500, AccountId = acct.Id);
    }

    @IsTest
    static void batchCreatesOneInvoicePerClosedWonOpportunity() {
        System.Test.startTest();
        Database.executeBatch(new CreateInvoicesJob(), 200);
        System.Test.stopTest();   // start, execute and finish all run here

        List<Invoice__c> invoices = [SELECT Id, Total__c FROM Invoice__c];
        Assert.areEqual(1, invoices.size(), 'One invoice per Closed Won opportunity');
        Assert.areEqual(500, invoices[0].Total__c, 'Invoice total must match the opportunity amount');

        AsyncApexJob job = [SELECT Status, NumberOfErrors FROM AsyncApexJob
            WHERE JobType = 'BatchApex' ORDER BY CreatedDate DESC LIMIT 1];
        Assert.areEqual('Completed', job.Status);
        Assert.areEqual(0, job.NumberOfErrors);
    }
}
```

A test context supplies at most one chunk regardless of scope size, so multi-chunk state must be
proven in a sandbox.

## 11. Platform-event test

Proves: the Unit of Work publishes at the right commit phase and the subscriber trigger runs.
`Test.getEventBus().deliver()` is mandatory; without it the subscriber never executes.

```apex
@IsTest
private class InvoiceApprovedEventTest {
    @IsTest
    static void commitWorkPublishesTheEventAndTheSubscriberProcessesIt() {
        Account acct = new Account(Name = 'Event Account');
        insert acct;

        System.Test.startTest();
        fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();
        uow.registerNew(new Invoice__c(Account__c = acct.Id, Total__c = 100));
        uow.registerPublishAfterSuccessTransaction(
            new InvoiceApproved__e(Account_Id__c = acct.Id, Amount__c = 100));
        uow.commitWork();
        Test.getEventBus().deliver();
        System.Test.stopTest();

        List<Invoice_Audit__c> audits = [SELECT Id, Amount__c FROM Invoice_Audit__c];
        Assert.areEqual(1, audits.size(), 'The subscriber trigger must create one audit row');
        Assert.areEqual(100, audits[0].Amount__c);
    }
}
```

## 12. Callout test

Proves: request shape and response handling, including the error translation. The mock must be
registered before the callout happens.

```apex
@IsTest
private class TaxRateGatewayTest {
    private class TaxRateMock implements HttpCalloutMock {
        private final Integer status;
        private final String body;
        private TaxRateMock(Integer status, String body) {
            this.status = status;
            this.body = body;
        }
        public HttpResponse respond(HttpRequest req) {
            Assert.areEqual('GET', req.getMethod(), 'Rate lookup must be a GET');
            Assert.isTrue(req.getEndpoint().contains('/rates'), 'Endpoint: ' + req.getEndpoint());
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setBody(body);
            res.setStatusCode(status);
            return res;
        }
    }

    @IsTest
    static void gatewayParsesTheRateFromASuccessfulResponse() {
        Test.setMock(HttpCalloutMock.class, new TaxRateMock(200, '{"rate":0.2}'));

        System.Test.startTest();
        Decimal rate = new TaxRateGateway().rateFor('GB');
        System.Test.stopTest();

        Assert.areEqual(0.2, rate, 'Rate must be parsed from the JSON body');
    }

    @IsTest
    static void gatewayRaisesADomainExceptionOnAServiceError() {
        Test.setMock(HttpCalloutMock.class, new TaxRateMock(503, '{"error":"unavailable"}'));

        System.Test.startTest();
        try {
            new TaxRateGateway().rateFor('GB');
            Assert.fail('A 503 must be translated into a domain exception');
        } catch (TaxRateGateway.TaxRateException e) {
            Assert.isTrue(e.getMessage().contains('503'), 'Message should carry the status: ' + e.getMessage());
        }
        System.Test.stopTest();
    }
}
```

## 13. FLS / CRUD negative test

Proves: `UserModeDML` really rejects, and that `SimpleDML` really does not. Must run as a
restricted user - a System Administrator is denied nothing.

```apex
@IsTest
private class InvoiceSecurityTest {
    private static User restrictedUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        User u = new User(Alias = 'vfsec', Email = 'vf-sec@example.com', LastName = 'Restricted',
            Username = 'vf-sec-' + DateTime.now().getTime() + '@example.com', ProfileId = p.Id,
            EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US', TimeZoneSidKey = 'GMT');
        insert u;
        return u;
    }

    @IsTest
    static void userModeInsertIsRejectedWithoutObjectPermission() {
        User u = restrictedUser();

        System.Test.startTest();
        System.runAs(u) {
            fflib_ISObjectUnitOfWork uow = new fflib_SObjectUnitOfWork(
                new List<SObjectType>{ Invoice__c.SObjectType },
                new fflib_SObjectUnitOfWork.UserModeDML());
            uow.registerNew(new Invoice__c(Total__c = 10));
            try {
                uow.commitWork();
                Assert.fail('USER_MODE DML must be rejected without Create on Invoice__c');
            } catch (System.SecurityException e) {
                Assert.isTrue(e.getMessage().contains('Invoice__c'),
                    'Exception should name the object: ' + e.getMessage());
            }
        }
        System.Test.stopTest();
    }

    @IsTest
    static void systemModeInsertSucceedsForTheSameUser() {
        User u = restrictedUser();

        System.Test.startTest();
        System.runAs(u) {
            fflib_ISObjectUnitOfWork uow = new fflib_SObjectUnitOfWork(
                new List<SObjectType>{ Invoice__c.SObjectType },
                new fflib_SObjectUnitOfWork.SimpleDML());
            uow.registerNew(new Invoice__c(Total__c = 10));
            uow.commitWork();   // SimpleDML runs AccessLevel.SYSTEM_MODE
        }
        System.Test.stopTest();

        Assert.areEqual(1, [SELECT COUNT() FROM Invoice__c],
            'SYSTEM_MODE bypasses CRUD - this is why UserModeDML is the Application default');
    }
}
```

Both halves matter: the first proves enforcement, the second proves the two DML implementations
genuinely differ - the justification for `UserModeUnitOfWorkFactory`. In API version 67.0 and later
Apex runs in user context by default, so only the explicit `AccessLevel.SYSTEM_MODE` in `SimpleDML`
bypasses CRUD/FLS. See `sf-security-model`.

## 14. LWC Jest test

Apex is not involved. Mock the wire adapter, assert rendering and events; do not duplicate Apex
assertions in Jest. See `sf-lwc-jest-testing` and the `jestCoverageMin` gate (`vf-check jest`).

## Recipe selection cheat sheet

| You changed | Write or update |
| --- | --- |
| Service orchestration | 1, plus 5 if the happy path is new |
| Domain field logic | 2 |
| Domain validation | 3, plus 6 for the rejection path |
| A selector query | 4 |
| A trigger or its handler registration | 3 and 6 |
| A controller or invocable | 7 or 8 |
| A Queueable / Batch / Schedulable | 9 or 10 |
| Platform-event publication or subscription | 11 |
| An HTTP integration | 12 |
| Anything touching `USER_MODE` or permission sets | 13 |
| An LWC | 14 |
