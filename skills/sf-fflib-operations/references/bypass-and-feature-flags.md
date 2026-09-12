# Bypass Switches and Feature Flags for fflib

Everything an operator needs to turn fflib behaviour off safely, and everything a developer needs to
ship two implementations behind a metadata switch.

Grounded in `fflib-apex-common` `master` @ `dab5977`
(`fflib_SObjectDomain.TriggerEvent`, `fflib_Application.ServiceFactory`) and the Apex Reference for
[custom metadata type methods](https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_methods_system_custom_metadata_types.htm).

## 1. Switch taxonomy

| Switch | Scope | Who flips it | Survives the transaction | Cost |
| --- | --- | --- | --- | --- |
| `fflib_SObjectDomain.getTriggerEvent(X.class).disableAfterUpdate()` | Current transaction, one domain type | Apex code only | No | None |
| Custom permission via `FeatureManagement.checkPermission` | Running user | Admin, via permission set assignment | Yes | No SOQL |
| Hierarchy custom setting `X__c.getInstance()` | Org, profile or user | Admin, via Manage page | Yes | No SOQL |
| Custom metadata `X__mdt.getInstance()` | Org-wide, deployable, source-controlled | Admin plus a deploy | Yes | No SOQL |
| Static Apex boolean | Current transaction | Apex code only | No | None |

Rules of thumb:

- A switch that has to be **deployable and reviewable** is custom metadata.
- A switch that has to apply to **one user or one integration account** is a custom permission.
- A switch that has to be flipped **without a deploy, per user, right now** is a hierarchy custom
  setting. Everything else is custom metadata.
