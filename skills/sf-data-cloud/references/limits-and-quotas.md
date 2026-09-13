# Data Cloud limits and quotas

Every number here carries the page it came from. Nothing on this page is estimated, rounded or
recalled. Where a limit exists but the published figure could not be read in an official page during
research, the row says so rather than guessing.

Source keys used in the tables:

| Key | Page |
| --- | --- |
| `ING` | Get Started with Ingestion API - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.html |
| `BULK` | Bulk Ingestion - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.html |
| `UPL` | Upload Job Data - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-upload-job-data.html |
| `STRM` | Streaming Ingestion - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-streaming-ingestion.html |
| `DEL` | Delete Records - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-delete-records.html |
| `V3POST` | Submit SQL Query (v3) - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/query-api-v3-post.html |
| `V3GET` | Get SQL Query Status (v3) - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/query-api-v3-get-query.html |
| `V3ROWS` | Get SQL Query Rows (v3) - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/query-api-v3-get-rows.html |
| `QOVR` | Query Data 360 Data using Query API - https://developer.salesforce.com/docs/data/data-cloud-query-guide/references/data-cloud-query-api-reference/c360a-api-queryservices-overview.html |
| `CDPQ` | ConnectApi.CdpQuery Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_ConnectAPI_CdpQuery_static_methods.htm |
| `CDPCI` | ConnectApi.CdpCalculatedInsight Class - https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_ConnectAPI_CdpCalculatedInsight_static_methods.htm |
| `SOQL` | Data Cloud Query Profile Parameters - https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_cdp_query.htm |
| `APEX` | Data 360 In Apex - https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/DataCloudInApex.htm |
| `OBJ` | Salesforce Data Cloud Objects - https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_concepts_data_cloud_objects.htm |
| `ARCH` | Data 360 Architecture - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-architecture.html |

## 1. Bulk ingestion

| Limit | Value | Source |
| --- | --- | --- |
| Maximum payload size per CSV upload | 150 MB | `ING`, `BULK` |
| Maximum number of files per job | 100. One file at a time per bulk job | `ING`, `UPL` |
| Number of requests or jobs allowed per hour | 20 | `ING` |
| Number of concurrent requests or jobs at one time | 5 | `ING` |
| Bulk job retention | Open jobs in `Open` or `UploadComplete` older than 7 days are deleted from the ingestion queue | `ING` |
| CSV encoding | UTF-8 | `BULK` |
| CSV format | RFC 4180, comma delimiter only | `BULK` |
| Delete CSV shape | No header row, up to 2 columns: primary key, then optionally a record-version datetime greater than the original record | `UPL` |
| Update semantics | Full replace. Patch semantics are not supported | `BULK` |
| Empty field values | Set to null | `BULK` |
| Rate signalling | `HTTP 429 Too Many Requests` means reduce request frequency | `ING` |

## 2. Streaming ingestion

| Limit | Value | Source |
| --- | --- | --- |
| Maximum payload size per request | 200 KB of JSON per request | `ING` |
| Maximum records deleted per request | 200. Above that, use a bulk delete job | `ING`, `DEL` |
| Total requests per second across all Ingestion API object endpoints | 250 | `ING` |
| Expected latency | Data is processed asynchronously approximately every 3 minutes | `ING`, `STRM` |
| Payload field coverage | Every field defined in the schema must be present, whether or not Value Required is set. Send a blank value when there is no data | Create a Job / Synchronous Record Validation pages |
| Rate signalling | `HTTP 429 Too Many Requests` means reduce request frequency | `ING` |

## 3. Ingestion consistency

| Behaviour | Value | Source |
| --- | --- | --- |
| Post-ingest consistency window | Allow a minimum of 30 seconds after bulk or streaming ingest for internal caches to refresh before the data is queryable | `ING` |
| Delivery model | Ingestion API uses eventual consistency | `ING` |

Any automated check that ingests and then asserts must either sleep past this window or poll. Treat
30 seconds as the floor, not the expected value.

## 4. Query API v3

| Limit | Value | Source |
| --- | --- | --- |
| `resultRange.byteLimit` (ADAPTIVE) | Default and maximum 20 MB | `V3POST` |
| `byteLimit` on `GET /rows` | Default and maximum 20 MB (`20000000`) | `V3ROWS` |
| `waitTimeMs` on `GET /{queryId}` | Default and maximum 10000 (10 seconds) | `V3GET` |
| `queryRowLimit` | Acts as an implicit `LIMIT`; `0` returns schema only, producing no rows | `V3POST` |
| `offset` on `GET /rows` | Required | `V3ROWS` |
| `chunkId` on `GET /chunks/{chunkId}` | Index starts at 0; total from `chunkCount` in the status response | Get SQL Query Chunks |
| Rate limit enforcement | Per organization. `429` when exceeded | Query Services Status Codes |
| Timeout signalling | `408` Request timed out | `V3POST` |

## 5. Connect REST API and Apex query methods

| Limit | Value | Source |
| --- | --- | --- |
| `queryANSISql` rows returned | Up to 49,999 per call | `CDPQ` |
| `queryANSISql` `batchSize` | 1 to 49999. Default 49999 | `CDPQ` |
| `queryANSISql` `offset` | Default 0. `offset + batchSize` must be less than 2147483647 | `CDPQ` |
| `querySqlRows` / `querySqlStatus` result availability | Up to 24 hours | `CDPQ` |
| `createSqlQuery` result re-read window | Results are queryable for 24 hours without incurring more consumption charges | `QOVR` |
| `querySqlRows` `rowLimit` | Must be greater than 0. The actual number returned may be lower if fewer rows are available or the result set exceeds internal system size limits | `CDPQ` |
| `querySqlRows` `offset` | Must be less than the total number of available rows | `CDPQ` |
| `getCalculatedInsights` `batchSize` | 1 to 200. Default 25 | `CDPCI` |

Salesforce recommends `queryAnsiSqlV2(input)` with `nextBatchAnsiSqlV2(nextBatchId)` over
`queryANSISql` for larger response sizes, and `sfsqlquery` over `ConnectApi.CdpQuery` for new Apex
(`CDPQ`, Query Data 360 Data with Apex).

## 6. SOQL against Data Cloud objects

| Limit | Value | Source |
| --- | --- | --- |
| Minimum API version | 51.0 | `SOQL` |
| `LIMIT` default | 100 | `SOQL` |
| `LIMIT` maximum | 2,000 records in a single call | `SOQL` |
| Subqueries | Not supported | `SOQL` |
| Aggregate functions in `SELECT` | Not supported | `SOQL` |
| Date functions in `SELECT` | Not supported | `SOQL` |
| `HAVING` | Not supported | `SOQL` |
| Parent-child relationships | Not supported in the current implementation | Using SOQL to Query Data in Data 360 |
| `*` wildcard in `SELECT` | Not supported. Use `FIELDS(ALL)` or name the fields | Using SOQL to Query Data in Data 360 |
| Records returned without a query locator, before API 61.0 | Only the first 201 records | `APEX` |
| `Database.QueryLocator` and SOQL `for` loops over DMOs | Supported from API 61.0 | `APEX` |
| Batch Apex over DMOs with a `QueryLocator` | Blocked | `APEX` |
| Batch Apex over DMOs with an `Iterable` | Supported | `APEX` |

## 7. Apex execution semantics

| Behaviour | Value | Source |
| --- | --- | --- |
| A static SOQL query against Data Cloud from Apex | Considered a callout, subject to the same restrictions as HTTP callouts from Apex | `APEX` |
| Pending DML before a DMO query | Throws `UnexpectedException: A callout was unsuccessful because of pending uncommitted work related to a process, flow, or Apex operation.` | `APEX` |
| Consumption | Running SOQL queries against DMOs can consume Data Services credits from the Data Cloud subscription. Use caution with `FOR` loops, query locators, recursion, or anything producing multiple queries | `APEX` |
| Field-level security on DMOs | No support | `APEX` |
| Record-level access control on DMOs | No support | `APEX` |
| DMO visibility from Apex | DMOs in all data spaces are accessible in system mode, even without an explicitly assigned data space permission set | `APEX` |
| `Schema.getGlobalDescribe()` | Cannot discover exposed DMOs | `APEX` |
| Governor limits inside a SOQL stub | Apply to the stubbed records | Mock SOQL Tests for Data 360 DMOs |

Apex transaction ceilings themselves - SOQL query count, heap, CPU time, callout count and the
120-second cumulative callout budget - are unchanged by Data Cloud and are covered in skill
`sf-governor-limits`. Because a DMO query counts as a callout, it draws on the callout budget of the
transaction, not only the SOQL budget.

## 8. Model scale and shape

| Item | Value | Source |
| --- | --- | --- |
| Pre-loaded C360 Data Model objects | Over 300 industry-agnostic objects | `ARCH` |
| Connectors available for non-Salesforce data | Over 270 | `ARCH` |
| DMO storage | DMOs store no data, only references to data stored in DLOs | `OBJ` |
| DMO field API names | Always end in `__c`, for standard and custom fields alike | `OBJ` |

## 9. Environment constraints

| Constraint | Detail | Source |
| --- | --- | --- |
| Data Cloud in scratch orgs | Salesforce partners must log a case with Partner Support. Only available for scratch orgs created from a Dev Hub that is part of a Partner Business Org | Workflow for Data 360 Second-Generation Managed Packages |
| Developer Edition provisioning | Standard Developer Edition orgs may require specific activation or a Salesforce Support case, and provisioning can take time after activation | Workflow for Data 360 Second-Generation Managed Packages |
| Permission to deploy data kit components | Data Cloud Architect permission set | Workflow for Data 360 Second-Generation Managed Packages |
| Sandbox with Data Cloud | Documented as beta; the alternative for customer developers is a second org for development and testing | Differences Between Developing Apps on Data 360 and the Salesforce Platform |
| Metadata API coverage | Partial: AWS data streams, Ingestion API data streams, mobile and web data streams, data lake, data model | Custom App Development |

## 10. Deliberately not stated

These limits exist but the authoritative page is *Data 360 Limits and Guidelines* in Salesforce Help,
which is client-rendered and could not be read during this research session. Do not invent a figure
for them; open the page and read the current number.

- Segment membership and activation volume ceilings.
- Calculated insight run frequency and maximum result size.
- Data graph size and refresh cadence.
- Per-org query concurrency and daily query allocations.
- Data space count per tenant.
- Identity resolution ruleset run frequency.

Authoritative page: *Salesforce Help*, Data 360 Limits and Guidelines -
`https://help.salesforce.com/s/articleView?id=data.c360_a_limits_and_guidelines.htm&type=5`
(referenced from `ING`, `QOVR` and the Submit SQL Query v3 page).

Billing and consumption units are documented separately in *Data 360 Billable Usage Types* -
`https://help.salesforce.com/s/articleView?id=data.c360_a_data_usage_types.htm&type=5` (referenced
from `APEX` and Get Started with Data 360 Development).

## 11. Applying the numbers

| Design question | Number that decides it |
| --- | --- |
| Can I push this nightly file through streaming? | 200 KB per request against your row size. Above that, bulk |
| How many bulk loads can a pipeline run? | 20 jobs per hour, 5 concurrent, 100 files each, 150 MB per file |
| How soon can a smoke test assert on ingested data? | 30 seconds minimum, and streaming adds about 3 minutes |
| Can I return the whole result to a wire adapter? | 20 MB per v3 response page; 49,999 rows for `queryANSISql` |
| Do I need pagination in Apex? | Anything over one page. `sfsqlquery.SqlQueueable` handles it |
| Can I poll a v3 query in a tight loop? | `waitTimeMs` caps at 10 seconds; add your own delay outside Apex |
| Should this be a repeat query or a re-read? | Results stay queryable for 24 hours without extra consumption charges |
| Can I use Batch Apex over a DMO? | Only with an `Iterable`, never a `QueryLocator` |
| Will `LIMIT 5000` work in SOQL? | No. 2,000 is the ceiling per call |
