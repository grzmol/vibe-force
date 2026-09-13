# Query reference

Four ways to read Data Cloud, when each one applies, and the exact shapes. Sourced from the *Data 360
Query Guide*, the Apex Reference Guide and the REST API Developer Guide.

## 1. Pick a surface

| Surface | Use when | Access |
| --- | --- | --- |
| Connect REST API `ssot/query-sql` | Most integrations. Integrates with Platform capabilities and uses the ordinary Salesforce OAuth path | `POST/GET/DELETE /services/data/vXX.X/ssot/query-sql` |
| Data 360 API v3 (`/api/v3/query`) | Direct tenant access, ASYNC/ADAPTIVE modes, Arrow streaming, chunked retrieval | Tenant-specific `dne_cdpInstanceUrl` plus a Data Cloud token |
| `sfsqlquery` Apex namespace | Server-side code in the org. Recommended for all new Apex | Runs in the current user's session context |
| `ConnectApi.CdpQuery` Apex class | Lower-level mirror of the Connect REST endpoints; metadata, data graphs, profile, calculated insight, universal id lookup | Same context rules |
| SOQL | Simple single-object reads that fit the subset, and Apex code that wants typed sObjects | REST Query call or Apex |
| Object-specific APIs | Calculated insights, data graphs, unified individuals and accounts (Universal ID Lookup), profiles | Less error-prone than hand-rolled SQL; prefer them when one exists |

Salesforce's own guidance: whenever an object-specific API is available, use it instead of crafting
your own SQL.

## 2. Data 360 SQL essentials

Data 360 SQL supports joins, subqueries, window functions and aggregations. Calculated insight and
data transform definitions use a **different SQL dialect** - do not carry statements between them.

### Fully qualified keys

Records ingested from different sources can carry duplicate ids. The key qualifier `KQ_Id__c`
combined with the record id uniquely identifies a row; together `ssot__Id__c` and `KQ_Id__c` form the
fully qualified key. Perform all joins on both columns.

```sql
SELECT ssot__FirstName__c, ssot__LastName__c, ssot__Id__c, KQ_Id__c
FROM ssot__Individual__dlm
LIMIT 100
```

| `ssot__FirstName__c` | `ssot__LastName__c` | `ssot__Id__c` | `KQ_Id__c` |
| --- | --- | --- | --- |
| `Phyllis` | `Cotton` | `00QHu00003W7JIAMA3` | `CRM` |
| `John` | `Bond` | `003Hu00003SELnCIAX` | `CRM` |
| `Mike` | `Braund` | `00QHu00003W7JICMA3` | `CRM` |

### Joins

Inner, full outer, left outer and right outer joins are supported. Records with `NULL` key fields do
not match when joined with `=`; use `IS NOT DISTINCT FROM` for the key qualifier, which can be null
when key qualifiers are not configured on the data lake object fields.

```sql
SELECT i.ssot__Id__c, i.ssot__FirstName__c, i.ssot__LastName__c, e.ssot__EmailAddress__c
FROM ssot__Individual__dlm AS i
JOIN ssot__ContactPointEmail__dlm AS e
  ON  i.ssot__Id__c = e.ssot__PartyId__c
  AND i.KQ_Id__c IS NOT DISTINCT FROM e.KQ_Id__c
```

The `AS` keyword is optional. The `ssot__`-prefixed contact-point field names above
(`ssot__PartyId__c`, `ssot__EmailAddress__c`) depend on the namespace configuration in your org
`[unverified]`; the REST SOQL samples publish them unprefixed as `PartyId__c` and `EmailAddress__c`.
Resolve them from the metadata call in section 7 before hardcoding either form.

Unified DMOs have no `KQ_Id__c` because there are no duplicate record ids to disambiguate, so a
unified join needs only the business key:

```sql
SELECT u.FirstName__c, u.LastName__c, e.EmailAddress__c
FROM UnifiedIndividual__dlm u
JOIN UnifiedContactPointEmail__dlm e ON u.Id__c = e.PartyId__c
```

### Calculated insights

An insight exposes measures and dimensions; query it like any other object. For an insight counting
contact point addresses per unified individual, with measure `count1__c` and dimension `ind_id__c`:

| `count1__c` | `ind_id__c` |
| --- | --- |
| `1` | `8608b9f028a77452a4c434ec97ea96bd` |
| `2` | `864d017d1c4b3fe454cc5b8eab6420bc` |
| `1` | `903c9f06924bcb170bf3c896ead0656d` |

### Performance rules

| Rule | Why |
| --- | --- |
| Filter early with `WHERE` | Reduces data scanned, and scanning is what you pay for |
| Never `SELECT *` in production | Column projection is the cheapest optimisation available |
| Always `LIMIT` an exploratory query | A DMO can front billions of rows |
| Join on key qualifiers | Missing qualifiers turn an equi-join into a cross-source mess |
| Filter and join on an indexed field | Use the DMO's primary index, or create a secondary index for a non-primary field you filter or join on frequently |
| Pair `ORDER BY` with `LIMIT` when paging | Otherwise batch boundaries are not deterministic |
| Handle both response modes | Data 360 queries use synchronous and asynchronous responses; the client must cope with both |
| Re-read results rather than re-run | Results of a `createSqlQuery` are queryable for 24 hours without incurring more consumption charges, and `getSqlQueryRows` returns data faster than a fresh `createSqlQuery` |

## 3. Connect REST API: `ssot/query-sql`

Four resources. The Salesforce sample shows `v64.0`; use the `apiVersion` from
`config/vibe-force.defaults.json` (currently `67.0`) in this project.

| Operation | Method | Resource |
| --- | --- | --- |
| Submit SQL Query (`createSqlQuery`) | `POST` | `https://{dne_cdpInstanceUrl}/services/data/v64.0/ssot/query-sql` |
| Get SQL Query Status (`getSqlQuery`) | `GET` | `.../ssot/query-sql/{queryId}` |
| Get SQL Query Rows (`getSqlQueryRows`) | `GET` | `.../ssot/query-sql/{queryId}/rows` |
| Cancel SQL Query (`cancelSqlQuery`) | `DELETE` | `.../ssot/query-sql/{queryId}` |

Submit returns a query id for tracking and result retrieval. That `queryId` can also be passed to the
`result_scan` SQL function to query the cached results from a later statement. Paginate with `offset`
and `rowLimit` on `getSqlQueryRows`.

```bash
sf api request rest "/services/data/v67.0/ssot/query-sql" \
  --method POST --header 'Content-Type: application/json' \
  --body '{"sql":"SELECT ssot__Id__c, ssot__FirstName__c FROM ssot__Individual__dlm LIMIT 25"}' \
  --include --target-org vf-int
```

## 4. Data 360 API v3

The direct API. It needs the tenant-specific `dne_cdpInstanceUrl` and a Data Cloud access token, not
the org's My Domain URL. This is the recommended interface for new direct integrations.

| Operation | Method | URI |
| --- | --- | --- |
| Submit SQL Query | `POST` | `/api/v3/query` |
| Get SQL Query Status | `GET` | `/api/v3/query/{queryId}` |
| Get SQL Query Rows | `GET` | `/api/v3/query/{queryId}/rows` |
| Get SQL Query Chunks | `GET` | `/api/v3/query/{queryId}/chunks/{chunkId}` |
| Get SQL Query Metadata | `GET` | `/api/v3/query/{queryId}/metadata` |
| Cancel SQL Query | `DELETE` | `/api/v3/query/{queryId}` |

### Submit request fields

| Field | Type | Notes |
| --- | --- | --- |
| `sql` | string | Required |
| `transferMode` | string | `ASYNC` or `ADAPTIVE` (default) |
| `paramStyle` | string | `QUESTION_MARK` (default), `NAMED`, `DOLLAR_NUMBERED` |
| `parameters` | array | Each object needs a `type` (a Data 360 SQL type name such as `varchar`, `bigint`, `boolean`) and a `value` passed as a JSON string, even for numbers |
| `settings` | object | `timezone` (for example `Etc/UTC`), `language` (for example `de_DE`) |
| `resultRange` | object | ADAPTIVE only. `rowLimit`, `byteLimit` (default and maximum 20 MB) |
| `queryRowLimit` | integer | Implicit `LIMIT`; `0` returns schema only |

`type` takes SQL type names, not JSON type names - `varchar`, never `string`. For types with a length
or precision, include the field: `{ "type": "varchar", "length": 10, "value": "abc" }`.

