# Consuming Data Cloud from Apex, LWC and Flow

The `sfsqlquery` class reference, the Apex security model for data model objects, the Apex bridge
that feeds a Lightning web component, the Flow invocable actions, and the three test-mocking
frameworks.

## 1. The `sfsqlquery` namespace

Six classes, three workflows.

| Class | Role |
| --- | --- |
| `SqlStatement` | Encapsulates the query inputs. Build from a SQL string or a `ConnectApi.QuerySqlInput` |
| `SqlRowIterator` | Synchronous iterator. Implements `Iterator<Row>` and `Iterable<Row>` |
| `Row` | One result row with typed accessors by column name or 0-based index |
| `QueryHandle` | Runtime execution state; resumes a query from a saved query id |
| `SqlQueueable` | Abstract base for asynchronous chained processing. Implements `Queueable` and `Database.AllowsCallouts` |
| `SqlTester` | Test-context mocking |

| Workflow | Chain |
| --- | --- |
| New query, synchronous | `SqlStatement` -> `SqlRowIterator` -> `Row` |
| Resume a submitted query | `QueryHandle` -> `SqlRowIterator` -> `Row` |
| Large dataset, asynchronous | `SqlQueueable` -> `SqlRowIterator` -> `Row` |

### `SqlStatement`

| Member | Signature |
| --- | --- |
| `create(sql, dataspace)` | `public static sfsqlquery.SqlStatement create(String sql, String dataspace)` |
| `create(query, dataspace)` | `public static sfsqlquery.SqlStatement create(ConnectApi.QuerySqlInput query, String dataspace)` |
| `withWorkloadName(name)` | Returns the same instance for chaining |
| `execute()` | `public sfsqlquery.SqlRowIterator execute()` - equivalent to `new SqlRowIterator(statement)` |
| `toString()` | String representation |

Use the `ConnectApi.QuerySqlInput` overload when the query needs more than a string: parameterised
queries, a server-side row limit, or custom query settings. Keep the class name and `.create()` on
the same line when chaining. If no workload name is set the framework uses
`dcsql_row_iterator_workload` for iterators and `dcsql_queueable_workload` for queueables; a
meaningful name helps Salesforce Support trace a query and lets you separate interactive from batch
traffic.

```apex
// High-priority user-facing query
sfsqlquery.SqlRowIterator userQuery = sfsqlquery.SqlStatement.create(
        'SELECT * FROM accounts__dlm WHERE Region__c = \'West\'', 'default')
    .withWorkloadName('salescloud-userdashboard')
    .execute();

// Background batch processing query
sfsqlquery.SqlStatement batchStmt = sfsqlquery.SqlStatement.create(
        'SELECT * FROM accounts__dlm', 'default')
    .withWorkloadName('marketing-nightlybatch');
System.enqueueJob(new MyBatchJob(batchStmt));
```

### `SqlRowIterator`

Constructors take a `SqlStatement` or a `QueryHandle`. Methods: `cancel()`, `getColumnNames()`,
`getMetadata()`, `getQueryId()`, `hasNext()`, `iterator()`, `next()`, `toString()`.

Behaviour worth internalising:

- The query is not submitted until iteration begins, or until `getQueryId()` is called.
- The iterator is **single-use**. Consuming all rows and iterating again does not restart it.
- `cancel()` releases server-side resources; every later `hasNext()` returns `false`.
- Use it only for result sets that fit inside one transaction's governor limits. Anything larger goes
  to `SqlQueueable`.

```apex
sfsqlquery.SqlRowIterator iterator = sfsqlquery.SqlStatement.create(
        'SELECT Id__c, Amount__c FROM accounts__dlm', 'default')
    .execute();

Decimal totalAmount = 0;
for (sfsqlquery.Row row : iterator) {
    Decimal amount = row.getDecimal('Amount__c');
    if (amount != null) {
        totalAmount += amount;
        if (totalAmount > 1000000) {
            iterator.cancel();
            break;
        }
    }
}
```

### `Row`

Typed accessors, each available by column name or by 0-based column index: `getBoolean`, `getDate`,
`getDateTime`, `getDecimal`, `getDouble`, `getInteger`, `getList`, `getLong`, `getObject`,
`getString`, `getTime`, plus `getColumnIndex` and `getRawRow`. `Row` instances are produced by
`SqlRowIterator` and `SqlQueueable`; you do not construct them.

### `QueryHandle`

`create(queryId, dataspace)`, `withOffset(offset)`, `withWorkloadName(name)`, `toString()`. It
exposes no getters - query id, data space, workload name, offset and lifecycle flags are managed by
the iterator and the queueable. Read the id with `SqlRowIterator.getQueryId()` or
`SqlQueueable.getQueryId()`.

```apex
// A previous transaction processed 500 rows and stored the query id
sfsqlquery.QueryHandle handle = sfsqlquery.QueryHandle.create(savedQueryId, 'default')
    .withWorkloadName('my_workload')
    .withOffset(500);

sfsqlquery.SqlRowIterator iterator = new sfsqlquery.SqlRowIterator(handle);
while (iterator.hasNext()) {
    sfsqlquery.Row row = iterator.next();
    // continue from row 501
}
```

`withOffset` is not optional when resuming: without it the framework restarts from row 0 and you
reprocess everything.

### `SqlQueueable`

Abstract. Constructors take a `SqlStatement` (new query) or a `QueryHandle` (resume). Override
`processDataChunk()` and `chainNextJob(handle)`. The framework handles submission, status polling,
pagination and chaining.

| Method | Purpose |
| --- | --- |
| `processDataChunk()` | Abstract. Called with each page of results |
| `chainNextJob(handle)` | Abstract. Enqueue the next job, passing the handle to its constructor |
| `getRows()` | `Iterable<sfsqlquery.Row>` for the current page |
| `getPageOutput()` | Raw `ConnectApi.QuerySqlPageOutput` when you need the underlying response |
| `getColumnNames()` | Ordered column names for the current chunk |
| `getMetadata()` | `List<ConnectApi.QuerySqlMetadataItem>` with each column's name and data type |
| `getQueryId()` | Server-assigned query id; persist it to resume in a later job |
| `cancel()` | Cancels the query. Called inside `processDataChunk()`, the framework skips `chainNextJob()` |

```apex
public with sharing class MyQueryJob extends sfsqlquery.SqlQueueable {
    public MyQueryJob(sfsqlquery.SqlStatement stmt) { super(stmt); }
    public MyQueryJob(sfsqlquery.QueryHandle handle) { super(handle); }

    public override void processDataChunk() {
        for (sfsqlquery.Row row : getRows()) {
            System.debug(row.getString('Name__c'));
        }
    }

    public override void chainNextJob(sfsqlquery.QueryHandle handle) {
        System.enqueueJob(new MyQueryJob(handle));
    }
}

sfsqlquery.SqlStatement stmt = sfsqlquery.SqlStatement.create(
    'SELECT Id__c, Name__c FROM accounts__dlm', 'default');
System.enqueueJob(new MyQueryJob(stmt));
```

Dynamic column handling when the shape is not known at compile time:

```apex
public override void processDataChunk() {
    List<String> columns = getColumnNames();
    List<ConnectApi.QuerySqlMetadataItem> metadata = getMetadata();
    for (Integer i = 0; i < metadata.size(); i++) {
        System.debug(columns[i] + ' (' + metadata[i].type + ')');
    }
    for (sfsqlquery.Row row : getRows()) {
        for (String columnName : columns) {
            System.debug(columnName + ': ' + row.getObject(columnName));
        }
    }
}
```

Queueable chaining depth, enqueue limits and finalizers are skill `sf-async-apex-patterns`; the
per-transaction ceilings are skill `sf-governor-limits`.

## 2. SOQL against DMOs from Apex

Static SOQL is supported against DMOs as a more direct alternative to dynamic SOQL or ConnectApi.

| Construct | Support |
| --- | --- |
| Static SOQL | Supported |
| `Database.QueryLocator` and SOQL `for` loops | API 61.0 and later. Earlier versions return only the first 201 records |
| Batch Apex with a `QueryLocator` | Blocked |
| Batch Apex with an `Iterable` | Supported |
| Apex cursors | Supported; the performant alternative to Batch Apex for large result sets |

A static SOQL query against Data Cloud from Apex is **considered a callout** and carries the same
restrictions as an HTTP callout. Pending DML in the same transaction produces:

```text
UnexpectedException: A callout was unsuccessful because of pending uncommitted work
related to a process, flow, or Apex operation. Commit or roll back the work, and then try again.
```

```apex
// Fails: DML, then a DMO query in the same transaction.
insert new Account(Name = 'Test');
List<ssot_Account_dlm> dmo1 = [SELECT Id FROM ssot_Account_dlm];
```

