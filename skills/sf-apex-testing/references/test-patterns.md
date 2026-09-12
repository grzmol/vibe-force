# Apex Test Patterns Reference

Copy-ready data factories, builders, asynchronous recipes, platform-event tests, and user-context
tests. All behaviour claims come from the Apex Developer Guide (Winter '27 / API 68.0); see the
source table at the end.

## Data creation strategy

| Strategy | Use when | Cost |
| --- | --- | --- |
| `@TestSetup` method | every method in the class needs the same records | one insert per test method (changes roll back after each) |
| `@IsTest` factory class | records are shared across several test classes | excluded from the 6 MB org code limit |
| Fluent builder | one field varies per test and the object has many required fields | none at run time |
| `Test.loadData` + static resource | 10+ rows of reference data, or data supplied by the business | one static resource to maintain |
| Synthetic Ids, no DML | pure logic under test (maps, comparisons, branch selection) | zero DML, fastest tests |
| `@IsTest(SeeAllData=true)` | last resort for objects that cannot be created in a test | brittle; coverage diverges between orgs |

## `TestDataFactory`

```apex
@IsTest
public class TestDataFactory {
    public static final String PLATINUM = 'Platinum';

    public static List<Account> accounts(Integer count, String tier) {
        List<Account> out = new List<Account>();
        for (Integer i = 0; i < count; i++) {
            out.add(new Account(Name = 'Acct ' + i, Tier__c = tier));
        }
        insert out;
        return out;
    }

    public static List<Case> cases(Integer perAccount, List<Account> parents) {
        List<Case> out = new List<Case>();
        for (Account a : parents) {
            for (Integer i = 0; i < perAccount; i++) {
                out.add(new Case(Subject = 'C' + i, Priority = 'Low', AccountId = a.Id));
            }
        }
        insert out;
        return out;
    }

    /** A user on the Minimum Access profile, with no permission sets. */
    public static User minimumAccessUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        User u = new User(
            Alias = 'minacc', Email = 'minaccess@vibeforce.test', EmailEncodingKey = 'UTF-8',
            LastName = 'Restricted', LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US',
            ProfileId = p.Id, TimeZoneSidKey = 'America/Los_Angeles',
            UserName = 'minaccess' + DateTime.now().getTime() + '@vibeforce.test'
        );
        insert u;
        return u;
    }

    /** Same user shape, plus the named permission sets. */
    public static User userWith(List<String> permissionSetNames) {
        User u = minimumAccessUser();
        List<PermissionSet> sets = [SELECT Id FROM PermissionSet WHERE Name IN :permissionSetNames];
        Assert.areEqual(permissionSetNames.size(), sets.size(),
            'Every requested permission set must exist: ' + permissionSetNames);
        List<PermissionSetAssignment> assignments = new List<PermissionSetAssignment>();
        for (PermissionSet ps : sets) {
            assignments.add(new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id));
        }
        insert assignments;
        return u;
    }
}
```

`UserName` must be globally unique, which is why the timestamp is appended. Inserting a `User`
together with non-setup sObjects raises the mixed-DML error — see the `System.runAs` section below.

## Fluent builder

Builders pay for themselves on objects with many required fields, where each test varies one value.

```apex
@IsTest
public class OpportunityBuilder {
    private Opportunity record = new Opportunity(
        Name = 'Test Opp',
        StageName = 'Prospecting',
        CloseDate = Date.today().addDays(30),
        Amount = 1000
    );

    public OpportunityBuilder withStage(String stage) { record.StageName = stage; return this; }
    public OpportunityBuilder withAmount(Decimal amount) { record.Amount = amount; return this; }
    public OpportunityBuilder forAccount(Id accountId) { record.AccountId = accountId; return this; }

    /** Build without DML — for pure logic tests. */
    public Opportunity build() {
        return record.clone(false, true, false, false);
    }

    /** Build and persist. */
    public Opportunity create() {
        Opportunity o = build();
        insert o;
        return o;
    }
}
```

```apex
Opportunity closing = new OpportunityBuilder()
    .forAccount(acct.Id).withStage('Negotiation').withAmount(50000).create();
```

## Synthetic Ids: DML-free logic tests

```apex
@IsTest
public class TestIds {
    private static Integer counter = 1;

    public static Id next(SObjectType type) {
        return Id.valueOf(type.getDescribe().getKeyPrefix()
            + '000000000' + String.valueOf(counter++).leftPad(3, '0'));
    }
}
```

```apex
@IsTest
static void mapsCasesToAccountOwners() {
    Id accId = TestIds.next(Account.SObjectType);
    Id caseId = TestIds.next(Case.SObjectType);
    Id ownerId = TestIds.next(User.SObjectType);

    Map<Id, Account> accounts = new Map<Id, Account>{
        accId => new Account(Id = accId, OwnerId = ownerId, Tier__c = 'Platinum')
    };
    List<Case> cases = new List<Case>{ new Case(Id = caseId, AccountId = accId, Priority = 'Low') };

    List<Case> changes = CaseEscalationService.computeChanges(cases, accounts);

    Assert.areEqual(1, changes.size(), 'One Platinum case should produce one change');
    Assert.areEqual(ownerId, changes[0].OwnerId, 'Case should be reassigned to the account owner');
    Assert.areEqual(0, Limits.getDmlStatements(), 'Pure computation must issue no DML');
}
```

This shape requires the production class to expose a pure function (`computeChanges`) separately
from the persisting method. That split is the single biggest lever on Apex test speed.

## `Test.loadData` with a static resource

1. Create a `.csv` whose first line is the field API names and whose subsequent lines are values.
2. Upload it as a static resource (Setup → Static Resources). A MIME type is assigned on upload.
3. Call `Test.loadData(<SObject>.sObjectType, '<resourceName>')`; it inserts the rows and returns
   the resulting `List<SObject>`.

```text
Name,Website,Phone,BillingCity,BillingState,BillingPostalCode,BillingCountry
sForceTest1,http://www.sforcetest1.com,(415) 901-7000,San Francisco,CA,94105,US
sForceTest2,http://www.sforcetest2.com,(415) 901-7000,San Francisco,CA,94105,US
sForceTest3,http://www.sforcetest3.com,(415) 901-7000,San Francisco,CA,94105,US
```

```apex
@IsTest
private class AccountLoadTest {
    @IsTest
    static void loadsThreeReferenceAccounts() {
        List<SObject> loaded = Test.loadData(Account.sObjectType, 'testAccounts');

        Assert.areEqual(3, loaded.size(), 'Static resource should yield three accounts');
        Assert.areEqual('sForceTest1', ((Account) loaded[0]).Name);
    }
}
```

Static resource source layout — `testAccounts.csv` plus `testAccounts.resource-meta.xml` under
`force-app/main/default/staticresources/`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Private</cacheControl>
    <contentType>text/csv</contentType>
    <description>Reference accounts for Apex tests</description>
</StaticResource>
```

## Fields Apex cannot normally write

```apex
@IsTest
static void agesCaseByThirtyDays() {
    Case c = new Case(Subject = 'Old', Priority = 'Low');
    insert c;

    Test.setCreatedDate(c.Id, DateTime.now().addDays(-30));

    Test.startTest();
    CaseAgingService.flagStale();
    Test.stopTest();

    Assert.isTrue([SELECT Is_Stale__c FROM Case WHERE Id = :c.Id].Is_Stale__c,
        'A 30-day-old case must be flagged stale');
}
```

`Test.setCreatedDate` works only in test context and only on records created in that test.

## SOSL in tests

Any SOSL query in a test returns an **empty** result set unless
`Test.setFixedSearchResults(ids)` has been called. The fixed list replaces what the query would
have returned before `WHERE` and `LIMIT` clauses are applied; those clauses are then applied to the
fixed list. Call it multiple times to stage different result sets.

```apex
@IsTest
static void searchReturnsFixedAccount() {
    Account a = TestDataFactory.accounts(1, 'Platinum')[0];
    Test.setFixedSearchResults(new List<Id>{ a.Id });

    List<List<SObject>> found = [FIND 'Acct' IN ALL FIELDS RETURNING Account(Id, Name)];

    Assert.areEqual(1, found[0].size(), 'Fixed search results should surface the staged account');
}
```

SOSL for `ContentDocument` or `ContentNote` requires `ContentVersion` Ids in the fixed list.

## Asynchronous recipes

### Queueable

```apex
@IsTest
private class InvoiceSyncQueueableTest {
    @IsTest
    static void marksInvoicesSynced() {
        List<Invoice__c> invoices = TestDataFactory.invoices(5);
        Test.setMock(HttpCalloutMock.class, new InvoiceSyncMock());

        Test.startTest();
        System.enqueueJob(new InvoiceSyncQueueable(new Map<Id, Invoice__c>(invoices).keySet()));
        Test.stopTest();

        Assert.areEqual(5, [SELECT COUNT() FROM Invoice__c WHERE Sync_Status__c = 'Synced'],
            'All five invoices should be synced by the queued job');
    }
}
```

Chaining is not executed in tests: only the first job runs at `Test.stopTest()`. Assert the chain
intent (one `AsyncApexJob` row with `JobType = 'Queueable'`), never the chained job's side effects.

### Batch Apex

```apex
@IsTest
private class AccountCleanupBatchTest {
    @IsTest
    static void batchClearsStaleFlags() {
        TestDataFactory.accounts(200, 'Standard');

        Test.startTest();
        Database.executeBatch(new AccountCleanupBatch(), 200);
        Test.stopTest();

        Assert.areEqual(0, [SELECT COUNT() FROM Account WHERE Needs_Cleanup__c = true],
            'Batch should clear every cleanup flag');
    }
}
```

Batch constraints in tests: a maximum of **5** batch jobs may be submitted in a running test, and
only the first chunk returned by `start` is processed, so size the test data to one scope. `scope`
tops out at 2,000 when `start` returns a `QueryLocator`; the optimal value is a factor of 2,000.
`Database.Stateful` preserves only **instance** member variables across chunks; static members are
reset.

### Batch error events

```apex
@IsTest
static void failedBatchPublishesErrorEvent() {
    TestDataFactory.accounts(10, 'Standard');

    try {
        Test.startTest();
        Database.executeBatch(new FailingBatch());
        Test.stopTest();
    } catch (Exception e) {
        // The job's own exception surfaces at stopTest; swallow it deliberately.
    }

    // The batch implements Database.RaisesPlatformEvents, so deliver the event bus.
    Test.getEventBus().deliver();

    Assert.areEqual(1, [SELECT COUNT() FROM Batch_Failure_Log__c],
        'The BatchApexErrorEvent trigger should have logged the failure');
}
```

Add one `Test.getEventBus().deliver();` per downstream publishing hop: if the event trigger
publishes another platform event, deliver again.

### Platform events

```apex
@IsTest
private class OrderPlacedEventTest {
    @IsTest
    static void subscriberCreatesFulfilmentRecord() {
        Test.startTest();
        EventBus.publish(new Order_Placed__e(Order_Number__c = 'ORD-1', Amount__c = 250));
        Test.stopTest();

        Test.getEventBus().deliver();

        Assert.areEqual(1, [SELECT COUNT() FROM Fulfilment__c WHERE Order_Number__c = 'ORD-1'],
            'The platform-event trigger should create one fulfilment record');
    }
}
```

`EventBus.publish` for events configured to publish **after commit** counts against the DML
statement limit; events configured to publish **immediately** count against the separate
150-per-transaction `EventBus.publish` limit measured by `Limits.getPublishImmediateDML()`.

### Future methods

```apex
@IsTest
static void futureCalloutStampsExternalId() {
    Account a = TestDataFactory.accounts(1, 'Standard')[0];
    Test.setMock(HttpCalloutMock.class, new CrmSyncMock());

    Test.startTest();
    CrmSync.pushAsync(a.Id);     // @Future(callout=true)
    Test.stopTest();

    Assert.isNotNull([SELECT External_Id__c FROM Account WHERE Id = :a.Id].External_Id__c,
        'The future method should have written the external id');
}
```

### Schedulable

```apex
@IsTest
static void scheduledJobRuns() {
    Test.startTest();
    String jobId = System.schedule('NightlySyncTest', '0 0 1 * * ?', new NightlySyncSchedule());
    Test.stopTest();

    CronTrigger ct = [SELECT CronExpression, TimesTriggered FROM CronTrigger WHERE Id = :jobId];
    Assert.areEqual('0 0 1 * * ?', ct.CronExpression, 'Cron expression should round-trip');
    Assert.areEqual(0, ct.TimesTriggered, 'A scheduled job has not yet fired at schedule time');
}
```

Scheduled Apex is asynchronous but **synchronous governor limits apply** to it. The job body itself
executes at `Test.stopTest()`.

### Flex queue ordering

```apex
@IsTest
static void holdingJobsAreOrdered() {
    Test.startTest();
    List<String> jobIds = Test.enqueueBatchJobs(3);   // three no-operation jobs
    List<String> order = Test.getFlexQueueOrder();
    Test.stopTest();

    Assert.areEqual(3, jobIds.size(), 'Three placeholder jobs should be enqueued');
    Assert.areEqual(jobIds[0], order[0], 'First enqueued job should be first in the flex queue');
}
```

Flex-queue facts: up to 100 batch jobs may sit in `Holding`, at most 5 may be queued or active
concurrently, and only 1 batch `start` method executes concurrently.

## `System.runAs` recipes

### Mixed DML

Setup objects (`User`, `PermissionSet`, `Group`, role, and similar) cannot be written in the same
transaction as ordinary objects. Enclose one side in `System.runAs`.

```apex
@IsTest
static void createsUserAndAccountWithoutMixedDmlError() {
    User thisUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];

    User newUser;
    System.runAs(thisUser) {
        newUser = TestDataFactory.minimumAccessUser();   // setup-object DML
    }

    insert new Account(Name = 'Non-setup object');       // ordinary DML

    Assert.isNotNull(newUser.Id, 'User should be created inside the runAs block');
}
```

### Positive and negative permission pair

The pair is the proof that a `WITH USER_MODE` query or an `as user` DML is correctly scoped.

```apex
@IsTest
private class CaseSelectorPermissionTest {
    @IsTest
    static void userWithPermissionSetSeesCases() {
        Account a = TestDataFactory.accounts(1, 'Platinum')[0];
        insert new Case(Subject = 'Visible', AccountId = a.Id);
        User agent = TestDataFactory.userWith(new List<String>{ 'Case_Agent' });

        System.runAs(agent) {
            Test.startTest();
            List<Case> found = new CaseSelector().selectAll();
            Test.stopTest();
            Assert.areEqual(1, found.size(), 'A Case Agent must see the case');
        }
    }

