# Apex Language Reference Tables

Lookup tables for annotations, access modifiers, sharing and access-mode combinations, trigger
context variables, exception APIs, and the System classes used most often in `vibe-force` work.
Every value comes from the Apex Developer Guide (Winter '27 / API 68.0) or the Apex Reference Guide
(Summer '26 / API 67.0). Project target is `apiVersion` `67.0`.

## Annotations

| Annotation | Level | Purpose | Key constraint |
| --- | --- | --- | --- |
| `@AuraEnabled` | method, property | exposes Apex to Aura components and Lightning web components | only annotated members are exposed; overloads prohibited from API 55.0 |
| `@AuraEnabled(cacheable=true)` | method | client-side caching of the result (API 44.0+) | method must not modify data; required for `@wire` |
| `@AuraEnabled(cacheable=true scope='global')` | method | caching in the global cache (API 55.0+) | read-only as above |
| `@Deprecated` | method, class, exception, enum, interface, variable | hides an element from new managed-package subscribers | prohibited in unmanaged packages; cannot be removed once released; `webservice` members cannot be deprecated |
| `@Future` | static method | runs asynchronously | `void` return; primitives only; cannot be called from another `@Future` method; Salesforce recommends Queueable instead |
| `@Future(callout=true)` | static method | allows callouts from the future method | — |
| `@InvocableMethod` | static method | exposes Apex as an invocable action for Flow, REST, Agentforce | one per class; running user needs Apex class security |
| `@InvocableVariable` | variable | marks input/output variables of an invocable method's request/response class | — |
| `@IsTest` | class, method | marks test code; excluded from the 6 MB org code limit and from coverage | test classes must be top-level; cannot be interfaces or enums |
| `@IsTest(SeeAllData=true)` | class, method | grants access to org data | class-level `true` cannot be overridden by method-level `false`; incompatible with `IsParallel=true` |
| `@IsTest(IsParallel=true)` | class | allows the class to run beyond the default concurrency | incompatible with `SeeAllData=true` |
| `@JsonAccess` | class | controls whether instances may be serialised/deserialised | violation throws `JSONException` at run time |
| `@NamespaceAccessible` | class, method, variable, constructor | exposes 2GP package members to other packages in the same namespace | — |
| `@ReadOnly` | method | relaxes the query-row limit for read-only contexts | must be the outermost entry point |
| `@RemoteAction` | static method | Visualforce JavaScript remoting | legacy surface |
| `@SuppressWarnings` | class, method | no runtime effect; a hint for third-party tools | does not silence `sf code-analyzer` by itself |
| `@TestSetup` | static method | creates records shared by every test method in the class | unsupported when the class uses `SeeAllData=true`; changes roll back after each test method |
| `@TestVisible` | private/protected member | lets tests read and write otherwise inaccessible members | test-context only |
| `@RestResource(urlMapping='/x')` | class | exposes the class at `/services/apexrest/x` | class must be `global`; mapping is case sensitive |
| `@HttpGet`, `@HttpPost`, `@HttpPut`, `@HttpPatch`, `@HttpDelete` | static method | binds an HTTP verb | methods must be `global static` |
| `@IntegrationTest`, `@BeforeClass`, `@TearDown` | class, method | Apex integration tests | Developer Preview, scratch orgs only, API 67.0+; cannot be mixed with `@IsTest` on one class |

Multiple annotations are allowed on the same class or method, each on its own line immediately
before the declaration.

## Access modifiers

| Modifier | Visible to | Use for |
| --- | --- | --- |
| `private` | the declaring class only (Apex default) | implementation detail; add `@TestVisible` for tests |
| `protected` | the declaring class and its subclasses | framework extension points |
| `public` | any Apex in the same namespace | the normal API of a class in your org |
| `global` | any Apex in any namespace, and required for Apex REST, `webservice` methods, and managed-package APIs | only when genuinely required — `global` is a permanent commitment in a managed package |

| Class/method keyword | Meaning |
| --- | --- |
| `virtual` | may be overridden by a subclass |
| `abstract` | must be implemented by a subclass; class cannot be instantiated |
| `override` | required when replacing a `virtual` or `abstract` member |
| `static` | class-level; no `this`; not stubbable by the Stub API |
| `final` | value assigned once; use for constants and immutable collaborators |
| `transient` | excluded from view state and from serialisation |
| `webservice` | SOAP endpoint; requires `global`; cannot be deprecated |
| `testMethod` | legacy alias for `@IsTest` on a method; may be versioned out — use `@IsTest` |

## Sharing and access-mode matrix

Two orthogonal axes. The sharing keyword controls **record** visibility; the access mode controls
**object and field** permissions.

| Class declaration | Record sharing enforced | Notes |
| --- | --- | --- |
| `with sharing` | yes | recommended default; applies to initialisation code, constructors, and methods |
| `without sharing` | no | can read records the user cannot otherwise access; reserve for deliberate elevation |
| `inherited sharing` | decided at run time | runs `with sharing` at every entry point; runs `without sharing` only when explicitly called from an established `without sharing` context |
| omitted, API 67.0+ | yes — `with sharing` | if the class extends a parent, it adopts the parent's mode |
| omitted, API 66.0 and earlier | depends | `with sharing` if any class in the inheritance chain is API 67.0+, if it is an Aura controller, or if it is an `@AuraEnabled` method called from LWC; otherwise `without sharing`; a non-entry-point class takes the caller's mode |
| trigger | no — always `without sharing` | triggers cannot carry a sharing declaration |

| Access mode syntax | Applies to | Effect |
| --- | --- | --- |
| `WITH USER_MODE` | SOQL, SOSL | enforces FLS and object permissions; processes all clauses including `WHERE`; supports polymorphic fields (`Owner`, `Task.whatId`); reports the full error set via `QueryException.getInaccessibleFields()` |
| `WITH SYSTEM_MODE` | SOQL, SOSL | bypasses FLS and object permissions; record sharing still governed by the class's sharing keyword |
| `as user` | `insert`, `update`, `upsert`, `merge`, `delete`, `undelete` statements | enforces FLS and object permissions; `DmlException.getDmlFieldNames()` reports offending fields |
| `as system` | the same DML statements | bypasses FLS and object permissions |
| `AccessLevel.USER_MODE` | `Database.*` and `Search.*` methods | as above; `SaveResult.getErrors().getFields()` reports offending fields |
| `AccessLevel.SYSTEM_MODE` | the same methods | bypasses FLS and object permissions |
| `AccessLevel.withPermissionSetId(id)` | user-mode DML and search | augments the running user's permissions with a named permission set — **Developer Preview** |
| default, API 67.0+ | all of the above | user mode |
| default, API 66.0 and earlier | all of the above | system mode |
| `WITH SECURITY_ENFORCED` | SOQL — **legacy only** | **Rejected in Apex SOQL from API 67.0.** Pre-67.0 it enforced object and field permissions at the whole-query level, failing on the first inaccessible field and ignoring `WHERE`-clause fields and polymorphic relationships. Replace with `WITH USER_MODE`, `AccessLevel.USER_MODE`, or `Database.query(q, AccessLevel.USER_MODE)` |

`accessLevel` is **optional** on `Database.query`, `Database.getQueryLocator`,
`Database.countQuery`, `Database.getCursor`, `Database.getPaginationCursor`, `Search.query`, and the
`Database` DML methods (including `insertImmediate`, `deleteAsync`, and friends). It is **required**
on `Database.queryWithBinds`, `Database.getQueryLocatorWithBinds`, `Database.countQueryWithBinds`,
`Database.getCursorWithBinds`, and `Database.getPaginationCursorWithBinds` — which is why bind-map
queries are the safest dynamic-SOQL primitive.

Do not copy `WITH SECURITY_ENFORCED` out of older official samples — several LWC and security guide
pages still show it because they target a pre-67.0 API version. At the project target of `67.0` it
will not compile in Apex, and its semantics were strictly weaker than user mode: it skipped
`WHERE`-clause fields, did not support polymorphic fields, and surfaced only the first access error
rather than the full set available from `QueryException.getInaccessibleFields()`.

Setting a DML operation to user mode always respects the user's sharing rules. Setting it to system
mode leaves record access to the calling class's sharing keyword.

Sharing declarations never enforce object-level or field-level access; conversely, object- and
field-level permissions take precedence over sharing rules when they conflict. Inner classes do not
inherit the outer class's sharing mode. Asynchronous classes declared `inherited sharing` always run
`with sharing` because each asynchronous execution is a new entry point. Anonymous Apex and Connect
in Apex always run `with sharing`. Experience Cloud personal-information visibility settings are
**not** enforced by user mode or `stripInaccessible`. Automated Process users cannot perform object
and FLS checks unless permission sets are explicitly assigned.

## Trigger context variables

| Variable | Type | Availability |
| --- | --- | --- |
| `Trigger.isExecuting` | Boolean | true when the current context is a trigger, not a Visualforce page, web service, or `executeAnonymous` call |
| `Trigger.isInsert` | Boolean | insert from UI, Apex, or API |
| `Trigger.isUpdate` | Boolean | update from UI, Apex, or API |
| `Trigger.isDelete` | Boolean | delete from UI, Apex, or API |
| `Trigger.isBefore` | Boolean | fired before any record was saved |
| `Trigger.isAfter` | Boolean | fired after all records were saved |
| `Trigger.isUndelete` | Boolean | fired after a record is recovered from the Recycle Bin |
| `Trigger.new` | `List<SObject>` | insert, update, undelete; mutable only in before triggers |
| `Trigger.newMap` | `Map<Id, SObject>` | before update, after insert, after update, after undelete |
| `Trigger.old` | `List<SObject>` | update, delete; always read-only |
| `Trigger.oldMap` | `Map<Id, SObject>` | update, delete |
| `Trigger.operationType` | `System.TriggerOperation` | `BEFORE_INSERT`, `BEFORE_UPDATE`, `BEFORE_DELETE`, `AFTER_INSERT`, `AFTER_UPDATE`, `AFTER_DELETE`, `AFTER_UNDELETE` |
| `Trigger.size` | Integer | records in the **current batch** only, not the whole DML operation |

Constraints: `Trigger.new` and `Trigger.old` cannot be used in DML operations directly;
`Trigger.old` is always read-only; `Trigger.new` cannot be deleted. A record with an invalid field
value (for example a formula dividing by zero) reports `null` for that field in all four
collections. Mutation legality per event is tabulated in
[order-of-execution.md](order-of-execution.md).

## Exception APIs

| Method | Available on | Returns |
| --- | --- | --- |
| `getMessage()` | all exceptions | the user-facing error message |
| `getTypeName()` | all exceptions | e.g. `System.SObjectException`, `System.DmlException`, `System.ListException`, `System.MathException` |
| `getCause()` | all exceptions | the inner exception, or `null` |
| `getLineNumber()` | all exceptions | line where the exception was thrown |
| `getStackTraceString()` | all exceptions | stack trace as a string |
| `getNumDml()` | `DmlException` | number of failed records |
| `getDmlMessage(i)` | `DmlException` | message for failed record `i` |
| `getDmlFieldNames(i)` | `DmlException` | fields that caused the failure for record `i`; populated for FLS failures in user mode |
| `getDmlId(i)` | `DmlException` | Id of failed record `i` |
| `getDmlStatusCode(i)` | `DmlException` | API status code for record `i` |
| `getInaccessibleFields()` | `QueryException` | full set of FLS errors from a `WITH USER_MODE` query |

| Exception type | Typical trigger |
| --- | --- |
| `DmlException` | any failed DML statement |
| `QueryException` | zero or multiple rows assigned to a single sObject; FLS failure in user mode |
| `SObjectException` | reading a field that was not in the `SELECT` list |
| `NullPointerException` | dereferencing null; avoid with `?.` and `??` |
| `ListException` | index out of bounds |
| `MathException` | division by zero and similar |
| `TypeException` | invalid cast; rolling back to a released savepoint |
| `System.InvalidOperationException` | rollback attempted after `Database.releaseSavepoint()` |
| `CalloutException` | callout with uncommitted DML, or with unreleased savepoints |
| `JSONException` | self-referencing object graph; `@JsonAccess` violation; serialising an exception (API 63.0+) |
| `DuplicateMessageException` | enqueueing a Queueable with a signature already in the queue |
| `AuraHandledException` | the only exception whose message reaches an LWC without a stack trace |
| `System.LimitException` | **uncatchable** — a governor limit was exceeded |

Uncatchable exceptions also skip `finally` blocks. `System.LimitException`, failed
`System.assert`/`Assert` calls, and license exceptions are all uncatchable — never build recovery
logic around them. From API 41.0, unreachable statements are a compile error.

## System classes and methods used most

| Class | Members that matter | Note |
| --- | --- | --- |
| `Database` | `insert`, `update`, `upsert`, `merge`, `delete`, `undelete`, `convertLead`, `query`, `queryWithBinds`, `countQuery`, `getQueryLocator`, `setSavepoint`, `rollback`, `releaseSavepoint`, `emptyRecycleBin`, `executeBatch` | `setSavepoint` and `rollback` each cost one DML statement, zero DML rows |
| `Database.DMLOptions` | `optAllOrNone`, `allowFieldTruncation`, `assignmentRuleHeader`, `duplicateRuleHeader`, `emailHeader`, `localeOptions` | API 15.0+; affects Apex DML only, not the UI |
| `Limits` | `getQueries`/`getLimitQueries`, `getDmlStatements`/`getLimitDmlStatements`, `getCpuTime`/`getLimitCpuTime`, `getHeapSize`/`getLimitHeapSize`, `getQueryRows`, `getDmlRows`, `getCallouts`, `getQueueableJobs`, `getFutureCalls`, `getAggregateQueries`, `getSoslQueries` | every getter has a `getLimit*` twin; full table in `sf-governor-limits` |
| `OrgLimits` | `getAll()`, `getMap()`; `OrgLimit.getName()`, `getValue()`, `getLimit()` | 24-hour org allocations, not per-transaction |
| `Schema` | `getGlobalDescribe()`, `describeSObjects(names)`, `SObjectType.<Obj>.fields.getMap()` | cache results; never call in a loop |
| `Schema.DescribeSObjectResult` | `isCreateable()`, `isUpdateable()`, `isDeletable()`, `isAccessible()`, `getKeyPrefix()` | object-level permission checks |
| `Schema.DescribeFieldResult` | `isAccessible()`, `isCreateable()`, `isUpdateable()`, `isNillable()`, `getType()`, `getLength()` | field-level permission checks |
| `Security` | `stripInaccessible(accessType, records)` | strips unreadable fields and relationships; see `sf-security-model` |
| `JSON` | `serialize`, `serializePretty`, `deserialize`, `deserializeUntyped`, `deserializeStrict` | `JSONGenerator` and `JSONParser` for streaming; all throw `JSONException` |
| `UserInfo` | `getUserId`, `getProfileId`, `getUserType`, `getLocale`, `getTimeZone`, `getSessionId` | `getSessionId` is null in asynchronous contexts |
| `System` | `enqueueJob`, `schedule`, `runAs` (test only), `debug`, `now`, `today`, `currentPageReference` | `System.runAs` counts against the DML statement limit |
| `Test` | `startTest`, `stopTest`, `setMock`, `createStub`, `loadData`, `isRunningTest`, `getEventBus`, `enqueueBatchJobs`, `setCreatedDate`, `setFixedSearchResults` | test context only; see `sf-apex-testing` |
| `Cache.Org`, `Cache.Session` | `put`, `get`, `remove`, `contains`; `Cache.CacheBuilder` for miss-safe access | session cache expires at `ttlsecs` or the 8-hour session maximum, whichever is first |

## JSON serialisation rules

| Rule | Detail |
| --- | --- |
| Supported inputs | sObjects (standard and custom), Apex primitives and collections, `Database` result types such as `SaveResult` and `DeleteResult`, instances of your own classes |
| Managed packages | only custom-object sObject types can be serialised from outside the package; instances of the package's Apex classes cannot |
| Map keys | serialisable only for `Boolean`, `Date`, `DateTime`, `Decimal`, `Double`, `Enum`, `Id`, `Integer`, `Long`, `String`, `Time` |
| Polymorphism | an object declared as a parent type but holding a subtype instance is serialised as the parent; subtype-only fields are lost |
| Self-reference | throws `JSONException` |
| Shared references | a graph referencing the same object twice deserialises into multiple copies |
| `JSONParser` | not serialisable; keep it as a local variable, never a member of a serialisable class |
| Exceptions | from API 63.0, serialising a custom or built-in exception throws `Type unsupported in JSON: MyException` |
| DateTime | from API 53.0, more than three decimal digits are handled correctly; unsupported formats error |

```apex
public with sharing class PayloadCodec {
    public class Line {
        public String sku;
        public Integer quantity;
    }

    public static String encode(List<Line> lines) {
        return JSON.serialize(lines, true);   // suppressApexObjectNulls
    }

    public static List<Line> decode(String body) {
        try {
            return (List<Line>) JSON.deserialize(body, List<Line>.class);
        } catch (JSONException e) {
            throw new PayloadException('Malformed payload: ' + e.getMessage(), e);
        }
    }

    public class PayloadException extends Exception {}
}
```

## Naming and organisation conventions

| Artefact | Convention | Example |
| --- | --- | --- |
| Trigger | `<Object>Trigger` | `CaseTrigger` |
| Trigger handler | `<Object>TriggerHandler` | `CaseTriggerHandler` |
| Domain | `<Object>Domain` | `CaseDomain` |
| Selector | `<Object>Selector` | `CaseSelector` |
| Service | `<Capability>Service` | `CaseEscalationService` |
| LWC/Aura controller | `<Feature>Controller` | `CaseListController` |
| Apex REST resource | `<Resource>Rest` | `AccountRest` |
| Queueable | `<Work>Queueable` | `InvoiceSyncQueueable` |
| Batch | `<Work>Batch` | `AccountCleanupBatch` |
| Schedulable | `<Work>Schedule` | `NightlySyncSchedule` |
| Callout mock | `<Service>CalloutMock` | `PaymentsCalloutMock` |
| Test class | `<ClassUnderTest>Test` | `CaseEscalationServiceTest` |
| Test data factory | `TestDataFactory` or `<Object>TestFactory` | `CaseTestFactory` |
| Custom exception | `<Domain>Exception` | `OrderException` |
| Constant | `UPPER_SNAKE_CASE` `static final` | `MAX_RETRIES` |

Directory layout inside a package directory (see `sf-project-structure`):

```text
force-app/main/default/
  classes/
    framework/      TriggerHandler, TriggerContext, TriggerBypass, UnitOfWork, SObjectSelector
    domain/         <Object>Domain
    selector/       <Object>Selector
    service/        <Capability>Service
    controller/     <Feature>Controller
    async/          Queueable, Batch, Schedulable, Finalizer
    test/           TestDataFactory, TestIds, mocks
  triggers/         one <Object>Trigger per object
```

## Size limits that shape class design

| Limit | Value |
| --- | --- |
| Maximum characters in a class | 1,000,000 |
| Maximum characters in a trigger | 1,000,000 |
| Maximum code used by all Apex in an org | 6 MB (10 MB in scratch orgs); increasable via support case |
| Method size | 65,535 bytecode instructions compiled |
| Class and trigger code units in one Apex deployment | 7,500 |

`@IsTest` code and code in 1GP/2GP managed packages do not count toward the 6 MB org total, which
is why test utilities belong in `@IsTest`-annotated classes.

## Sources

| Topic | URL |
| --- | --- |
| Annotations index | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation.htm |
| `@AuraEnabled` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation_AuraEnabled.htm |
| `@IsTest` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation_isTest.htm |
| `@TestSetup` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation_testsetup.htm |
| `@TestVisible` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation_testvisible.htm |
| `@RestResource` and HTTP verb annotations | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotations_rest.htm |
| Sharing keywords | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_keywords_sharing.htm |
| Access mode for database operations | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_enforce_usermode.htm |
| Apex security and sharing | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_security.htm |
| Apex Security and Sharing Model, Versioned Behavior Changes (API 67.0 user-mode default; `WITH SECURITY_ENFORCED` removed) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_chapter.htm |
| `stripInaccessible` | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_with_security_stripInaccessible.htm |
| Trigger context variables | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_context_variables.htm |
| Exception statements and uncatchable exceptions | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_exception_statements.htm |
| Common exception methods | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_exception_methods.htm |
| JSON support | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_json_json.htm |
| Dynamic describe information | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dynamic_describe_objects_understanding.htm |
| Platform Cache | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_cache_namespace_overview.htm |
| `Limits` class | https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_methods_system_limits.htm |
| `OrgLimits` class | https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_System_OrgLimits.htm |
| Execution governors and limits (size limits) | https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm |
