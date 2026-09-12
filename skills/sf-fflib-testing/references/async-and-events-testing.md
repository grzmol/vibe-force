# Async, platform-event and callout testing in an fflib codebase

Platform grounding: Apex Developer Guide, Summer '26 / API version `67.0` (doc version 262.0).
Framework grounding: `fflib_SObjectUnitOfWork.cls` at `fflib-apex-common` `master` commit
`dab5977`.

Asynchronous code is where fflib's layering earns the most and where mocked tests help least: the
platform decides *when* code runs, and a mock cannot simulate that. The rule is: **mock the service
the job calls, run the job for real.**

## Test.startTest / Test.stopTest flush semantics

| Fact | Consequence for tests |
| --- | --- |
| Each test method may call `startTest()` and `stopTest()` **once** | You cannot flush the queue twice in one method; split into two methods |
| All asynchronous calls made after `startTest()` are collected; when `stopTest()` executes they run **synchronously** | Every assertion about async results belongs *after* `stopTest()` |
| Code after `stopTest()` gets the original limits in effect before `startTest()` | Limit assertions must be taken before `stopTest()` |
| An exception during `stopTest()` halts the synchronous processing | An unhandled exception in a batch `execute()` prevents `finish()` from running in test context |
| Async work enqueued *before* `startTest()` runs at the end of the test method | Always enqueue inside the block; otherwise ordering is unpredictable |

Source: Apex Developer Guide, "Using Limits, startTest, and stopTest".

```apex
System.Test.startTest();
System.enqueueJob(new RecalculateInvoicesQueueable(invoiceIds));
// Still queued here - verifying now proves the job has NOT run yet.
((IInvoicingService) mocks.verify(serviceMock, fflib_ApexMocks.NEVER)).recalculate(invoiceIds);
System.Test.stopTest();
// Flushed: assert results here.
((IInvoicingService) mocks.verify(serviceMock, 1)).recalculate(invoiceIds);
```

That pre-`stopTest()` `NEVER` verification is cheap and worth writing: it proves the work really is
asynchronous rather than accidentally executed inline.

## Queueable

Design so the Queueable is a thin shell around a service:

```apex
public with sharing class RecalculateInvoicesQueueable implements Queueable {
    private final Set<Id> invoiceIds;

    public RecalculateInvoicesQueueable(Set<Id> invoiceIds) {
        this.invoiceIds = invoiceIds;
    }

    public void execute(QueueableContext context) {
        InvoicingService.recalculate(invoiceIds);
    }
}
```

The Queueable itself then needs one test (recipe 9 in `test-variants-cookbook.md`); all the
business logic is covered by the service's own mocked tests.

| Limit | Value | Test impact |
| --- | --- | --- |
| `System.enqueueJob` per synchronous transaction | 50 | A bulk trigger enqueuing per-record fails at 51 records - assert `Limits.getQueueableJobs()` |
| `System.enqueueJob` from an asynchronous transaction | 1 | A Queueable that enqueues two children fails at runtime |
| Child jobs per parent | 1 | Starting multiple child jobs from one Queueable is unsupported |
| Chain depth | No enforced limit; **5** in Developer Edition and Trial orgs | Deep-chain tests fail in scratch orgs built on Developer Edition |

Chained jobs can be tested "by using appropriate stack depths" while respecting those limits. In
practice, assert that the parent enqueued a child rather than driving the whole chain:

```apex
@IsTest
static void parentEnqueuesExactlyOneChild() {
    System.Test.startTest();
    System.enqueueJob(new ParentJob());
    Assert.areEqual(1, Limits.getQueueableJobs(), 'Parent enqueued in this transaction');
    System.Test.stopTest();

    List<AsyncApexJob> jobs = [
        SELECT ApexClass.Name, Status FROM AsyncApexJob WHERE JobType = 'Queueable'];
    Assert.areEqual(2, jobs.size(), 'Parent plus exactly one child');
}
```

## Transaction finalizers

`System.Finalizer` attaches a post-action to a Queueable job. Key facts from the guide:

| Fact | Detail |
| --- | --- |
| Attachment | `System.attachFinalizer(Finalizer)` inside the Queueable's `execute()` |
| Cardinality | Only one finalizer instance per Queueable job |
| Result | `ctx.getResult()` returns `System.ParentJobResult`: `SUCCESS` or `UNHANDLED_EXCEPTION` |
| Failure detail | `ctx.getException()` returns the exception when the result is `UNHANDLED_EXCEPTION`, otherwise `null` |
| Context restriction | `attachFinalizer` outside a Queueable throws `System.attachFinalizer(Finalizer) is not allowed in this context` |
| Null argument | Throws `Argument cannot be null` |

Testing the failure branch requires the job to actually fail. Do not mock the finalizer - stub the
service it calls to throw:

```apex
@IsTest
private class RecalculateFinalizerTest {
    @IsTest
    static void finalizerLogsAnUnhandledExceptionFromTheJob() {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        IInvoicingService serviceMock = (IInvoicingService) mocks.mock(IInvoicingService.class);

        mocks.startStubbing();
        // recalculate is void, so doThrowWhen is the only option.
        mocks.doThrowWhen(new InvoicingService.ServiceException('boom'), serviceMock);
        serviceMock.recalculate(new Set<Id>());
        mocks.stopStubbing();
        Application.Service.setMock(IInvoicingService.class, serviceMock);

        System.Test.startTest();
        System.enqueueJob(new RecalculateInvoicesQueueable(new Set<Id>()));
        System.Test.stopTest();

        // The finalizer committed a log row even though the job threw.
        List<Job_Log__c> logs = [SELECT Result__c, Message__c FROM Job_Log__c];
        Assert.areEqual(1, logs.size(), 'Finalizer must log exactly once');
        Assert.areEqual('UNHANDLED_EXCEPTION', logs[0].Result__c);
        Assert.isTrue(logs[0].Message__c.contains('boom'), 'Message: ' + logs[0].Message__c);
    }
}
```

`doThrowWhen` stubs the **type**, so any argument matches; the empty `Set<Id>` in the stubbing
block only selects the overload.

## Batch Apex

`Batchable` implementers **cannot be stubbed** - the Stub API explicitly refuses classes that
implement the `Batchable` interface. Consequences:

- Never try `mocks.mock(MyBatch.class)`; it throws a `System.TypeException`.
- Mock the **service** the batch's `execute()` calls, or run the batch against real data.
- A test context runs `start`, one `execute` chunk and `finish` at `Test.stopTest()`, regardless of
  the scope size argument. Multi-chunk behaviour (stateful accumulation across chunks, chunk-level
  rollback) cannot be proven in a unit test; prove it in a sandbox run.
- An unhandled exception in `execute()` stops synchronous processing at `stopTest()`, so `finish()`
  never runs. A test asserting "finish sends an email on failure" will not behave as it does in
  production.

```apex
@IsTest
static void batchRecordsAJobSummary() {
    System.Test.startTest();
    Database.executeBatch(new CreateInvoicesJob(), 200);
    System.Test.stopTest();

    AsyncApexJob job = [
        SELECT Status, NumberOfErrors, JobItemsProcessed, TotalJobItems
        FROM AsyncApexJob WHERE JobType = 'BatchApex' ORDER BY CreatedDate DESC LIMIT 1];
    Assert.areEqual('Completed', job.Status);
    Assert.areEqual(0, job.NumberOfErrors);
    Assert.areEqual(1, job.JobItemsProcessed, 'A test context runs exactly one chunk');
}
```

### BatchApexErrorEvent

A batch class implementing `Database.RaisesPlatformEvents` publishes `BatchApexErrorEvent` on
failure. Deliver it explicitly, **after** `Test.stopTest()`:

```apex
try {
    Test.startTest();
    Database.executeBatch(new FailingJob(), 200);
    Test.stopTest();
} catch (Exception e) {
    // Expected: the unhandled failure surfaces here.
}
Test.getEventBus().deliver();   // now the BatchApexErrorEvent trigger runs
```

If a downstream platform-event trigger publishes further events, add one
`Test.getEventBus().deliver();` per hop.

## Schedulable

`System.schedule` inside `startTest()`/`stopTest()` forces the job to run before the assertions.
The job's `CronTrigger` row carries the schedule metadata.

```apex
@IsTest
private class NightlyRecalcScheduleTest {
    private static final String CRON_EXP = '0 0 0 3 9 ? 2042';

    @IsTest
    static void scheduledJobRunsAtStopTest() {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        IInvoicingService serviceMock = (IInvoicingService) mocks.mock(IInvoicingService.class);
        Application.Service.setMock(IInvoicingService.class, serviceMock);

        System.Test.startTest();
        String jobId = System.schedule('vf-test-nightly', CRON_EXP, new NightlyRecalcSchedulable());

        CronTrigger ct = [SELECT CronExpression, TimesTriggered FROM CronTrigger WHERE Id = :jobId];
        Assert.areEqual(CRON_EXP, ct.CronExpression, 'Schedule must match the requested expression');
        Assert.areEqual(0, ct.TimesTriggered, 'Not yet fired inside the test block');
        System.Test.stopTest();

        ((IInvoicingService) mocks.verify(serviceMock, 1)).recalculateAll();
    }
}
```

Use a far-future cron year so the job never fires for real in a long-lived sandbox.

## Platform events and the Unit of Work

`fflib_SObjectUnitOfWork` publishes events at three distinct points, driven by `commitWork()`:

| Registration | Published | Survives a failed commit |
| --- | --- | --- |
| `registerPublishBeforeTransaction(...)` | Before any DML, inside `doCommitWork()` | Yes - already published when the DML fails |
| `registerPublishAfterSuccessTransaction(...)` | After `commitWork()` succeeds | No |
| `registerPublishAfterFailureTransaction(...)` | After `commitWork()` throws and rolls back | Only on failure |

The full `commitWork()` order verified in source: `onCommitWorkStarting` -> publish-before events
-> insert -> upsert -> update -> delete -> `emptyRecycleBin` -> resolve email relationships ->
`doWork()` -> `onCommitWorkFinishing`; then, in a `finally` block, the after-success or
after-failure publication. A `Savepoint` wraps the whole thing and `Database.rollback` runs on any
exception.

That ordering is exactly what the three phases are for, and it is testable:

```apex
@IsTest
static void failedCommitPublishesTheFailureEventAndNotTheSuccessEvent() {
    System.Test.startTest();
    fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();
    uow.registerNew(new Invoice__c());   // missing a required field -> commit fails
    uow.registerPublishAfterSuccessTransaction(new InvoiceApproved__e(Amount__c = 1));
    uow.registerPublishAfterFailureTransaction(new InvoiceFailed__e(Reason__c = 'validation'));
    try {
        uow.commitWork();
        Assert.fail('Commit should have failed');
    } catch (DmlException e) {
        Assert.isNotNull(e, 'Required-field validation must reject the insert');
    }
    Test.getEventBus().deliver();
    System.Test.stopTest();

    Assert.areEqual(0, [SELECT COUNT() FROM Invoice_Audit__c], 'Success subscriber must not run');
    Assert.areEqual(1, [SELECT COUNT() FROM Invoice_Failure_Log__c], 'Failure subscriber must run');
}
```

### Test.getEventBus().deliver()