### Modes

| Mode | Body on return | Next step |
| --- | --- | --- |
| `ASYNC` | `data` omitted, `returnedRows` always `0` | Read `queryId` from the `x-hyperdb-status` header, poll `GET /api/v3/query/{queryId}` |
| `ADAPTIVE` | `data` present if the query finished within the adaptive timeout; otherwise it mimics ASYNC | Same polling path when it times out |

`x-hyperdb-status` is a JSON-serialised string carrying `queryId`, `completionStatus`, `chunkCount`,
`rowCount`, `progress`, `expirationTime` and `executionStats`.

### Status response

| Field | Meaning |
| --- | --- |
| `completionStatus` | `RUNNING`, `RESULTS_PRODUCED` (complete but not yet durably stored), `FINISHED` (persisted; retrievable for the full expiration window) |
| `chunkCount` | Number of result chunks available |
| `rowCount` | Total rows in the result set |
| `progress` | Completion fraction, 0 to 1 |
| `expirationTime` | ISO 8601 timestamp when results expire |
| `executionStats` | `wallClockTime`, `rowsProcessed` |

`GET /api/v3/query/{queryId}` accepts `waitTimeMs`; the default and the maximum are both `10000`
(10 seconds), so a poll loop needs its own sleep, not a bigger wait.

### Retrieval

| Endpoint | Parameters | Notes |
| --- | --- | --- |
| `/rows` | `offset` (required), `limit`, `byteLimit` (default and max 20 MB / `20000000`), `omitSchema` | Offset-based pagination |
| `/chunks/{chunkId}` | `omitSchema` | `chunkId` starts at 0; use `chunkCount` from the status response. Streamed with `Transfer-Encoding: chunked`. Preferred for large result sets |

Set `Accept: application/vnd.apache.arrow.stream` for a binary Arrow IPC stream instead of JSON on
Submit, Rows, Chunks and Metadata. Arrow reduces payload size and deserialisation overhead;
`omitSchema` has no effect because the schema is embedded in the stream. Read it with PyArrow or the
Apache Arrow Java library.

### Errors

| Status | Meaning |
| --- | --- |
| `400` | Invalid SQL or request payload |
| `401` | Missing or invalid authentication |
| `403` | Authorization failed |
| `404` | Resource not found |
| `408` | Request timed out |
| `422` | Attribute name used in a fields or filter parameter does not exist |
| `429` | Rate limit exceeded. Rate limits are enforced per organization |
| `500` | Internal server error |

v3 error bodies carry SQLSTATE codes, human-readable detail, an `errorSource` of `"User"` or the
system, and a `position` field on syntax errors. The query services error body is
`error` / `errorCode` / `details`; branch on `errorCode`, never on the message text.

## 5. `ConnectApi.CdpQuery`

All methods are static, in the `ConnectApi` namespace. Every one has a `dataspace` overload; omit it
and the default data space is used.

### Query

| Method | API | Returns | Notes |
| --- | --- | --- | --- |
| `querySql(input)` | 62.0 | `ConnectApi.QuerySqlOutput` | Submits and retrieves the first chunk. Overloads add `dataspace` and `workloadName` |
| `querySqlStatus(queryId)` | 62.0 | `ConnectApi.QuerySqlStatus` | Overloads add `waitTimeMs`, `workloadName`, `dataspace`. Results available up to 24 hours |
| `querySqlRows(queryId, offset, rowLimit)` | 62.0 | `ConnectApi.QuerySqlPageOutput` | Overloads add `omitSchema`, `workloadName`, `dataspace`. Results available up to 24 hours |
| `cancelQuerySql(queryId)` | 62.0 | `Void` | Terminates a long-running query to free resources |
| `queryAnsiSqlV2(input)` | - | `ConnectApi.CdpQueryOutputV2` | Paired with `nextBatchAnsiSqlV2(nextBatchId)` |
| `queryANSISql(input)` | 52.0 | `ConnectApi.CdpQueryOutput` | Returns up to **49,999 rows**. Salesforce recommends `queryAnsiSqlV2` instead |
| `queryANSISql(input, batchSize, offset, orderby)` | 53.0 | `ConnectApi.CdpQueryOutput` | `batchSize` 1-49999, default 49999. `offset` default 0; `offset + batchSize` must be under 2147483647 |

### Metadata, profile, insights, data graphs

| Method | API | Purpose |
| --- | --- | --- |
| `getAllMetadata()` and filtered overloads | - | All metadata including calculated insights, engagement, profile objects and their relationships |
| `getMetadataEntities(entityCategory, entityType[, dataspace])` | - | Essential fields only; built for scale |
| `getProfileMetadata([dataModelName][, dataspace])` | - | Profile-category DMOs such as Individual, Contact Point Email, Unified Individual, Contact Point Address, with fields, data types and available indexes |
| `getInsightsMetadata([ciName][, dataspace])` | - | Calculated insight dimensions and measures |
| `queryCalculatedInsights(ciName, dimensions, measures, orderby, filters, batchSize, offset[, timeGranularity][, dataspace])` | - | Query a calculated insight object |
| `queryProfileApi(dataModelName, ...)` | - | Query a profile DMO, optionally with a child object or a calculated insight |
| `getDataGraphData(dataGraphEntityName, id[, dataspace][, live])` | 59.0 | Matches `id` against the primary key field of the data graph's primary DMO. Real-time graphs fall back to the standard graph when unavailable |
| `getDataGraphDataWithLookupKeys(dataGraphEntityName, lookupKeys[, dataspace][, noCache])` | - | Look up by the primary key of the primary DMO or the Individual linked DMO |
| `getDataGraphMetadata([dataGraphEntityName][, dataspace])` | - | Metadata for standard and real-time data graphs |
| `universalIdLookupBySourceId(entityName, dataSourceId, dataSourceObjectId, sourceRecordId[, dataspace])` | 54.0 | Look up objects by source id |

Connect API in Apex covers a **subset** of the Connect REST resources: query, calculated insights,
identity resolution rulesets, segments and metadata. Profiles and universal id lookups are documented
as unavailable through Connect API in Apex even though `CdpQuery` exposes `queryProfileApi` and
`universalIdLookupBySourceId` - verify behaviour in your org before designing around either.

### Submit, poll, page

```apex
ConnectApi.QuerySqlInput query = new ConnectApi.QuerySqlInput();
query.sql = 'SELECT street_address__c FROM test__dll limit 200000';

Integer numProcessed = 0;
ConnectApi.QuerySqlOutput queryOutput =
    ConnectApi.CdpQuery.querySql(query, 'sample_workload', 'default');
ConnectApi.QuerySqlStatus status = queryOutput.status;

while (status.completionStatus != ConnectApi.QuerySqlStatusEnum.FINISHED
       || numProcessed < status.rowCount) {
    if (status.rowCount > numProcessed) {
        ConnectApi.QuerySqlPageOutput pageOutput = ConnectApi.CdpQuery.querySqlRows(
            status.queryId, numProcessed, 10000, 'sample_workload', 'default');
        for (ConnectApi.QuerySqlRow rowObj : pageOutput.dataRows) {
            String streetAddress = (String) rowObj.row[0];
            // process
        }
        numProcessed += pageOutput.dataRows.size();
    }
    if (status.completionStatus != ConnectApi.QuerySqlStatusEnum.FINISHED) {
        status = ConnectApi.CdpQuery.querySqlStatus(status.queryId, 'sample_workload', 'default');
    }
}
```

A `queryId` looks like `MTAuMjMuMTU2LjIwODo3NDg0_49169cf8-a6f4-738f-6544-c3a7ba2ff548`. Apex has no
`Thread.sleep()`, so a synchronous poll loop burns CPU time; move anything that can run long into
`sfsqlquery.SqlQueueable` (see `apex-lwc-flow.md`).

## 6. The SOQL subset

Supported from API version 51.0 against the Unified Profile, Data Source objects and Data Model
objects, through the REST Query call or Apex.

| Supported | Not supported |
| --- | --- |
| `SELECT` on a single object | Subqueries |
| `count()` in the `SELECT` clause | Aggregate functions in the `SELECT` clause |
| `WHERE` with operators, and `LIKE` | Date functions in the `SELECT` clause |
| `LIMIT` - default 100, maximum 2,000 records per call | `HAVING` |
| `OFFSET` | Parent-child relationship traversal |
| `ORDER BY` | The `*` wildcard (use `FIELDS(ALL)` or name the fields) |

Worked queries reproduced verbatim from the REST API guide. The guide renders the clause as
`LIMIT =100`; standard SOQL is `LIMIT 100`, and that is what the runnable examples elsewhere in this
skill use. The object, field and value names below are the ones Salesforce publishes.

```sql
-- Data preview on a data lake object
SELECT SubscriberKey__c, EngagementChannel__c, EmailName__c, SubjectLine__c
FROM sfmc_email_engagement_click_{EID}__dll
LIMIT =100

-- Consent lookup: Individual ids by email, phone, or name
SELECT PartyId__c FROM ContactPointEmail__dlm WHERE EmailAddress__c='jjones@email.com' LIMIT =100
SELECT PartyId__c FROM ContactPointPhone__dlm WHERE TelephoneNumber__c='555-123-4567' LIMIT =100
SELECT IndividualId__c FROM Individual__dlm WHERE FirstName__c='Jimmy' AND LastName__c='Smith' LIMIT =100

-- Unified profile lookup, three hops
SELECT UnifiedRecordId__c FROM IndividualIdentityLink__dlm WHERE SourceRecordID__c='{sourceID}' LIMIT =100
SELECT FirstName__c, LastName__c FROM UnifiedIndividual__dlm WHERE Id__c='{UnifiedRecordId__c}' LIMIT =100
SELECT EmailAddress__c FROM UnifiedContactPointEmail__dlm WHERE PartyId__c={UnifiedRecordId__c} LIMIT =100
```

From the CLI:

```bash
sf data query \
  --query "SELECT Id__c, FirstName__c, LastName__c FROM UnifiedIndividual__dlm LIMIT 10" \
  --target-org vf-int
```

Selectivity, index behaviour and the cost of a non-selective filter are skill
`sf-soql-sosl-optimization`; the reasoning transfers, the syntax does not.

## 7. Discovering the schema

Never guess an object or field name. Ask the org.

```apex
// Every profile-category DMO with its fields, data types and available indexes
ConnectApi.CdpQueryMetadataOutput profile = ConnectApi.CdpQuery.getProfileMetadata();
System.debug(JSON.serializePretty(profile));

// Narrow to one entity category and type without pulling the whole model
ConnectApi.CdpQueryMetadataEntitiesOutput entities =
    ConnectApi.CdpQuery.getMetadataEntities('Profile', 'DataModelObject', 'default');
```

From Apex describe calls: `Schema.getGlobalDescribe()` cannot discover exposed DMOs. Use
`Schema.describeSObjects(List<String>)` with the known DMO API names, or `SObjectType.getDescribe()`
for a specific DMO from API version 61.0.

## 8. Query cost and consumption

Running SOQL queries against DMOs can consume Data Services credits from the Data Cloud
subscription. The documented warning names `FOR` loops, query locators, recursion and any mechanism
that produces multiple queries. Two consequences for design:

1. Never put a Data Cloud query inside a loop over ids, a trigger handler, or a per-row Apex method.
2. Prefer re-reading a stored result. Results of a submitted query are retrievable for 24 hours
   without further consumption charges, and `getSqlQueryRows` is faster than resubmitting.

## Sources

- Query Data in Data 360 - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/query-guide-get-started.html
- Data 360 SQL Query APIs - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/dc-sql-query-apis.html
- Query Data 360 Data using Query API - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-queryservices-overview.html
- Submit SQL Query (v3) - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/query-api-v3-post.html
- Get SQL Query Status (v3) - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/query-api-v3-get-query.html
- Get SQL Query Rows (v3) - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/query-api-v3-get-rows.html
- Get SQL Query Chunks (v3) - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/query-api-v3-get-chunk.html
- Query Services Status Codes - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-queryservices-statuscodes.html
- Write a Simple Query - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/write-simple-query.html
- Join Records from Different DMOs and DLOs - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/query-joins.html
- Using SOQL to Query Data in Data 360 - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/dc-soql.html
- Data Cloud Query Profile Parameters - https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_cdp_query.htm
- ConnectApi.CdpQuery Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_ConnectAPI_CdpQuery_static_methods.htm
- Data 360 In Apex - https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/DataCloudInApex.htm
- Data 360 Object-Specific APIs - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/obj-specific-apis.html
- Custom App Development - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/custom-app-dev.html
