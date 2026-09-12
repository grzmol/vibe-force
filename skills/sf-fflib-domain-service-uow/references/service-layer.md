# fflib Service Layer Reference

Grounded in `apex-enterprise-patterns/fflib-apex-common` `master` @ `dab5977`
(`sfdx-source/apex-common/main/classes/fflib_Application.cls`) and
`apex-enterprise-patterns/fflib-apex-common-samplecode` `master` @ `4657d63`
(`Application.cls`, `service/OpportunitiesService.cls`, `service/IOpportunitiesService.cls`,
`service/OpportunitiesServiceImpl.cls`, `test/classes/service/OpportunitiesServiceTest.cls`).

## 1. The three-file service

fflib services are three files, not one:

| File | Role |
| --- | --- |
| `IProjectsService.cls` | The contract. Only this is referenced by other layers and by mocks |
| `ProjectsServiceImpl.cls` | The implementation. Registered in `Application.Service`, never referenced by name from outside |
| `ProjectsService.cls` | Static shim that resolves the implementation through the factory |

`fflib_Application.ServiceFactory.newInstance(Type serviceInterfaceType)` returns the mock registered
by `setMock(Type, Object)` if present, otherwise `serviceImpl.newInstance()` for the type mapped in
the constructor `Map<Type, Type>`. An unmapped interface throws
`fflib_Application.DeveloperException('No implementation registered for service interface ...')`.

```apex
// Application.cls (skill sf-fflib-foundations owns the full factory wiring)
public static final fflib_Application.ServiceFactory Service =
    new fflib_Application.ServiceFactory(
        new Map<Type, Type>{
            IProjectsService.class      => ProjectsServiceImpl.class,
            IOpportunitiesService.class => OpportunitiesServiceImpl.class
        });
```

```apex
public interface IProjectsService
{
    Set<Id> createFromOpportunities(Set<Id> opportunityIds);
    void advanceStage(Set<Id> projectIds, String newStage);
    Id submitBacklogJob();
}
```

```apex
public with sharing class ProjectsService
{
    public static Set<Id> createFromOpportunities(Set<Id> opportunityIds)
    {
        return service().createFromOpportunities(opportunityIds);
    }

    public static void advanceStage(Set<Id> projectIds, String newStage)
    {
        service().advanceStage(projectIds, newStage);
    }

    public static Id submitBacklogJob()
    {
        return service().submitBacklogJob();
    }

    private static IProjectsService service()
    {
        return (IProjectsService) Application.Service.newInstance(IProjectsService.class);
    }
}
```

### Static shim versus direct factory call

| Style | Pros | Cons |
| --- | --- | --- |
| `ProjectsService.createFromOpportunities(ids)` (shim) | Terse call sites, one place to add cross-cutting concerns, mock still honoured because the shim goes through the factory | One extra class per service |
| `((IProjectsService) Application.Service.newInstance(IProjectsService.class)).createFromOpportunities(ids)` | No extra class | Noisy, and every caller repeats the cast |

Pick one convention per org. The samplecode uses the shim; fflib.dev documents the direct factory
call. Mixing both makes call-site greps unreliable.

**Never make the shim do work.** If the shim contains an `if`, a query or a loop, that logic is
invisible to mocks and untestable in isolation.

## 2. Transaction ownership

Rules, in priority order:

1. A public service method owns exactly one transaction: it creates the Unit of Work, passes it
   down, and calls `commitWork()` once.
2. A service method that must be composable also exposes an overload taking an
   `fflib_ISObjectUnitOfWork` so a caller can fold its work into an outer transaction.
3. Domain classes and selectors never create or commit a Unit of Work.
4. Entry points (controller, invocable, Queueable, Batch `execute`) never create a Unit of Work
   either; they call a service.

```apex
public with sharing class ProjectsServiceImpl implements IProjectsService
{
    // Public entry: owns the transaction
    public void advanceStage(Set<Id> projectIds, String newStage)
    {
        fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();
        advanceStage(uow, ProjectsSelector.newInstance().selectById(projectIds), newStage);
        uow.commitWork();
    }

    // Composable overload: joins the caller's transaction
    public void advanceStage(fflib_ISObjectUnitOfWork uow, List<Project__c> projects, String newStage)
    {
        Projects.newInstance(projects).advanceStage(newStage, uow);
    }
}
```