    @IsTest
    static void userWithoutPermissionSetSeesNothing() {
        Account a = TestDataFactory.accounts(1, 'Platinum')[0];
        insert new Case(Subject = 'Hidden', AccountId = a.Id);
        User outsider = TestDataFactory.minimumAccessUser();

        System.runAs(outsider) {
            Test.startTest();
            try {
                List<Case> found = new CaseSelector().selectAll();
                Assert.areEqual(0, found.size(), 'A user without Case read must see nothing');
            } catch (QueryException e) {
                Assert.isNotNull(e.getInaccessibleFields(),
                    'A user-mode query should report the inaccessible fields');
            }
            Test.stopTest();
        }
    }
}
```

`runAs` rules: test-only; user sharing rules and object/field permissions are enforced inside the
block regardless of the test class's sharing mode; a method defined in another class uses *that*
class's sharing mode; nesting is allowed; user-license limits are ignored; **every call counts
against the DML statement limit**. There is also a `runAs(System.Version)` overload that pins
managed-package version behaviour.

## Parallel execution and isolation

| Cause of contention | Symptom | Remedy |
| --- | --- | --- |
| Tests updating the same org records concurrently | `UNABLE_TO_LOCK_ROW` | create data per test; never `SeeAllData=true` |
| Two tests inserting records with the same unique index value | deadlock, rollback | randomise unique values (timestamp suffix) |
| Reliance on org data or metadata | passes in sandbox, fails in production | build data and assign permission sets in the test |
| Static state shared between methods | order-dependent failures | statics are not preserved across methods — build state per method |

`@IsTest(IsParallel=true)` lets a class run beyond the default concurrency limit and overrides the
default setting; it is incompatible with `SeeAllData=true`. Parallel testing can also be disabled
org-wide in Setup → Apex Test Execution → Options → **Disable Parallel Apex Testing**. Tests do
**not** run in parallel during metadata deployments, package installations, or change-set
deployments.

## Constraints on every test

| Constraint | Detail |
| --- | --- |
| No committed data | test data is rolled back; there is nothing to delete |
| No emails | email cannot be sent from a test method |
| No real callouts | use mocks |
| Test methods must live in `@IsTest` classes | enforced since API 28.0 |
| Statics not preserved across methods | including statics defined in other classes |
| `MAX_DML_ROWS` in a synchronous test execution context | 450,000 rows inserted/updated/deleted; exceeding it yields `Your runallTests is consuming too many DB resources` |
| Unique-constraint objects | inserting duplicates errors, e.g. two `CollaborationGroup` records with the same name |
| Feed tracked changes and field history | cannot be created in tests — they require committed parent records |
| Limits apply per `testMethod` | each method gets its own budget |

## Sources

| Topic | URL |
| --- | --- |
| Testing Apex | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing.htm |
| Unit test considerations | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_unit_tests.htm |
| Common test utility classes | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_utility_classes.htm |
| `Test.loadData` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_load_data.htm |
| `System.runAs` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_tools_runas.htm |
| Mixed DML in `System.runAs` blocks | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dml_non_mix_sobjects_test_methods.htm |
| `Test.startTest` / `Test.stopTest` and `Limits` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_tools_start_stop_test.htm |
| SOSL in unit tests | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_SOSL.htm |
| Testing best practices and parallel execution | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_best_practices.htm |
| Batch Apex limitations | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_batch_interface.htm |
| Testing `BatchApexErrorEvent` messages | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_batch_platformevents.htm |
| Queueable Apex limits | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_queueable.htm |
| Execution governors and limits | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm |
