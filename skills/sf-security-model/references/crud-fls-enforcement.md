# CRUD and FLS Enforcement Reference

Every mechanism Apex offers for object-level (CRUD) and field-level (FLS) enforcement, when to use
it, the exact code, and how to prove it works. Grounded in the Apex Developer Guide
([Enforce Object and Field Permissions](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_perms_enforcing.htm),
[Set an Access Mode for Database Operations](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_enforce_usermode.htm),
[stripInaccessible](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_with_security_stripInaccessible.htm),
[Field and SObject Describe Methods](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_field_object_describe.htm))
and the Secure Coding Guide
([CRUD/FLS](https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_access_control_protect_from_crud_fls_vulnerabilities.htm)).

## 1. Version behaviour that drives every choice

| Statement | API 66.0 and earlier | API 67.0 and later |
| --- | --- | --- |
| `[SELECT ...]` with no clause | system mode | user mode |
| `insert acc;` | system mode | user mode |
| `Database.insert(acc, false)` | system mode | user mode |
| `Database.query(q)` | system mode | user mode |
| `public class X` with no sharing keyword | depends on inheritance chain, entry point, and caller | `with sharing` |
| `WITH SECURITY_ENFORCED` in an Apex SOQL `SELECT` | allowed | not allowed: the clause is rejected in Apex code |

Because the same source file behaves differently depending on the API version stamped in its
`*.cls-meta.xml`, vibe-force requires an explicit access mode on every database operation. That
makes review, static analysis, and Graph Engine sanitizer detection deterministic.

## 2. Mechanism decision matrix

| Mechanism | Enforces | Failure behaviour | Use when | Graph Engine sanitizer |
| --- | --- | --- | --- | --- |
| `WITH USER_MODE` (SOQL/SOSL) | object perms, FLS, sharing, restriction rules | `System.QueryException` | default for reads | yes |
| `WITH SYSTEM_MODE` | nothing (sharing still follows class keyword) | none | deliberate elevation, documented | n/a (it is the bypass) |
| `as user` / `as system` (DML statement) | object perms, FLS (+ sharing in user mode) | `System.DmlException` | default for statement DML | yes (`as user`) |
| `AccessLevel.USER_MODE` (Database/Search methods) | object perms, FLS, sharing | exception or `SaveResult` errors with `allOrNone=false` | partial-success DML, dynamic SOQL | yes |
| `Security.stripInaccessible(AccessType, records)` | FLS + object perms, field stripping | silently strips, reports via decision object | graceful degradation, untrusted deserialized input | yes |
| `Schema.DescribeSObjectResult.isCreateable()` etc. | object perms (+ some field checks) | your code decides | pre-flight UX checks, DELETE/UNDELETE/MERGE gating | yes (CRUD-level ops) |
| `Schema.DescribeFieldResult.isAccessible()` etc. | FLS per field | your code decides | dynamic field lists, allowlists | yes (FLS-level ops) |
| `WITH SECURITY_ENFORCED` | object perms + FLS on the `SELECT` list only | `System.QueryException` on the first error | **never in new code** - not usable in Apex at API 67.0+ | yes |
| `lightning/uiRecordApi` + LDS (client) | sharing, CRUD, FLS | wire `error` payload | LWC record CRUD without Apex | n/a (no Apex) |

On `WITH SECURITY_ENFORCED`: in API version 67.0 and later you cannot use the clause in a SOQL
`SELECT` query in Apex code; use `WITH USER_MODE` instead. Even in pre-67.0 code it was inferior -
it reported only the first FLS error, did not process the `WHERE` clause, did not account for
polymorphic fields such as `Owner` and `Task.WhatId`, and was not allowed in AppExchange packages.
When raising a legacy class to API 67.0, replacing each `WITH SECURITY_ENFORCED` with
`WITH USER_MODE` is part of the version bump, not a separate refactor. Graph Engine still recognises
the clause as an `ApexFlsViolation` sanitizer, which is why old code can pass analysis and still fail
to compile at 67.0.

## 3. Operations that accept an access level

| Operation | Access-level support |
| --- | --- |
| `Database.query`, `Database.getQueryLocator`, `Database.countQuery`, `Database.getCursor`, `Database.getPaginationCursor` | optional `accessLevel` parameter |
| `Search.query` | optional `accessLevel` parameter |
| `Database` DML: `insert`, `update`, `upsert`, `merge`, `delete`, `undelete`, `convertLead`, plus `*Immediate` and `*Async` variants (`insertImmediate`, `deleteAsync`, ...) | optional `accessLevel` parameter |
| `Database.queryWithBinds`, `Database.getQueryLocatorWithBinds`, `Database.countQueryWithBinds`, `Database.getCursorWithBinds`, `Database.getPaginationCursorWithBinds` | `accessLevel` **required** |
| SOQL/SOSL inline queries | `WITH USER_MODE` / `WITH SYSTEM_MODE` clause |
| DML statements | `as user` / `as system` keyword |

## 4. Error introspection per mechanism

| Mechanism | How to read the access failure |
| --- | --- |
| `WITH USER_MODE` query | `catch (QueryException e) { e.getInaccessibleFields(); }` - full set of access errors |
| `insert as user` | `catch (DmlException e) { e.getDmlFieldNames(0); }` - fields that violated FLS |
| `Database.insert(..., false, AccessLevel.USER_MODE)` | `SaveResult.getErrors()` then `Database.Error.getFields()` and `getStatusCode()` |
| `stripInaccessible` | `decision.getRemovedFields()` (map of object to field list), `decision.getModifiedIndexes()`, `record.isSet('Field__c')` |
| describe checks | your own branch; surface a user-facing message, do not swallow |

## 5. Canonical selector: user-mode read

```apex
public with sharing class ExpenseSelector {
    public class AccessDeniedException extends Exception {}

    public static List<Expense__c> byClient(Id clientId, Integer rowLimit) {
        try {
            return [
                SELECT Id, Name, Amount__c, Date__c, Reimbursed__c, Client__c
                FROM Expense__c
                WHERE Client__c = :clientId
                WITH USER_MODE
                ORDER BY Date__c DESC
                LIMIT :rowLimit
            ];
        } catch (QueryException e) {
            throw new AccessDeniedException(
                'Missing access to: ' + String.join(e.getInaccessibleFields(), ', '),
                e
            );
        }
    }
}
```

## 6. Canonical writer: partial-success user-mode DML

```apex
public with sharing class ExpenseWriter {
    public class SaveOutcome {
        public List<Id> savedIds = new List<Id>();
        public List<String> failures = new List<String>();
    }

    public static SaveOutcome save(List<Expense__c> expenses) {
        SaveOutcome outcome = new SaveOutcome();
        if (expenses == null || expenses.isEmpty()) {
            return outcome;
        }
        // allOrNone = false: keep the good rows, report the rest
        List<Database.UpsertResult> results = Database.upsert(
            expenses,
            Expense__c.Fields.External_Id__c,
            false,
            AccessLevel.USER_MODE
        );
        for (Integer i = 0; i < results.size(); i++) {
            Database.UpsertResult r = results[i];
            if (r.isSuccess()) {
                outcome.savedIds.add(r.getId());
            } else {
                for (Database.Error e : r.getErrors()) {
                    outcome.failures.add(
                        'row ' + i + ' ' + e.getStatusCode() + ' ' +
                        e.getMessage() + ' fields=' + e.getFields()
                    );
                }
            }
        }
        return outcome;
    }
}
```

## 7. `stripInaccessible` in the three shapes that matter

### 7.1 Strip on read (graceful table rendering)

```apex
public with sharing class CampaignBudgetView {
    @AuraEnabled(cacheable=true)
    public static List<Campaign> budgets() {
        SObjectAccessDecision decision = Security.stripInaccessible(
            AccessType.READABLE,
            [SELECT Name, BudgetedCost, ActualCost FROM Campaign WITH SYSTEM_MODE LIMIT 200]
        );
        Set<String> removed = new Set<String>();
        if (decision.getRemovedFields().containsKey('Campaign')) {
            removed.addAll(decision.getRemovedFields().get('Campaign'));
        }
        if (removed.contains('BudgetedCost')) {
            // BudgetedCost is mandatory for this screen: fail loudly
            throw new AuraHandledException('You cannot view campaign budgets.');
        }
        return (List<Campaign>) decision.getRecords();
    }
}
```

### 7.2 Strip before DML (avoid exceptions on optional fields)

```apex
List<Account> incoming = new List<Account>{
    new Account(Name = 'Acme Corporation'),
    new Account(Name = 'Blaze Comics', Rating = 'Warm')
};
SObjectAccessDecision decision = Security.stripInaccessible(AccessType.CREATABLE, incoming);
insert as user decision.getRecords();      // Rating dropped for users without FLS on Rating
System.debug(decision.getRemovedFields().get('Account'));  // {Rating}
System.debug(decision.getModifiedIndexes());               // {1}
```

### 7.3 Sanitize untrusted deserialized payloads

```apex
@RestResource(urlMapping='/accounts/*')
global with sharing class AccountIngest {
    @HttpPost
    global static void ingest() {
        List<Account> parsed = (List<Account>) JSON.deserializeStrict(
            RestContext.request.requestBody.toString(),
            List<Account>.class
        );
        SObjectAccessDecision decision = Security.stripInaccessible(AccessType.UPDATABLE, parsed);
        update as user decision.getRecords();
    }
}
```

Rules that apply to all three: `Id` is never stripped; `AggregateResult` throws; records come back in
input order; fields that were not queried come back unset rather than raising an exception; the
permission-set overload enforces access as per a supplied permission set in addition to the running
user's permissions.

## 8. Describe checks: the explicit path

```apex
public with sharing class OpportunityGuard {
    public static void assertCanCreateAmount() {
        Schema.DescribeSObjectResult oppDesc = Opportunity.SObjectType.getDescribe();
        Schema.DescribeFieldResult amountDesc = Opportunity.Amount.getDescribe();
        if (!oppDesc.isCreateable() || !amountDesc.isCreateable()) {
            throw new AuraHandledException('Insufficient access to create opportunity amounts.');
        }
    }

    public static Boolean canDelete() {
        // DELETE is object-level only: no field checks apply
        return Lead.SObjectType.getDescribe().isDeletable();
    }
}
```

| Method | Layer | Semantics |
| --- | --- | --- |
| `DescribeSObjectResult.isAccessible()` | object | user can read the object |
| `DescribeSObjectResult.isCreateable()` | object | user can create records |
| `DescribeSObjectResult.isUpdateable()` | object | user can edit records |
| `DescribeSObjectResult.isDeletable()` | object | user can delete records (CRUD only, no FLS) |
| `DescribeFieldResult.isAccessible()` | field | field readable |
| `DescribeFieldResult.isCreateable()` | field | field settable on insert |
| `DescribeFieldResult.isUpdateable()` | field | field settable on update |

`[unverified]` The Secure Coding Guide sample spells the delete check `isDeleteable()` while the Apex
Developer Guide narrative uses `isDeletable`. Treat them as the same check and keep whichever form
compiles in your org's API version.

Performance: describe calls are cheap individually but `Schema.getGlobalDescribe()` and
`Schema.describeSObjects()` are mass lookups; Graph Engine's `AvoidMultipleMassSchemaLookups` flags
repeated use in one path. Cache per transaction (see skill `sf-governor-limits`).

## 9. Elevating a user-mode operation with a permission set (Developer Preview)

```apex
Id permissionSetId = [SELECT Id FROM PermissionSet WHERE Name = 'AllowCreateToAccount' LIMIT 1].Id;
Database.insert(
    new Account(Name = 'foo'),
    AccessLevel.USER_MODE.withPermissionSetId(permissionSetId)
);
```

The elevation applies only to that operation and is not persisted to subsequent operations. Documented
as Developer Preview in the Apex Developer Guide; the AppExchange Checkmarx scanner is not yet aware
of it and can produce false positives on FLS rules. Do not rely on it for delivery code until it is
GA; prefer a documented `WITH SYSTEM_MODE` boundary with a narrow selector class.

## 10. Choosing between throw and degrade

| Situation | Choice |
| --- | --- |
| Field is required to make the screen meaningful | user mode, let `QueryException` propagate, map to `AuraHandledException` with a safe message |
| Field is decorative or optional | `stripInaccessible` + hide the column |
| Bulk ingest where partial success is acceptable | `Database.*` with `allOrNone=false` + `AccessLevel.USER_MODE`, report per-row errors |
| Platform-owned aggregation that must see all rows (roll-ups, recalculations) | `WITH SYSTEM_MODE` in a narrow `without sharing` selector, with a comment and a test |
| Guest/Experience Cloud user flows | user mode plus explicit describe checks; personal-information visibility settings for the User object are **not** enforced by user mode or `stripInaccessible` |

Automated Process users cannot perform object and FLS checks in custom code unless the appropriate
permission sets are explicitly assigned to those users.

## 11. Proving enforcement with tests

```apex
@IsTest
private class ExpenseSelectorTest {
    private static User minimumAccessUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        User u = new User(
            Alias = 'minacc',
            Email = 'vf-minimum@example.invalid',
            EmailEncodingKey = 'UTF-8',
            LastName = 'Minimum',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            ProfileId = p.Id,
            TimeZoneSidKey = 'America/Los_Angeles',
            UserName = 'vf-minimum-' + DateTime.now().getTime() + '@example.invalid'
        );
        insert u;
        return u;
    }

    @IsTest
    static void readWithoutAccessIsRejected() {
        User u = minimumAccessUser();
        System.runAs(u) {
            try {
                ExpenseSelector.byClient(null, 1);
                Assert.fail('Expected an access failure for a minimum-access user');
            } catch (ExpenseSelector.AccessDeniedException e) {
                Assert.isTrue(
                    e.getMessage().containsIgnoreCase('access'),
                    'Message should name the missing access: ' + e.getMessage()
                );
            }
        }
    }

    @IsTest
    static void readWithPermissionSetSucceeds() {
        User u = minimumAccessUser();
        PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'Expense_App_User' LIMIT 1];
        insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
        System.runAs(u) {
            Assert.areEqual(0, ExpenseSelector.byClient(null, 1).size(), 'No data, but no exception');
        }
    }

    @IsTest
    static void strippedWriteDropsInaccessibleField() {
        User u = minimumAccessUser();
        PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'Expense_App_User' LIMIT 1];
        insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
        System.runAs(u) {
            SObjectAccessDecision d = Security.stripInaccessible(
                AccessType.CREATABLE,
                new List<Expense__c>{ new Expense__c(Name = 'x', Internal_Cost__c = 10) }
            );
            Assert.isTrue(
                d.getRemovedFields().containsKey('Expense__c'),
                'Internal_Cost__c is not creatable for this persona'
            );
        }
    }
}
```

Test conventions, `@TestSetup` usage, and coverage gates: skill `sf-apex-testing`. `System.runAs`
changes the user context for record access and FLS; it does not reset governor limits and does not
apply to `@future` callbacks.

## 12. Review and gate mapping

| Requirement | Detecting rule / check |
| --- | --- |
| DML/SOQL without CRUD/FLS enforcement | `pmd:ApexCRUDViolation`, `sfge:ApexFlsViolation` |
| Class with data access and no sharing declaration | `pmd:ApexSharingViolations`, `sfge:DatabaseOperationsMustUseWithSharing` |
| Untrusted variable in dynamic query | `pmd:ApexSOQLInjection` |
| Hardcoded credentials in a callout | `pmd:ApexSuggestUsingNamedCred` |
| Non-HTTPS endpoint | `pmd:ApexInsecureEndpoint` |
| Whole local gate | `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local` |
| Org-side proof | `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-dev` |

Graph Engine treats these as sanitizers for `ApexFlsViolation`: `Schema.DescribeSObjectResult`
checks (acceptable for DELETE, UNDELETE, MERGE), `Schema.DescribeFieldResult` checks (acceptable for
READ, INSERT, UPDATE, UPSERT), lists filtered through `Security.stripInaccessible`, queries using
`WITH USER_MODE`, and queries using `WITH SECURITY_ENFORCED` (the latter only exists in pre-67.0
code, since the clause is not allowed in Apex at API 67.0 and later). If your enforcement is none of these,
Graph Engine reports a violation even when the code is safe: restructure the code rather than
suppressing, and if suppression is unavoidable, record the reason in `code-analyzer.yml`
(`references/config-templates.md` in skill `sf-code-analyzer-quality`).
