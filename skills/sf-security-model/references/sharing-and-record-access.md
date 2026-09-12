# Sharing and Record Access Reference

Record-level access: how Salesforce computes it, how Apex participates, and how to write and test
Apex managed sharing. Sources: Apex Developer Guide
[Understanding Apex Managed Sharing](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_bulk_sharing.htm),
[Understanding Sharing](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_bulk_sharing_understanding.htm),
[Sharing a Record Using Apex](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_bulk_sharing_creating_with_apex.htm),
[sharing keywords](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_keywords_sharing.htm),
Secure Coding Guide
[Sharing Violations](https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_access_control_protect_from_sharing_violations.htm).

## 1. How record access is computed

Access is the most permissive result across all of these; they are additive and never subtractive
(restriction rules are the exception and are evaluated after sharing):

| Source | Stored as a share row? | Notes |
| --- | --- | --- |
| Organization-wide default (OWD) | no | baseline per object |
| Record ownership | yes (`RowCause = Owner`) | owner gets Full Access: view, edit, transfer, share, delete |
| Role hierarchy | no, derived at run time | users above the owner get the owner's access; can be disabled per custom object |
| Sharing rules (owner-based or criteria-based) | yes (`RowCause = Rule`) | cannot be packaged; criteria-based sharing cannot be created or tested from Apex |
| Manual (user managed) sharing | yes (`RowCause = Manual`) | removed on owner change or if it no longer grants more than the OWD |
| Apex managed sharing | yes (developer-defined `RowCause`) | survives owner change and owner deactivation; custom objects only for sharing reasons |
| Team sharing (account/opportunity/case teams) | yes (`RowCause = Team`) | standard objects |
| Implicit (account to child) sharing | yes (`ImplicitParent`, `ImplicitChild`) | platform managed, not editable via UI, API, or Apex |
| Territory assignment | yes (`TerritoryRule`, `Territory2AssociationManual`) | Enterprise Territory Management, API 45.0+ replaced `TerritoryManual` |
| `View All`/`Modify All` object permissions, `View All Data`/`Modify All Data` | no | permission-driven, not tracked in share rows |

## 2. `rowCause` values

| Reason field value (UI) | `rowCause` value (Apex/API) | Category |
| --- | --- | --- |
| Account Sharing | `ImplicitChild` | managed |
| Associated record owner or sharing | `ImplicitParent` | managed |
| Owner | `Owner` | managed |
| Opportunity Team | `Team` | managed |
| Sharing Rule | `Rule` | managed |
| Territory Assignment Rule | `TerritoryRule` | managed |
| Manual Sharing | `Manual` | user managed |
| Territory Manual | `TerritoryManual` (replaced by `Territory2AssociationManual` in API 45.0+ with Enterprise Territory Management) | user managed |
| Defined by developer | custom Apex sharing reason, e.g. `Recruiter__c` | Apex managed |

## 3. Access levels on share objects

| Access level (UI) | API name | Meaning |
| --- | --- | --- |
| Private | `None` | owner and role hierarchy above only; applies to `AccountShare` only |
| Read Only | `Read` | view |
| Read/Write | `Edit` | view and edit |
| Full Access | `All` | view, edit, transfer, share, delete - **managed sharing only, cannot be granted by your code** |

The share object property that carries the level is `<Object>AccessLevel`: `LeadShare.LeadAccessLevel`,
`Job__Share.AccessLevel` for custom objects.

## 4. Sharing keywords

| Keyword | Record access | When to use | Notes |
| --- | --- | --- | --- |
| `with sharing` | current user's sharing enforced | default for everything | default for classes with no declaration in API 67.0+ |
| `without sharing` | sharing ignored | narrow, documented elevation (for example guest-user reads, platform aggregation) | can expose data the user should not see |
| `inherited sharing` | mode of the calling class | reusable service and selector layers | runs `with sharing` when it is itself the entry point |

Entry points where `inherited sharing` resolves to `with sharing`: Aura component controller,
`@AuraEnabled` method called from LWC, Visualforce controller, Apex REST service, asynchronous Apex
class, and any other transaction entry point. It runs `without sharing` only when explicitly called
from an already-established `without sharing` context. Asynchronous classes declared
`inherited sharing` always run `with sharing`, because each async operation is a new entry point and
the sharing mode is not serialized. Anonymous Apex and Connect in Apex always run `with sharing`.

Other rules that surprise people:

- The sharing mode of a method is determined by where it is **defined**, not where it is called from
  (except for `inherited sharing`).
- Inner classes do not inherit the sharing mode of the outer class; declare both.
- A class with no declaration that `extends` a parent adopts the parent's mode.
- Sharing declarations never enforce object or field permissions.
- Triggers cannot declare a sharing mode: they run `without sharing`. In API 67.0+ their SOQL and DML
  default to user mode, which re-applies the running user's record sharing and so effectively
  overrides the trigger's `without sharing` context. `WITH SYSTEM_MODE` inside a trigger returns
  record access to the trigger's `without sharing` context.

```apex
// API 67.0 and later
trigger AccountUpdateTrigger on Account (after update) {
    // Defaults to WITH USER_MODE: object/field perms enforced AND record sharing re-applied
    List<Contact> visible = [
        SELECT Id, Name, AccountId FROM Contact WHERE AccountId IN :Trigger.newMap.keySet()
    ];
    // Explicit system mode: perms bypassed, record access follows the trigger's without sharing
    List<Contact> all = [
        SELECT Id, Name, AccountId FROM Contact
        WHERE AccountId IN :Trigger.newMap.keySet()
        WITH SYSTEM_MODE
    ];
    AccountTriggerHandler.afterUpdate(visible, all);
}
```

## 5. Manual sharing from Apex

```apex
public with sharing class JobSharing {
    public static Boolean shareRead(Id recordId, Id userOrGroupId) {
        Job__Share share = new Job__Share(
            ParentId = recordId,
            UserOrGroupId = userOrGroupId,
            AccessLevel = 'Read',
            RowCause = Schema.Job__Share.RowCause.Manual  // default; shown for clarity
        );
        Database.SaveResult sr = Database.insert(share, false, AccessLevel.USER_MODE);
        if (sr.isSuccess()) {
            return true;
        }
        Database.Error err = sr.getErrors()[0];
        // A share that grants no more than the OWD is rejected and is not needed
        Boolean trivial = err.getStatusCode() == StatusCode.FIELD_FILTER_VALIDATION_EXCEPTION
            && err.getMessage().contains('AccessLevel');
        return trivial;
    }
}
```

Preconditions and gotchas:

- The object's OWD must **not** already be the most permissive value (`Public Read/Write` for custom
  objects), otherwise every share insert is a trivial share and fails validation.
- Objects on the detail side of a master-detail relationship have no share object: access derives
  from the master and the relationship's sharing setting.
- `RowCause = 'Manual'` rows are deleted automatically when record ownership changes.
- Inserting share rows requires the running user to have sharing rights on the record; Apex managed
  sharing rows (custom `RowCause`) require `Modify All Data`.

## 6. Apex managed sharing with a sharing reason

Create the Apex sharing reason on the custom object (Setup, Salesforce Classic only, Apex Sharing
Reasons related list). Reference it as `Schema.<Object>__Share.rowCause.<Reason>__c`.

```apex
trigger JobApexSharing on Job__c (after insert) {
    List<Job__Share> shares = new List<Job__Share>();
    for (Job__c job : Trigger.new) {
        if (job.Recruiter__c != null) {
            shares.add(new Job__Share(
                ParentId = job.Id,
                UserOrGroupId = job.Recruiter__c,
                AccessLevel = 'Edit',
                RowCause = Schema.Job__Share.RowCause.Recruiter__c
            ));
        }
        if (job.Hiring_Manager__c != null) {
            shares.add(new Job__Share(
                ParentId = job.Id,
                UserOrGroupId = job.Hiring_Manager__c,
                AccessLevel = 'Read',
                RowCause = Schema.Job__Share.RowCause.Hiring_Manager__c
            ));
        }
    }
    if (!shares.isEmpty()) {
        // Bulk insert once; never one DML per record (skill sf-governor-limits)
        Database.insert(shares, false, AccessLevel.SYSTEM_MODE);
    }
}
```

Why separate reasons per relationship: each reason can be updated or deleted independently, the UI
Reason column explains provenance, and the same user can be shared the same record multiple times
under different reasons without collisions.

Constraints: Apex sharing reasons and Apex managed sharing recalculation are available for **custom
objects only**. Sharing reasons are not available in Lightning Experience setup UI.

## 7. Recalculation

When you change the criteria that drive Apex managed sharing (a new field feeding a reason, a
back-fill after data load), existing share rows are stale. Attach a recalculation class to the
custom object's Apex sharing reason so Salesforce can rebuild them, and expose the same logic to a
manual run.

```apex
global with sharing class JobSharingRecalculation implements Database.Batchable<SObject> {
    global Database.QueryLocator start(Database.BatchableContext ctx) {
        return Database.getQueryLocator(
            'SELECT Id, Recruiter__c, Hiring_Manager__c FROM Job__c',
            AccessLevel.SYSTEM_MODE
        );
    }

    global void execute(Database.BatchableContext ctx, List<Job__c> scope) {
        Set<Id> jobIds = new Map<Id, Job__c>(scope).keySet();
        // Remove only the rows this app owns, identified by its own row causes
        List<Job__Share> stale = [
            SELECT Id FROM Job__Share
            WHERE ParentId IN :jobIds
              AND RowCause IN ('Recruiter__c', 'Hiring_Manager__c')
            WITH SYSTEM_MODE
        ];
        if (!stale.isEmpty()) {
            delete as system stale;
        }
        List<Job__Share> rebuilt = JobSharingService.buildShares(scope);
        if (!rebuilt.isEmpty()) {
            Database.insert(rebuilt, false, AccessLevel.SYSTEM_MODE);
        }
    }

    global void finish(Database.BatchableContext ctx) {
        // Emit an outcome the org verifier can assert on (skill sf-post-deploy-verification)
    }
}
```

Recalculation jobs appear in `AsyncApexJob` with `JobType = 'SharingRecalculation'`; monitor them
with the query in skill `sf-debugging-logs`
(`references/production-diagnostics.md`). Batch chunking limits and retry semantics: skill
`sf-async-apex-patterns`.

## 8. Group membership and targets

`UserOrGroupId` accepts a user Id or a `Group` Id. Useful group types when granting access to a
population rather than individuals:

| Group type | `Group.Type` | Typical use |
| --- | --- | --- |
| Public group | `Regular` | curated population, stable Id, deployable as metadata |
| Queue | `Queue` | ownership plus access for a work queue |
| Role | `Role` | everyone in a role |
| Role and subordinates | `RoleAndSubordinates` | management chain |
| Role, internal and portal subordinates | `RoleAndSubordinatesInternal` / portal variants | Experience Cloud populations |

Prefer public groups over role-derived groups in packaged or deployed code: role Ids differ per org,
public group `DeveloperName` is stable and retrievable as metadata.

## 9. Sharing considerations for triggers and ownership changes

- If a trigger changes record ownership, the running user must have read access to the new owner's
  `User` record when the trigger is started from the API, the standard UI, a standard Visualforce
  controller, or a class declared `with sharing`.
- If the trigger is started from a class that is not `with sharing`, the trigger runs in system mode
  and no specific access is required of the running user.
- Implicit shares added by platform managed sharing cannot be altered from the UI, SOAP API, or Apex.

## 10. Decision guide: which record-access tool

| Requirement | Tool |
| --- | --- |
| Everyone in a role branch sees a record type | role hierarchy + owner-based sharing rule (config, no code) |
| Access follows a field value that changes | Apex managed sharing with a per-relationship reason + recalculation batch |
| One-off grant by an end user | manual sharing (UI) or `RowCause = Manual` from Apex |
| Access for a packaged app | Apex managed sharing (sharing rules cannot be packaged) |
| Guest user must read reference data | `without sharing` selector, narrowest possible query, documented, covered by a negative test |
| Deny access that sharing would otherwise grant | restriction rules (config) - sharing itself is additive only |
| LWC needs record CRUD with all layers enforced | `lightning/uiRecordApi` / `lightning-record-form` (skill `sf-lwc-development`) |

## 11. Test patterns

```apex
@IsTest
private class JobSharingTest {
    @IsTest
    static void managedShareGrantsEditToRecruiter() {
        List<User> users = [SELECT Id FROM User WHERE IsActive = true WITH USER_MODE LIMIT 2];
        Job__c job = new Job__c(Name = 'Test Job', OwnerId = users[0].Id, Recruiter__c = users[1].Id);
        insert as user job;

        List<Job__Share> shares = [
            SELECT UserOrGroupId, AccessLevel, RowCause
            FROM Job__Share
            WHERE ParentId = :job.Id AND UserOrGroupId = :users[1].Id
            WITH SYSTEM_MODE
        ];
        Assert.areEqual(1, shares.size(), 'Set the object OWD to Private for this test to be meaningful');
        Assert.areEqual('Edit', shares[0].AccessLevel);
        Assert.areEqual('Recruiter__c', shares[0].RowCause);
    }

    @IsTest
    static void recruiterCanSeeJob() {
        // Record visibility assertions must run as the target persona
        List<User> users = [SELECT Id FROM User WHERE IsActive = true WITH USER_MODE LIMIT 2];
        Job__c job = new Job__c(Name = 'Visible Job', OwnerId = users[0].Id, Recruiter__c = users[1].Id);
        insert as user job;
        System.runAs(new User(Id = users[1].Id)) {
            Assert.areEqual(
                1,
                [SELECT COUNT() FROM Job__c WHERE Id = :job.Id WITH USER_MODE],
                'Recruiter should see the job through the Apex managed share'
            );
        }
    }
}
```

Notes: criteria-based sharing rules cannot be tested from Apex; OWD must be restrictive in the
target org for share assertions to mean anything, so keep OWD in the scratch org definition
(skill `sf-scratch-orgs-sandboxes`).

## 12. Gate mapping

| Requirement | Detecting rule / check |
| --- | --- |
| Missing or implicit sharing declaration on a class with DML | `pmd:ApexSharingViolations`, `sfge:DatabaseOperationsMustUseWithSharing` |
| `without sharing` reached from an entry point | `sfge:DatabaseOperationsMustUseWithSharing` message "must be executed from a class that enforces sharing rules" |
| Share DML inside a loop | `sfge:AvoidDatabaseOperationInLoop`, `pmd:OperationWithLimitsInLoop` |
| Local gate | `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local` |
| Post-deploy record-visibility probe | `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" smoke --target-org vf-uat` |