The composable overload is what lets `createFromOpportunities` and `advanceStage` run in one
transaction when a third service needs both, without either method committing twice.

## 3. Method granularity and signatures

| Rule | Bad | Good |
| --- | --- | --- |
| Bulk-first | `void createProject(Id oppId)` | `Set<Id> createFromOpportunities(Set<Id> oppIds)` |
| Use-case-shaped, not CRUD-shaped | `void updateProject(Project__c p)` | `void advanceStage(Set<Id> ids, String newStage)` |
| Return identifiers or DTOs, not queried SObjects | `List<Project__c> createProjects(...)` | `Set<Id> createFromOpportunities(...)` |
| No trigger context leakage | `void handleAfterUpdate(List<Opportunity> news, Map<Id,Opportunity> olds)` | `void onOpportunitiesClosedWon(Set<Id> oppIds)` |
| No UI concerns | `String createProjectAndReturnToastMessage(...)` | Service returns data, the controller builds the message |

Returning `Set<Id>` rather than committed SObjects is deliberate: after `commitWork()` the in-memory
records carry Ids but not formula fields, roll-ups or trigger-populated values. A caller that needs
the full record re-queries through a selector.

### DTOs versus SObjects across the boundary

| Caller | Return |
| --- | --- |
| Apex service-to-service | SObjects or domain interfaces are fine |
| `@AuraEnabled` controller for LWC | An explicit DTO class, or SObjects only when the LWC genuinely renders record fields |
| `@InvocableMethod` for Flow | A flat `@InvocableVariable` output class |
| REST / integration | An explicit DTO, versioned independently of the schema |

A DTO decouples the external contract from field renames. The samplecode's `InvoicingService.Invoice`
and `InvoicingService.InvoiceLine` inner classes are exactly this: a shape the service accepts that
is not a table.

```apex
public with sharing class ProjectsService
{
    public class ProjectSummary
    {
        @AuraEnabled public Id projectId;
        @AuraEnabled public String name;
        @AuraEnabled public String stage;
        @AuraEnabled public Integer openTasks;
    }
}
```

## 4. Exception policy

| Situation | Throw |
| --- | --- |
| Caller passed something impossible (null set, unknown stage) | `ProjectsService.ServiceException` |
| Business rule violated mid-transaction | `ProjectsService.ServiceException`, message user-readable |
| Programmer/wiring error (no implementation registered, selector missing) | `fflib_Application.DeveloperException` - already thrown by the factories |
| DML failure inside `commitWork()` | Let `DmlException` propagate; `commitWork()` has already rolled back |

```apex
public with sharing class ProjectsService
{
    public class ServiceException extends Exception {}
}
```

Wrapping pattern - preserve the cause, add context, never swallow:

```apex
public Set<Id> createFromOpportunities(Set<Id> opportunityIds)
{
    if (opportunityIds == null || opportunityIds.isEmpty())
    {
        throw new ProjectsService.ServiceException('At least one Opportunity Id is required.');
    }

    try
    {
        return doCreate(opportunityIds);
    }
    catch (ProjectsService.ServiceException e)
    {
        throw e;                                  // already contextual
    }
    catch (Exception e)
    {
        ProjectsService.ServiceException wrapped = new ProjectsService.ServiceException(
            'Project creation failed for ' + opportunityIds.size() + ' Opportunities: ' + e.getMessage());
        wrapped.initCause(e);
        throw wrapped;
    }
}
```

`initCause` keeps the original stack trace available to the logger; see skill `sf-debugging-logs`.

### Rollback: `commitWork()` versus an explicit savepoint

`fflib_SObjectUnitOfWork.commitWork()` already does:

```apex
Savepoint sp = Database.setSavepoint();
Boolean wasSuccessful = false;
try { doCommitWork(); wasSuccessful = true; }
catch (Exception e) { Database.rollback(sp); throw e; }
finally { doAfterCommitWorkSteps(wasSuccessful); }
```

| Need | Do |
| --- | --- |
| All-or-nothing across one `commitWork()` | Nothing - it is already atomic |
| All-or-nothing across two `commitWork()` calls or across a `commitWork()` plus non-UoW DML | One explicit `Database.setSavepoint()` in the service, rollback in the catch |
| Partial success per row (Bulk-style) | Custom `IDML` that calls `Database.insert(records, false)` and collects `Database.SaveResult` failures - see [unit-of-work.md](unit-of-work.md) section 6 |
| Keep audit rows even when the business work fails | Register the audit rows with a **second** UoW committed after the catch, or publish a platform event through `registerPublishAfterFailureTransaction` |

Both `Database.setSavepoint()` and `Database.rollback()` consume a DML statement out of the
per-transaction 150
([Apex transaction control](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_transaction_control.htm)),
so an outer savepoint around a `commitWork()` costs three DML statements before any real work.

## 5. Entry points

### 5.1 LWC controller

```apex
public with sharing class ProjectCreationController
{
    @AuraEnabled
    public static List<Id> createProjects(List<Id> opportunityIds)
    {
        try
        {
            return new List<Id>(ProjectsService.createFromOpportunities(new Set<Id>(opportunityIds)));
        }
        catch (Exception e)
        {
            AuraHandledException handled = new AuraHandledException(e.getMessage());
            handled.setMessage(e.getMessage());     // getMessage() is otherwise "Script-thrown exception"
            throw handled;
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<ProjectsService.ProjectSummary> getSummaries(Id accountId)
    {
        return ProjectsService.summariesForAccount(accountId);
    }
}
```

Rules: `cacheable=true` only for read methods; no DML in a cacheable method; the controller holds
zero business logic. Wire-adapter and error-surface details: skill `sf-lwc-development`; the Jest
side: skill `sf-lwc-jest-testing`.

### 5.2 Flow invocable action

```apex
public with sharing class CreateProjectsAction
{
    public class Request
    {
        @InvocableVariable(label='Opportunity Id' required=true) public Id opportunityId;
    }

    public class Result
    {
        @InvocableVariable(label='Project Id') public Id projectId;
    }

    @InvocableMethod(label='Create Project From Opportunity' category='Projects')
    public static List<Result> run(List<Request> requests)
    {
        Set<Id> opportunityIds = new Set<Id>();
        for (Request request : requests) { opportunityIds.add(request.opportunityId); }

        // One service call for the whole Flow batch, not one per request
        Map<Id, Id> projectIdByOpportunityId =
            ProjectsService.createFromOpportunitiesIndexed(opportunityIds);

        List<Result> results = new List<Result>();
        for (Request request : requests)
        {
            Result result = new Result();
            result.projectId = projectIdByOpportunityId.get(request.opportunityId);
            results.add(result);
        }
        return results;
    }
}
```

The output list must be the same size and order as the input list. Flow bulkification semantics:
skill `sf-flow-automation`.

### 5.3 Async entry points

```apex
public with sharing class ProjectBacklogJob implements Database.Batchable<SObject>, Database.Stateful
{
    public Database.QueryLocator start(Database.BatchableContext context)
    {
        return OpportunitiesSelector.newInstance().queryLocatorReadyForProject();
    }

    public void execute(Database.BatchableContext context, List<Opportunity> scope)
    {
        // Each chunk is its own transaction with its own UoW inside the service
        ProjectsService.createFromOpportunities(new Map<Id, SObject>(scope).keySet());
    }

    public void finish(Database.BatchableContext context) { }
}
```

`submitBacklogJob()` lives on the service, not on the caller, so scope size and job class stay
encapsulated - the samplecode does the same with
`OpportunitiesServiceImpl.submitInvoicingJob() { return Database.executeBatch(new CreateInvoicesJob()); }`.
Chunking, finalizers and idempotency: skill `sf-fflib-operations`, reference `async-and-bulk.md`, and
skill `sf-async-apex-patterns`.

### 5.4 Domain calling a service

An after-trigger that needs cross-object work calls the service, which opens its own Unit of Work:

```apex
public override void onAfterUpdate(Map<Id, SObject> existingRecords)
{
    Set<Id> closedWon = new Set<Id>();
    for (Opportunity opp : (List<Opportunity>) Records)
    {
        Opportunity existing = (Opportunity) existingRecords.get(opp.Id);
        if (opp.StageName == 'Closed Won' && existing.StageName != 'Closed Won')
        {
            closedWon.add(opp.Id);
        }
    }
    if (closedWon.isEmpty()) { return; }
    ProjectsService.createFromOpportunities(closedWon);
}
```

This is the one place where a nested `commitWork()` is normal: the trigger's own DML is already in
flight, and the service's UoW commits additional records inside the same platform transaction. The
savepoint taken by `commitWork()` still rolls back only the UoW's own work.

## 6. Unit testing a service

Mocks come from `fflib-apex-mocks`; the mechanics belong to skill `sf-fflib-testing`. The shape a
service must support is what matters here: because the service resolves the selector, the domain and
the Unit of Work through the factories, all three can be replaced.

```apex
@IsTest
private class ProjectsServiceTest
{
    @IsTest
    private static void createFromOpportunitiesRegistersProjectAndCommits()
    {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        fflib_ISObjectUnitOfWork uowMock =
            (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);
        IOpportunitiesSelector selectorMock =
            (IOpportunitiesSelector) mocks.mock(IOpportunitiesSelector.class);

        Id oppId = fflib_IDGenerator.generate(Opportunity.SObjectType);
        List<Opportunity> opps = new List<Opportunity>{
            new Opportunity(Id = oppId, Name = 'Test', StageName = 'Closed Won',
                            CloseDate = System.today(), AccountId = null)
        };

        mocks.startStubbing();
        mocks.when(selectorMock.sObjectType()).thenReturn(Opportunity.SObjectType);
        mocks.when(selectorMock.selectByIdWithLineItems(new Set<Id>{ oppId })).thenReturn(opps);
        mocks.stopStubbing();

        Application.UnitOfWork.setMock(uowMock);
        Application.Selector.setMock(selectorMock);

        Test.startTest();
        ProjectsService.createFromOpportunities(new Set<Id>{ oppId });
        Test.stopTest();

        ((IOpportunitiesSelector) mocks.verify(selectorMock))
            .selectByIdWithLineItems(new Set<Id>{ oppId });
        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).commitWork();
    }
}
```

`Application.UnitOfWork.setMock`, `Application.Selector.setMock` and `Application.Domain.setMock` are
`@TestVisible protected virtual` on the factory classes in `fflib_Application.cls`; the samplecode
`OpportunitiesServiceTest` calls them exactly this way.

Design consequences to keep in mind while writing the service:

| If the service does this | The test cannot |
| --- | --- |
| `new ProjectsSelector().selectById(...)` | Inject a selector mock - go through `Application.Selector` or the selector's `newInstance()` |
| `new fflib_SObjectUnitOfWork(types)` | Inject a UoW mock - go through `Application.UnitOfWork` |
| `Database.query(...)` inline | Isolate from data - move it to a selector |
| `System.now()` / `UserInfo.getUserId()` inline in a branch | Control time/user - inject via a parameter or a seam class |

## 7. Service-layer review checklist

| # | Check |
| --- | --- |
| 1 | Interface, Impl and shim all present; nothing outside the service package names `...ServiceImpl` |
| 2 | Impl registered in `Application.Service` |
| 3 | Every public method takes a collection, not a single Id, unless the operation is inherently singular |
| 4 | Exactly one `commitWork()` per public method, with a composable `uow`-taking overload where reuse is plausible |
| 5 | No SOQL literal in the service - selectors only |
| 6 | No `Trigger.new`, `Trigger.oldMap` or trigger booleans anywhere in the service |
| 7 | Exceptions are a service-owned type, wrapped with `initCause`, messages are user-safe |
| 8 | `@AuraEnabled` / `@InvocableMethod` entry points contain only marshalling |
| 9 | Async submission (`Database.executeBatch`, `System.enqueueJob`) happens in the service, not in the caller |
| 10 | `with sharing` / `inherited sharing` chosen deliberately (skill `sf-security-model`) |
| 11 | Test injects selector, domain and UoW mocks and verifies `commitWork()` call count |
| 12 | `vf-check apex --target-org <alias>` passes the 75 percent per-class gate for the Impl |