- A switch used **inside a job** (suppress the child object's domain while the job owns that logic)
  is `TriggerEvent`, in a `try/finally`.

## 2. Metadata definitions

`force-app/main/default/objects/Bypass__mdt/Bypass__mdt.object-meta.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Bypass</label>
    <pluralLabel>Bypasses</pluralLabel>
    <visibility>Public</visibility>
</CustomObject>
```

Fields: `Disabled__c` (Checkbox), `CustomPermission__c` (Text 255), `Notes__c` (Text 255).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Disabled__c</fullName>
    <label>Disabled</label>
    <type>Checkbox</type>
    <defaultValue>false</defaultValue>
</CustomField>
```

Records are metadata too, one file per switch
(`customMetadata/Bypass.Trigger_Opportunity.md-meta.xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Trigger Opportunity</label>
    <protected>false</protected>
    <values><field>Disabled__c</field><value xsi:type="xsd:boolean"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">false</value></values>
    <values><field>CustomPermission__c</field><value xsi:type="xsd:string"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">Bypass_Opportunity_Automation</value></values>
</CustomMetadata>
```

Custom permission (`customPermissions/Bypass_Opportunity_Automation.customPermission-meta.xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomPermission xmlns="http://soap.sforce.com/2006/04/metadata">
    <isLicensed>false</isLicensed>
    <label>Bypass Opportunity Automation</label>
</CustomPermission>
```

Permission set that grants it
(`permissionsets/Data_Load_Bypass.permissionset-meta.xml`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Data Load Bypass</label>
    <hasActivationRequired>true</hasActivationRequired>
    <customPermissions>
        <enabled>true</enabled>
        <name>Bypass_Opportunity_Automation</name>
    </customPermissions>
</PermissionSet>
```

`hasActivationRequired` makes it a session-activated permission set, so it is not permanently on for
the loader user. Permission-set design: skill `sf-security-model`.

## 3. `BypassService`

```apex
/**
 * Single read point for every operational switch. One transaction-level cache means the
 * metadata is resolved at most once per feature per transaction.
 */
public with sharing class BypassService
{
    private static final Map<String, Boolean> CACHE = new Map<String, Boolean>();

    public static Boolean isBypassed(SObjectType objectType)
    {
        return isBypassed('Trigger_' + objectType.getDescribe().getName());
    }

    public static Boolean isBypassed(String featureName)
    {
        if (CACHE.containsKey(featureName)) { return CACHE.get(featureName); }

        Bypass__mdt setting = Bypass__mdt.getInstance(featureName);   // metadata cache, no SOQL
        Boolean bypassed = setting != null
            && (setting.Disabled__c
                || (String.isNotBlank(setting.CustomPermission__c)
                    && FeatureManagement.checkPermission(setting.CustomPermission__c)));

        CACHE.put(featureName, bypassed);
        return bypassed;
    }

    /** Suppress a feature for the remainder of this transaction only. */
    public static void suppress(String featureName) { CACHE.put(featureName, true); }

    @TestVisible
    private static void setBypass(String featureName, Boolean value)
    {
        CACHE.put(featureName, value);
    }

    @TestVisible
    private static void clear() { CACHE.clear(); }
}
```

Why a cache: `getInstance` is cheap but `objectType.getDescribe()` is not free, and a domain that is
constructed once per recursion level would otherwise re-resolve the same switch repeatedly. The cache
is static, so it lives exactly as long as the transaction.

Note `Bypass__mdt.getInstance(...)` returns only the first 255 characters of each field; keep switch
fields short and never store JSON payloads in them.

### Integration points

```apex
// Domain: skip the whole object's automation
public override void onAfterUpdate(Map<Id, SObject> existingRecords)
{
    if (BypassService.isBypassed(Opportunity.SObjectType)) { return; }
    // ...
}
```

```apex
// Service: skip one feature, keep the rest of the transaction intact
public Set<Id> createFromOpportunities(Set<Id> opportunityIds)
{
    if (BypassService.isBypassed('Feature_ProjectAutoCreation')) { return new Set<Id>(); }
    // ...
}
```

```apex
// Job: suppress a child object's domain while this job owns that logic
public void execute(Database.BatchableContext context, List<Opportunity> scope)
{
    fflib_SObjectDomain.getTriggerEvent(Projects.class).disableAllAfter();
    try
    {
        ProjectsService.createFromOpportunities(new Map<Id, SObject>(scope).keySet());
    }
    finally
    {
        fflib_SObjectDomain.getTriggerEvent(Projects.class).enableAllAfter();
    }
}
```

The `finally` matters: `TriggerEvent` state is static for the transaction, and a Batch chunk that
leaves it disabled poisons nothing else only because the chunk ends - but a Queueable chain in the
same transaction would inherit the disabled state.

### Tests

```apex
@IsTest
private class BypassServiceTest
{
    @IsTest
    private static void suppressShortCircuitsTheDomain()
    {
        Account account = new Account(Name = 'Test');
        insert account;
        Opportunity opp = new Opportunity(
            Name = 'Test', AccountId = account.Id,
            StageName = 'Prospecting', CloseDate = System.today());
        insert opp;

        BypassService.setBypass('Trigger_Opportunity', true);

        Test.startTest();
        opp.StageName = 'Closed Won';
        update opp;
        Test.stopTest();

        Assert.areEqual(0, [SELECT COUNT() FROM Project__c],
            'Bypassed automation must not create projects');
    }

    @IsTest
    private static void customPermissionGrantsBypass()
    {
        // Requires a Bypass__mdt record whose CustomPermission__c names an assignable permission
        User loader = TestUsers.standardUser();
        insert loader;
        TestUsers.assignPermissionSet(loader.Id, 'Data_Load_Bypass');

        System.runAs(loader)
        {
            BypassService.clear();
            Assert.isTrue(BypassService.isBypassed(Opportunity.SObjectType));
        }
    }

    @IsTest
    private static void defaultIsNotBypassed()
    {
        BypassService.clear();
        Assert.isFalse(BypassService.isBypassed('Feature_DoesNotExist'),
            'An unknown feature must never bypass');
    }
}
```

`setBypass` keeps the happy path testable without deploying metadata records; the permission test is
the one that proves the real wiring. `System.runAs` and permission-set assignment helpers:
skill `sf-apex-testing`.

**Fail closed.** An unknown feature name returns `false` (not bypassed). A typo in a switch name must
never silently disable automation.

## 4. Data-load bypass

Sequence for a bulk load that must not trigger fflib automation:

```bash
# 1. Assign the session-activated permission set to the loading user
sf org assign permset --target-org vf-int --name Data_Load_Bypass \
  --on-behalf-of integration.user@example.com

# 2. Confirm the switch is live before loading anything
sf apex run --target-org vf-int --file scripts/apex/assert-bypass-active.apex

# 3. Load
sf data import bulk --target-org vf-int --sobject Opportunity \
  --file data/opportunities.csv --wait 20

# 4. Remove the assignment immediately after
sf org assign permset --target-org vf-int --name Data_Load_Bypass \
  --on-behalf-of integration.user@example.com --json > /dev/null
sf data query --target-org vf-int \
  --query "SELECT Id FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Data_Load_Bypass'"
```

```apex
// scripts/apex/assert-bypass-active.apex
if (!BypassService.isBypassed(Opportunity.SObjectType))
{
    throw new IllegalArgumentException('Bypass is NOT active - abort the load.');
}
System.debug(LoggingLevel.ERROR, 'Bypass active for ' + UserInfo.getUserName());
```

Step 4 deletes the assignment through the API; `sf org assign permset` has no unassign verb, so use
`sf data delete record --sobject PermissionSetAssignment --record-id <id>` or a small anonymous Apex
block. File shaping, external ids and load ordering: skill `sf-data-management`.

**After every bypassed load, run the reconciliation job**, because the automation that did not fire
still owes its side effects:

```bash
sf apex run --target-org vf-int --file scripts/apex/reconcile-projects.apex
```

## 5. Feature flags as binding swaps

The fflib advantage is that a feature flag changes which class the factory constructs, so neither
implementation is polluted with flag checks.

```apex
public class Application
{
    public static final fflib_Application.ServiceFactory Service =
        new fflib_Application.ServiceFactory(serviceBindings());

    private static Map<Type, Type> serviceBindings()
    {
        Boolean useV2 = !BypassService.isBypassed('Feature_NewPricing');
        return new Map<Type, Type>{
            IProjectsService.class => ProjectsServiceImpl.class,
            IPricingService.class  => useV2 ? PricingServiceV2Impl.class
                                            : PricingServiceV1Impl.class
        };
    }
}
```

Caveat: `Application.Service` is a `static final` field, so `serviceBindings()` runs once per
transaction at class initialisation. Flipping the switch mid-transaction has no effect - which is
what you want, because a transaction should not change implementation halfway.

Test both branches by injecting the mock rather than by flipping metadata:

```apex
@IsTest
private class PricingBindingTest
{
    @IsTest
    private static void v2IsUsedWhenTheFlagIsOn()
    {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        IPricingService serviceMock = (IPricingService) mocks.mock(IPricingService.class);
        Application.Service.setMock(IPricingService.class, serviceMock);

        PricingService.repriceAll(new Set<Id>());

        ((IPricingService) mocks.verify(serviceMock, 1)).repriceAll(new Set<Id>());
    }
}
```

For genuine branch coverage of the binding logic itself, extract `serviceBindings()` into a
`@TestVisible` method and assert the map contents directly:

```apex
@IsTest
private static void bindingFollowsTheFlag()
{
    BypassService.setBypass('Feature_NewPricing', true);
    Assert.areEqual(PricingServiceV1Impl.class, Application.serviceBindings().get(IPricingService.class));

    BypassService.setBypass('Feature_NewPricing', false);
    Assert.areEqual(PricingServiceV2Impl.class, Application.serviceBindings().get(IPricingService.class));
}
```

The same technique swaps a domain constructor or a selector class in
`Application.Domain` / `Application.Selector` - see skill `sf-fflib-foundations`.

## 6. Operating the switches

| Question | Command |
| --- | --- |
| Which switches exist? | `sf data query --target-org vf-int --query "SELECT DeveloperName, Disabled__c, CustomPermission__c FROM Bypass__mdt"` |
| Which are off right now? | add `WHERE Disabled__c = true` |
| Who can bypass? | `sf data query --target-org vf-int --query "SELECT Assignee.Username FROM PermissionSetAssignment WHERE PermissionSet.Name = 'Data_Load_Bypass'"` |
| Flip one for an incident | Edit the `customMetadata/*.md-meta.xml` record and `sf project deploy start --target-org vf-prod --source-dir force-app/main/default/customMetadata` |
| Prove it took effect | `sf apex run --target-org vf-prod --file scripts/apex/assert-bypass-active.apex` |

Deploying a single custom-metadata record is a metadata deploy and therefore subject to the org's
deploy policy. In vibe-force, production deploys are gated - see skill `sf-deployment-strategies`
and run `vf-check deploy-validate` first.

## 7. Checklist

| # | Check |
| --- | --- |
| 1 | Exactly one class reads switches; no `FeatureManagement.checkPermission` scattered through domains |
| 2 | Unknown feature name returns "not bypassed" (fail closed) |
| 3 | Switch checked once per invocation, never inside a record loop |
| 4 | `TriggerEvent` toggles wrapped in `try/finally` |
| 5 | Every switch has a custom-metadata record in source control with a `Notes__c` explaining it |
| 6 | Bypass permission sets are session-activated and assigned only for the duration of a load |
| 7 | A reconciliation job exists for every bypassable automation |
| 8 | Tests cover bypassed, not-bypassed and unknown-switch paths |
| 9 | Feature-flag branches both have tests; binding logic asserted directly |
| 10 | `vf-check analyzer --changed` and `vf-check apex --target-org <alias>` pass |