Query first, or move the query into a `Queueable`.

```apex
List<UnifiedIndividual__dlm> unifiedIndividuals = [
    SELECT Id,
           ssot__FirstName__c,
           ssot__LastName__c,
           ssot__Email__c,
           ssot__SkyMilesBalance__c,
           ssot__MedallionStatus__c
    FROM UnifiedIndividual__dlm
    WHERE ssot__CompanyId__c = :companyId
];
```

## 3. Security model for DMOs

Read this before exposing a single Data Cloud field to a user.

| Control | Behaviour for DMOs |
| --- | --- |
| Object-level access | Read-only checks are supported if the user has access to the data space |
| Data space isolation from Apex | DMOs in **all** data spaces are accessible from Apex in system mode, even when a permission set for the data space is not explicitly assigned |
| Field-level security | Not supported |
| Record-level access control | Not supported |
| `WITH USER_MODE` describe calls | Can check only object-level access for DMOs |
| `Security.stripInaccessible()` | Can check only object-level access for DMOs |
| `Schema.getGlobalDescribe()` | Cannot discover exposed DMOs |
| `Schema.describeSObjects(List<String>)` | The supported discovery path, with known DMO API names |
| `SObjectType.getDescribe()` | Available for a specific DMO from API version 61.0. All DMO fields reached by field describes and security checks are read only, so there is no FLS to enforce |

Consequences:

1. `with sharing` on the Apex class does nothing for the DMO query. It still matters for anything
   else the class touches.
2. If a Data Cloud field must not reach a user, do not project it. Filter in the query, not in the
   component.
3. Any `@AuraEnabled` method returning DMO data is effectively a public read of that data for anyone
   who can reach the component. Gate the component, and shape the response DTO to the minimum.

CRM-side sharing, permission sets and FLS remain skill `sf-security-model`.

## 4. LWC: the Apex bridge

There is no Data Cloud-specific `@wire` adapter documented in the Lightning Web Components reference
`[unverified]`. The documented client path is an Apex method: Apex methods use the current user's
session context and permissions automatically, so the bridge is where the query and the shaping
belong.

```apex
public with sharing class SkyMilesForBusinessOptInController {
    @AuraEnabled(cacheable=true)
    public static List<SkyMilesMember> getSkyMilesProfilesFromDataCloud(String companyId) {
        List<UnifiedIndividual__dlm> unifiedIndividuals = [
            SELECT Id, ssot__FirstName__c, ssot__LastName__c, ssot__Email__c,
                   ssot__SkyMilesBalance__c, ssot__MedallionStatus__c, ssot__CompanyId__c
            FROM UnifiedIndividual__dlm
            WHERE ssot__CompanyId__c = :companyId
        ];

        List<SkyMilesMember> members = new List<SkyMilesMember>();
        for (UnifiedIndividual__dlm individual : unifiedIndividuals) {
            members.add(new SkyMilesMember(
                individual.Id,
                individual.ssot__FirstName__c,
                individual.ssot__LastName__c,
                individual.ssot__Email__c,
                individual.ssot__SkyMilesBalance__c,
                individual.ssot__MedallionStatus__c,
                individual.ssot__CompanyId__c
            ));
        }
        return members;
    }
}
```

```javascript
import { LightningElement, api, wire } from 'lwc';
import getMembers from '@salesforce/apex/SkyMilesForBusinessOptInController.getSkyMilesProfilesFromDataCloud';

export default class SkyMilesPanel extends LightningElement {
    @api companyId;
    members;
    error;

    @wire(getMembers, { companyId: '$companyId' })
    wiredMembers({ data, error }) {
        if (data) {
            this.members = data;
            this.error = undefined;
        } else if (error) {
            this.error = error;
            this.members = undefined;
        }
    }
}
```

Bridge rules:

| Rule | Reason |
| --- | --- |
| Return a DTO, never the raw DMO sObject | The DMO has no FLS; a DTO is the only place you control the projected shape |
| `cacheable=true` only for genuinely idempotent reads | Data Cloud queries consume credits; the Lightning Data Service cache is the cheapest possible saving |
| One query per component render, never one per row | See the row-by-row anti-pattern in the skill |
| Push long-running work behind a Queueable and a platform event | A wire adapter cannot wait for a multi-minute Data 360 query |
| Never `@AuraEnabled` a method that takes raw SQL from the client | It is an injection surface with no object-level protection behind it |

Component conventions, Jest coverage and the `vf-check jest` gate are skill `sf-lwc-development`.

## 5. Flow

### Invocable actions

Standard `InvocableActionType` values for `FlowActionCall`. These are the supported declarative
surface for Data Cloud.

| `actionType` | Does | Available from |
| --- | --- | --- |
| `cdpRunIdentityResolution` | Runs a Data Cloud identity resolution process | API 57.0 |
| `cdpPublishCalculatedInsight` | Runs the calculated insight | API 60.0 |
| `cdpPublishSegment` | Publishes a segment | API 60.0 |
| `cdpRefreshDataStream` | Refreshes a data stream | API 60.0 |
| `cdpValidateSegmentMember` | Validates a segment | API 60.0 |
| `cdpGetDataGraph` | Queries a data graph by data graph API name, data space name and record id | API 61.0 |
| `dataCloudIngestionApi` | Sends data to Data Cloud using the Ingestion API | API 61.0 |
| `cdpGetDataGraphByLookup` | Gets data graph data by API name, data space name and lookup key | API 63.0 |
| `cdpGetDataGraphMetadata` | Gets data graph metadata by API name and data space name; defaults the data space when omitted | API 64.0 |

The `Flow` metadata type also carries `areMetricsLoggedToDataCloud` (boolean, default `false`,
API 63.0 and later), which controls whether the flow's metrics are logged to Data Cloud.

Prefer a data graph action over a Flow loop that calls Apex per record: the graph is a precalculated
materialisation built for real-time single-record lookups, and the loop is the Flow spelling of the
row-by-row anti-pattern. Flow element budgets and bulkification are skill `sf-flow-automation`.

### Data actions

A data action sends an alert or event to a target when data changes in a DMO record or a calculated
insight. Supported targets: Salesforce Platform Event, webhook, and Marketing Cloud. For the platform
event target, Data Cloud sends the `DataObjectDataChgEvent` platform event, which a subscriber such
as a flow can receive and act on.

This is the only push mechanism Data Cloud offers into the org. There are no triggers on DMOs.
Subscriber patterns, retry semantics and `EventBus.RetryableException` are skill
`sf-integration-patterns`.

## 6. Testing

Three frameworks, one per query surface. All of them keep the tests offline, which is the point: a
test that hits a real Data Cloud tenant is slow, non-deterministic and billable.

### `sfsqlquery.SqlTester`

Detects the test context through `Test.isRunningTest()` and returns mocked responses when configured.
Provide column metadata and row data; the framework generates the submission and status responses.

| Method | Purpose |
| --- | --- |
| `clearMocks()` | Resets metadata, rows and page queues. Call at the start of every test method |
| `setMockMetadata(metadata)` | `List<ConnectApi.QuerySqlMetadataItem>` defining column names and types |
| `setMockRows(rows)` | A single page of `ConnectApi.QuerySqlRow` |
| `enqueueMockRows(rows)` | Adds one page; call repeatedly to simulate multi-page results, returned in enqueue order |
| `isRunningTest()` | Whether the framework is in a test context |

Calling `cancel()` in a test makes any later fetch against that query id raise an exception in the
mock layer, mirroring production cancellation.

```apex
@IsTest
static void testMultiPageQuery() {
    sfsqlquery.SqlTester.clearMocks();

    ConnectApi.QuerySqlMetadataItem col = new ConnectApi.QuerySqlMetadataItem();
    col.name = 'Name__c';
    col.type = ConnectApi.TypeEnum.VARCHAR;
    sfsqlquery.SqlTester.setMockMetadata(new List<ConnectApi.QuerySqlMetadataItem>{ col });

    ConnectApi.QuerySqlRow page1Row = new ConnectApi.QuerySqlRow();
    page1Row.rowData = new List<Object>{ 'Page 1 Data' };
    sfsqlquery.SqlTester.enqueueMockRows(new List<ConnectApi.QuerySqlRow>{ page1Row });

    ConnectApi.QuerySqlRow page2Row = new ConnectApi.QuerySqlRow();
    page2Row.rowData = new List<Object>{ 'Page 2 Data' };
    sfsqlquery.SqlTester.enqueueMockRows(new List<ConnectApi.QuerySqlRow>{ page2Row });

    Test.startTest();
    System.enqueueJob(new MyQueryJob(
        sfsqlquery.SqlStatement.create('SELECT Name__c FROM accounts__dlm', 'default')));
    Test.stopTest();
}
```

