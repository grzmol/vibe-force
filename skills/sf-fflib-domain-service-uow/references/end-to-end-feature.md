# End-to-End fflib Feature

One requirement implemented across every layer. Patterns follow `fflib-apex-common` `master` @
`dab5977` and `fflib-apex-common-samplecode` `master` @ `4657d63`.

## The requirement

> When an Opportunity moves to `Closed Won`, create a `Project__c` linked to the Opportunity and its
> Account, one `ProjectTask__c` per Opportunity line item, and publish a `ProjectEvent__e` so the
> delivery system can pick the project up. Users must also be able to trigger the same creation
> manually from the Opportunity record page, and admins from a Flow. Nothing may be created twice for
> the same Opportunity.

| # | Acceptance criterion | Proved by |
| --- | --- | --- |
| A1 | Stage transition to `Closed Won` creates exactly one Project per Opportunity | `ProjectCreationIntegrationTest.bulkCloseWonCreatesOneProjectEach` (section 7) |
| A2 | A second transition or a manual click creates nothing further | Service filter in `createFromOpportunitiesIndexed` plus the `Unique` attribute on `Project__c.Opportunity__c` |
| A3 | Tasks ordered by line-item sequence | Selector `setOrdering` plus `Sequence__c` assignment |
| A4 | The platform event fires only if the transaction commits | `registerPublishAfterSuccessTransaction` |
| A5 | 200 Opportunities in one DML stay within governor limits | 200-record integration test; DML probe in [unit-of-work.md](unit-of-work.md) section 8 |
| A6 | A user without create access on `Project__c` gets a permission error, not a partial write | `UserModeDML` in the `Application` factory |

## File inventory

| Path under `force-app/main/default` | Layer | Owner agent |
| --- | --- | --- |
| `objects/Project__c`, `objects/ProjectTask__c`, `objects/ProjectEvent__e` | Schema | `sf-metadata-engineer` |
| `classes/Application.cls` | Factories | `sf-apex-engineer` |
| `classes/selectors/{I,}OpportunitiesSelector.cls`, `{I,}ProjectsSelector.cls` | Selector | `sf-apex-engineer` |
| `classes/domains/{I,}Opportunities.cls`, `{I,}Projects.cls` | Domain | `sf-apex-engineer` |
| `classes/service/IProjectsService.cls`, `ProjectsService.cls`, `ProjectsServiceImpl.cls` | Service | `sf-apex-engineer` |
| `classes/controllers/ProjectCreationController.cls`, `classes/actions/CreateProjectsAction.cls` | Entry points | `sf-apex-engineer` |
| `triggers/Opportunities.trigger` | Dispatch | `sf-apex-engineer` |
| `lwc/projectCreator/*` | UI | `sf-lwc-engineer` |
| `classes/tests/*` | Tests | `sf-test-engineer` |

Schema referenced below:

| Object | Fields |
| --- | --- |
| `Project__c` | `Name`, `Account__c` (Lookup Account), `Opportunity__c` (Lookup Opportunity, **Unique**), `Stage__c` (Picklist) |
| `ProjectTask__c` | `Name`, `Project__c` (Master-Detail), `Sequence__c` (Number), `Description__c` (Text) |
| `ProjectEvent__e` | `Opportunity__c`, `Action__c`, `CorrelationId__c` (all Text) |

A2 is enforced twice on purpose: the `Unique` attribute makes the database the final arbiter, and the
service filters already-projected Opportunities so users see a clean no-op instead of `DUPLICATE_VALUE`.

## 1. Application factories

```apex
public class Application
{
    public static final fflib_Application.UnitOfWorkFactory UnitOfWork =
        new UserModeUnitOfWorkFactory(
            new List<SObjectType>{
                Account.SObjectType,
                Opportunity.SObjectType,
                Project__c.SObjectType,      // parent before child
                ProjectTask__c.SObjectType,
                ProjectEvent__e.SObjectType  // required, or registerPublish* throws
            });

    public static final fflib_Application.ServiceFactory Service =
        new fflib_Application.ServiceFactory(
            new Map<Type, Type>{ IProjectsService.class => ProjectsServiceImpl.class });

    public static final fflib_Application.SelectorFactory Selector =
        new fflib_Application.SelectorFactory(
            new Map<SObjectType, Type>{
                Opportunity.SObjectType => OpportunitiesSelector.class,
                Project__c.SObjectType  => ProjectsSelector.class });

    public static final fflib_Application.DomainFactory Domain =
        new fflib_Application.DomainFactory(
            Application.Selector,
            new Map<SObjectType, Type>{
                Opportunity.SObjectType => Opportunities.Constructor.class,
                Project__c.SObjectType  => Projects.Constructor.class });

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

Factory anatomy and registration rules: skill `sf-fflib-foundations`.

## 2. Selectors

Selector conventions (`getSObjectFieldList`, `newQueryFactory`, FLS, sub-selects) belong to skill
`sf-fflib-selector-layer`; only the feature-specific methods are shown.

```apex
public interface IOpportunitiesSelector extends fflib_ISObjectSelector
{
    List<Opportunity> selectByIdWithLineItems(Set<Id> idSet);
    Database.QueryLocator queryLocatorClosedWonWithoutProject();
}

public interface IProjectsSelector extends fflib_ISObjectSelector
{
    List<Project__c> selectByOpportunityId(Set<Id> opportunityIds);
}
```

```apex
// OpportunitiesSelector.cls - boilerplate (newInstance, getSObjectType, getSObjectFieldList) omitted
public List<Opportunity> selectByIdWithLineItems(Set<Id> idSet)
{
    if (idSet == null || idSet.isEmpty()) { return new List<Opportunity>(); }

    fflib_QueryFactory oppFactory = newQueryFactory();
    fflib_QueryFactory lineFactory =
        new OpportunityLineItemsSelector().addQueryFactorySubselect(oppFactory);
    lineFactory.setOrdering('Sequence__c', fflib_QueryFactory.SortOrder.ASCENDING);   // A3

    return (List<Opportunity>) Database.query(
        oppFactory.setCondition('Id IN :idSet').toSOQL(), AccessLevel.USER_MODE);
}

// ProjectsSelector.cls
public List<Project__c> selectByOpportunityId(Set<Id> opportunityIds)
{
    if (opportunityIds == null || opportunityIds.isEmpty()) { return new List<Project__c>(); }
    return (List<Project__c>) Database.query(
        newQueryFactory().setCondition('Opportunity__c IN :opportunityIds').toSOQL(),
        AccessLevel.USER_MODE);
}
```

`AccessLevel.USER_MODE` is explicit even though Apex at API version 67.0 and later runs in user
context by default; never use `WITH SECURITY_ENFORCED`, which 67.0 rejects in Apex SOQL. The
`queryLocatorClosedWonWithoutProject` body and its semi-join cost are covered in skill
`sf-fflib-operations` and skill `sf-soql-sosl-optimization`.

## 3. Trigger and Opportunity domain

```apex
trigger Opportunities on Opportunity (
    before insert, before update, before delete,
    after insert, after update, after delete, after undelete)
{
    fflib_SObjectDomain.triggerHandler(Opportunities.class);
}
```

```apex
public interface IOpportunities extends fflib_ISObjectDomain
{
    Set<Id> getIdsNewlyClosedWon(Map<Id, SObject> existingRecords);
}
```

```apex
public inherited sharing class Opportunities extends fflib_SObjectDomain implements IOpportunities
{
    public static IOpportunities newInstance(List<Opportunity> records)
    {
        return (IOpportunities) Application.Domain.newInstance(records);
    }

    public Opportunities(List<Opportunity> records)
    {
        super(records);
        // User-mode DML in the Unit of Work enforces access; the base-class CRUD check would
        // additionally block the platform-event subscriber context.
        Configuration.disableTriggerCRUDSecurity();
    }

    public override void onAfterUpdate(Map<Id, SObject> existingRecords)
    {
        Set<Id> newlyClosedWon = getIdsNewlyClosedWon(existingRecords);
        if (newlyClosedWon.isEmpty()) { return; }
        ProjectsService.createFromOpportunities(newlyClosedWon);
    }

    public Set<Id> getIdsNewlyClosedWon(Map<Id, SObject> existingRecords)
    {
        Set<Id> result = new Set<Id>();
        for (Opportunity opp : (List<Opportunity>) Records)
        {
            Opportunity existing = (Opportunity) existingRecords.get(opp.Id);
            if (opp.StageName == 'Closed Won' && existing.StageName != 'Closed Won')
            {
                result.add(opp.Id);
            }
        }
        return result;
    }

    public class Constructor implements fflib_SObjectDomain.IConstructable
    {
        public fflib_SObjectDomain construct(List<SObject> sObjectList)
        {
            return new Opportunities((List<Opportunity>) sObjectList);
        }
    }
}
```

## 4. Project domain

`Projects` follows the same skeleton (static `newInstance`, constructor calling `super`, inner
`Constructor`) and its interface `IProjects extends fflib_ISObjectDomain` declares
`void advanceStage(String newStage, fflib_ISObjectUnitOfWork uow)`. The distinctive parts:

```apex
public override void onApplyDefaults()
{
    for (Project__c project : (List<Project__c>) Records)
    {
        if (String.isBlank(project.Stage__c)) { project.Stage__c = 'Planning'; }
    }
}

// Takes the caller's Unit of Work: the domain never commits
public void advanceStage(String newStage, fflib_ISObjectUnitOfWork uow)
{
    for (Project__c project : (List<Project__c>) Records)
    {
        if (project.Stage__c == newStage) { continue; }
        project.Stage__c = newStage;
        uow.registerDirty(project, new List<SObjectField>{ Project__c.Stage__c });
    }
}
```

The field-scoped `registerDirty` overload means a concurrent domain that dirties a different field on
the same Project does not clobber this stage change. See [unit-of-work.md](unit-of-work.md) section 3.

## 5. Service

```apex
public interface IProjectsService
{
    Set<Id> createFromOpportunities(Set<Id> opportunityIds);
    Map<Id, Id> createFromOpportunitiesIndexed(Set<Id> opportunityIds);
    void advanceStage(Set<Id> projectIds, String newStage);
    Id submitBacklogJob();
}
```

```apex
public with sharing class ProjectsService
{
    public class ServiceException extends Exception {}

    public static Set<Id> createFromOpportunities(Set<Id> opportunityIds)
    {
        return service().createFromOpportunities(opportunityIds);
    }

    public static Map<Id, Id> createFromOpportunitiesIndexed(Set<Id> opportunityIds)
    {
        return service().createFromOpportunitiesIndexed(opportunityIds);
    }

    // advanceStage and submitBacklogJob follow the same one-line shim shape

    private static IProjectsService service()
    {
        return (IProjectsService) Application.Service.newInstance(IProjectsService.class);
    }
}
```

```apex
public with sharing class ProjectsServiceImpl implements IProjectsService
{
    public Set<Id> createFromOpportunities(Set<Id> opportunityIds)
    {
        return new Set<Id>(createFromOpportunitiesIndexed(opportunityIds).values());
    }

    public Map<Id, Id> createFromOpportunitiesIndexed(Set<Id> opportunityIds)
    {
        if (opportunityIds == null || opportunityIds.isEmpty())
        {
            throw new ProjectsService.ServiceException('At least one Opportunity Id is required.');
        }

        // A2: Opportunities that already have a Project are returned, not recreated
        Map<Id, Id> projectIdByOpportunityId = new Map<Id, Id>();
        for (Project__c existing :
                ProjectsSelector.newInstance().selectByOpportunityId(opportunityIds))
        {
            projectIdByOpportunityId.put(existing.Opportunity__c, existing.Id);
        }

        Set<Id> toCreate = new Set<Id>(opportunityIds);
        toCreate.removeAll(projectIdByOpportunityId.keySet());
        if (toCreate.isEmpty()) { return projectIdByOpportunityId; }

        fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();
        String correlationId = LoggingService.newCorrelationId();
        Map<Id, Project__c> projectByOpportunityId = new Map<Id, Project__c>();

        for (Opportunity opp : OpportunitiesSelector.newInstance().selectByIdWithLineItems(toCreate))
        {
            Project__c project = new Project__c(
                Name = opp.Name.left(80),
                Account__c = opp.AccountId,
                Opportunity__c = opp.Id,
                Stage__c = 'Planning');
            uow.registerNew(project);
            projectByOpportunityId.put(opp.Id, project);

            Integer sequence = 1;
            for (OpportunityLineItem line : opp.OpportunityLineItems)
            {
                ProjectTask__c task = new ProjectTask__c(
                    Name = String.isBlank(line.Description) ? 'Task ' + sequence
                                                            : line.Description.left(80),
                    Description__c = line.Description,
                    Sequence__c = sequence);
                // Parent has no Id yet; the UoW resolves the lookup after Project__c is inserted
                uow.registerNew(task, ProjectTask__c.Project__c, project);
                sequence++;
            }

            uow.registerPublishAfterSuccessTransaction(new ProjectEvent__e(   // A4
                Opportunity__c = opp.Id, Action__c = 'ProjectCreated',
                CorrelationId__c = correlationId));
            uow.registerPublishAfterFailureTransaction(new ProjectEvent__e(
                Opportunity__c = opp.Id, Action__c = 'ProjectCreateFailed',
                CorrelationId__c = correlationId));
        }

        try
        {
            uow.commitWork();
        }
        catch (DmlException e)
        {
            ProjectsService.ServiceException wrapped = new ProjectsService.ServiceException(
                'Could not create ' + projectByOpportunityId.size() + ' Projects: '
                + e.getDmlMessage(0));
            wrapped.initCause(e);
            throw wrapped;
        }

        for (Id opportunityId : projectByOpportunityId.keySet())
        {
            projectIdByOpportunityId.put(
                opportunityId, projectByOpportunityId.get(opportunityId).Id);
        }
        return projectIdByOpportunityId;
    }

    public Id submitBacklogJob()
    {
        return Database.executeBatch(new ProjectBacklogJob(), 200);
    }
}
```

`LoggingService.newCorrelationId()` is the org's own helper; the correlation-id pattern lives in
skill `sf-fflib-operations` and skill `sf-debugging-logs`.

## 6. Entry points

```apex
public with sharing class ProjectCreationController
{
    @AuraEnabled
    public static Id createProject(Id opportunityId)
    {
        try
        {
            return ProjectsService.createFromOpportunitiesIndexed(new Set<Id>{ opportunityId })
                .get(opportunityId);
        }
        catch (Exception e)
        {
            AuraHandledException handled = new AuraHandledException(e.getMessage());
            handled.setMessage(e.getMessage());
            throw handled;
        }
    }
}
```

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

        // One service call for the whole Flow batch
        Map<Id, Id> projectIdByOpportunityId =
            ProjectsService.createFromOpportunitiesIndexed(opportunityIds);

        List<Result> results = new List<Result>();
        for (Request request : requests)
        {
            Result result = new Result();
            result.projectId = projectIdByOpportunityId.get(request.opportunityId);
            results.add(result);
        }
        return results;   // same size and order as the input list
    }
}
```

## 7. Tests

A DML-free service test (selector, domain and Unit of Work all injected through the factories) is
shown in [service-layer.md](service-layer.md) section 6; mock mechanics belong to skill
`sf-fflib-testing`. The test below is the DML integration counterpart that proves the trigger path.

```apex
@IsTest
private class ProjectCreationIntegrationTest
{
    @TestSetup
    private static void setup()
    {
        Account account = new Account(Name = 'Bulk Co');
        insert account;

        List<Opportunity> opps = new List<Opportunity>();
        for (Integer i = 0; i < 200; i++)
        {
            opps.add(new Opportunity(
                Name = 'Opp ' + i, AccountId = account.Id,
                StageName = 'Prospecting', CloseDate = System.today().addDays(10)));
        }
        insert opps;
    }

    @IsTest
    private static void bulkCloseWonCreatesOneProjectEach()
    {
        List<Opportunity> opps = [SELECT Id, StageName FROM Opportunity];
        for (Opportunity opp : opps) { opp.StageName = 'Closed Won'; }

        Test.startTest();
        update opps;                      // 200 records, one DML, one trigger invocation
        Test.stopTest();

        Assert.areEqual(200, [SELECT COUNT() FROM Project__c]);                            // A1
        Assert.areEqual(200, [SELECT COUNT() FROM Project__c WHERE Stage__c = 'Planning']);

        // A2: the service is idempotent for the same Opportunities
        ProjectsService.createFromOpportunities(new Map<Id, SObject>(opps).keySet());
        Assert.areEqual(200, [SELECT COUNT() FROM Project__c]);
    }
}
```

## 8. Verify

```bash
# Local gate before anything touches an org
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed

# Check-only validation, then quick-deploy the recorded job id
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-validate --target-org vf-int
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" deploy-quick --target-org vf-int

# Org tests plus coverage gates (85 org / 75 per class)
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-int

# Targeted run while iterating
sf apex run test --target-org vf-dev --synchronous --code-coverage --result-format human \
  --tests ProjectsServiceTest --tests ProjectCreationIntegrationTest

# Post-deploy smoke
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" smoke --target-org vf-int
sf data query --target-org vf-int \
  --query "SELECT COUNT(Id) total FROM Project__c WHERE CreatedDate = TODAY"
```

Wave mapping (skill `sf-workflow-orchestration`): `sf-quality-gate` runs `vf-check local`,
`sf-security-reviewer` reviews the user-mode DML and every `disableTriggerCRUDSecurity()` call,
`sf-deploy-engineer` runs validate then quick deploy, `sf-org-verifier` runs `vf-check smoke`
(skill `sf-post-deploy-verification`).