| Rule | Detail |
| --- | --- |
| Required | Event messages published in a test are not delivered to subscribers until `deliver()` is called |
| Per hop | If a subscriber publishes another event, call `deliver()` again for that hop |
| Placement | After the publication and after `Test.stopTest()` for batch-published events; before `stopTest()` is fine for UoW-published events as long as `commitWork()` already ran |
| Mocked UoW | A mocked `fflib_ISObjectUnitOfWork` publishes **nothing** - verify `registerPublishAfterSuccessTransaction(...)` instead, and cover real delivery in one integration test |

Mocked assertion form:

```apex
((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).registerPublishAfterSuccessTransaction(
    fflib_Match.sObjectWith(new Map<SObjectField, Object>{
        InvoiceApproved__e.Amount__c => 100 }));
```

That proves intent and phase. It does not prove the event's field set is publishable, that the
subscriber trigger exists, or that the subscriber's own DML succeeds - hence the one integration
test.

## Callouts inside services

A callout belongs behind a gateway class with an interface, so services can mock it and the gateway
gets its own `HttpCalloutMock` test.

```apex
public interface ITaxRateGateway {
    Decimal rateFor(String countryCode);
}
```

| Test | What it mocks | What it proves |
| --- | --- | --- |
| Gateway test | `Test.setMock(HttpCalloutMock.class, ...)` | Endpoint, method, headers, body parsing, error translation |
| Service test | `Application.Service.setMock(ITaxRateGateway.class, gatewayMock)` | The service calls the gateway and uses the result |

Callout rules that bite in tests:

- `Test.setMock` must be called **before** the callout executes.
- You cannot make a callout after uncommitted DML in the same transaction:
  `You have uncommitted work pending. Please commit or rollback before calling out.` In an fflib
  service that means: commit the Unit of Work, *then* call out, or call out first and register the
  results. A test with a mocked UoW will never reproduce this, because no DML happens - the
  integration test is the only place it shows up.
- All `Savepoint`s must be released before a callout:
  `All active Savepoints must be released before making callouts.` `fflib_SObjectUnitOfWork.commitWork()`
  takes a savepoint for the whole commit, so a callout inside `registerWork(IDoWork)` will fail.
  Put callouts outside `commitWork()`.

```apex
private class MultiEndpointMock implements HttpCalloutMock {
    private final Map<String, String> bodyByEndpointFragment;
    private MultiEndpointMock(Map<String, String> bodyByEndpointFragment) {
        this.bodyByEndpointFragment = bodyByEndpointFragment;
    }
    public HttpResponse respond(HttpRequest req) {
        for (String fragment : bodyByEndpointFragment.keySet()) {
            if (req.getEndpoint().contains(fragment)) {
                HttpResponse res = new HttpResponse();
                res.setStatusCode(200);
                res.setBody(bodyByEndpointFragment.get(fragment));
                return res;
            }
        }
        Assert.fail('Unexpected callout endpoint: ' + req.getEndpoint());
        return null;
    }
}
```

Salesforce also ships `StaticResourceCalloutMock` and `MultiStaticResourceCalloutMock` for
response bodies stored as static resources; both are registered the same way with
`Test.setMock(HttpCalloutMock.class, mock)`.

## Async testing checklist

- [ ] The async class is a thin shell; the logic lives in a service with its own mocked tests.
- [ ] The job is enqueued/executed strictly between `startTest()` and `stopTest()`.
- [ ] Assertions about async results are after `stopTest()`.
- [ ] Limit assertions are before `stopTest()`.
- [ ] Batch tests do not attempt to stub the `Batchable` class.
- [ ] Every platform-event test calls `Test.getEventBus().deliver()` once per delivery hop.
- [ ] Mocked-UoW tests verify `registerPublish*Transaction`; at least one integration test proves
      real delivery.
- [ ] Callout mocks are registered before the callout, and no uncommitted DML precedes it.

See `sf-async-apex-patterns` for the production-side async design, `sf-governor-limits` for the
async limit table, `sf-integration-patterns` for gateway design, and `test-variants-cookbook.md`
recipes 9-12 for complete classes.