### SOQL stubs for DMOs

Extend `System.SoqlStubProvider`, override `handleSoqlQuery()`, build rows with
`Test.createStubQueryRow()` or `Test.createStubQueryRows()`, register with `Test.createSoqlStub()`,
and assert registration with `Test.isSoqlStubDefined()`.

```apex
@IsTest
public class SkyMilesForBusinessOptInController_Test {
    @IsTest
    public static void mockSoql() {
        SoqlStubProvider stub = new UnifiedIndividualSoqlStub();
        Test.createSoqlStub(UnifiedIndividual__dlm.sObjectType, stub);
        Assert.isTrue(Test.isSoqlStubDefined(UnifiedIndividual__dlm.sObjectType));

        Test.startTest();
        String companyId = 'SampleCompanyId';
        List<SkyMilesMember> members =
            SkyMilesForBusinessOptInController.getSkyMilesProfilesFromDataCloud(companyId);
        Test.stopTest();

        Assert.areEqual(1, members.size());
        Assert.areEqual(5000, members[0].SkyMilesBalance);
    }

    class UnifiedIndividualSoqlStub extends SoqlStubProvider {
        public override List<sObject> handleSoqlQuery(
                sObjectType sot, String stubbedQuery, Map<String, Object> bindVars) {
            Assert.areEqual(UnifiedIndividual__dlm.sObjectType, sot);
            String companyId = bindVars.containsKey('tmpVar1')
                ? (String) bindVars.get('tmpVar1')
                : 'Default';
            UnifiedIndividual__dlm dmo = (UnifiedIndividual__dlm) Test.createStubQueryRow(
                sot,
                new Map<String, Object>{
                    'ssot__FirstName__c' => 'Codey',
                    'ssot__LastName__c' => 'Bear',
                    'ssot__Email__c' => 'developer@salesforce.com',
                    'ssot__SkyMilesBalance__c' => 5000,
                    'ssot__MedallionStatus__c' => 'Gold',
                    'ssot__CompanyId__c' => companyId
                });
            return new List<sObject>{ dmo };
        }
    }
}
```

Constraints:

| Constraint | Detail |
| --- | --- |
| Governor limits | Apply to the stubbed records |
| Target | The SOQL query must be against a DMO or an external object, directly in the `FROM` clause or via a subquery |
| Wrong target | `Stubbed query invocations can't be used without a participating query stub set.` |
| Forbidden inside a stub | SOQL, SOSL, callouts, future methods, Queueable jobs, Batch jobs, DML, platform events |
| Bind variables | Arrive in `bindVars`; the first is `tmpVar1` |

### `ConnectApi` test methods

Connect in Apex methods run as the context user and do **not** support `runAs`. Most of them need
real org data and fail unless the test is marked `@IsTest(SeeAllData=true)`. Some are not permitted
to touch org data in tests and must be paired with a `setTest`-prefixed method that registers the
output to return; when a method needs one, its Usage section says so. The test method name is the
regular name with a `setTest` prefix, and its signature must match the overload you call - register
with a different parameter set and the real call throws.

Build the output object with its no-argument constructor, set the properties, call the `setTest`
method, then call the real method inside `Test.startTest()` / `Test.stopTest()`.

### Running the tests

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex \
  --target-org vf-dev --tests SkyMilesForBusinessOptInController_Test,MyQueryJobTest
```

Coverage thresholds, test-class pairing and the `vf-check pairing` gate are skill `sf-apex-testing`.

## Sources

- sfsqlquery Namespace - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_namespace_sfsqlquery.htm
- SqlStatement Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_sfsqlquery_SqlStatement.htm
- SqlRowIterator Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_sfsqlquery_SqlRowIterator.htm
- Row Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_sfsqlquery_Row.htm
- QueryHandle Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_sfsqlquery_QueryHandle.htm
- SqlQueueable Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_sfsqlquery_SqlQueueable.htm
- SqlTester Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_class_sfsqlquery_SqlTester.htm
- Data 360 In Apex - https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/DataCloudInApex.htm
- Mock SOQL Tests for Data 360 Data Model Objects - https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/MockSOQLTestsForDMOs.htm
- Testing ConnectApi Code - https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/connectAPI_TestingApex.htm
- Flow metadata type (InvocableActionType) - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm
- Custom App Development (data actions) - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/custom-app-dev.html
- Query Data 360 Data with Apex - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/dc-apex-query.html
