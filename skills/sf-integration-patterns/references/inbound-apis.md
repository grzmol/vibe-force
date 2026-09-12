# Inbound APIs: Remote Systems Calling Salesforce

Every example uses `sf api request rest` (authenticated via the CLI session) or `curl` with an OAuth
bearer token. API version comes from `apiVersion` in `config/vibe-force.defaults.json` (`67.0`);
`sf api request rest` prefixes the instance URL and resolves the default version for you when the
path omits it.

## Choosing the inbound mechanism

| Mechanism | Best for | Records per call | Transactionality | Counts against daily API calls |
| --- | --- | --- | --- | --- |
| REST API (sObject Rows) | Single-record CRUD, simple reads | 1 | Per record | Yes |
| REST API (query) | Reads | 500 default batch, 2,000 max | n/a | Yes (one per query + queryMore) |
| sObject Collections | Bulkified CRUD without job overhead | 200 | Optional all-or-none | Yes - one call per request |
| Composite | Dependent operations in one round trip | 25 subrequests (max 5 collections/query) | Optional all-or-none | Yes - one call |
| Composite Graph | Related-record graphs, partial success per graph | 75 graphs / 500 nodes per payload | Per graph | Yes - one call |
| Composite Batch | Independent subrequests in one round trip | 25 subrequests | Independent per subrequest | Yes - one call |
| sObject Tree | Nested parent-child creates | 200 records, 5 levels `[unverified]` | All-or-none per request | Yes |
| Bulk API 2.0 ingest | >2,000 records | 150 MB/job | Per batch, parallel | Yes - batches count |
| Bulk API 2.0 query | Large exports | up to 1 GB result files | n/a | Yes |
| GraphQL API | Multi-object selective reads | query-shaped | n/a | Yes |
| Apex REST | Multi-object transaction or pre-commit logic | your design | Full Apex transaction | Yes |
| SOAP API | Contract-first legacy clients | 200 | Optional all-or-none | Yes |
| Pub/Sub API | Publish/subscribe events from outside | 200 events/publish recommended | n/a | Event allocations, not API calls |

Sources: https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-composite-post.html,
https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-graph-limits.html,
https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-bulkapi.html,
https://developer.salesforce.com/docs/platform/pub-sub-api/guide/allocations.html

## API request limits and allocations

Source: https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html

| Limit | Value |
| --- | --- |
| Concurrent inbound requests lasting >= 20 s | 25 (production, sandbox), 5 (Developer Edition, Trial); excess returns `REQUEST_LIMIT_EXCEEDED` |
| Concurrent requests shorter than 20 s | Unlimited |
| REST/SOAP call timeout | 10 minutes (`REQUEST_RUNNING_TOO_LONG` / `QUERY_TIMEOUT`); applies to the whole composite request, not per subrequest |
| SOQL query timeout | 120 seconds |
| Daily API calls - Developer Edition | 15,000 |
| Daily API calls - Enterprise/Professional | 100,000 + (licences x per-licence allocation) + add-ons; Salesforce licence = 1,000 |
| Daily API calls - Unlimited/Performance | 100,000 + (licences x 5,000 for Salesforce licences) + add-ons |
| Daily API calls - Full sandbox (non-template) | 5,000,000 |
| `DebuggingHeader` calls | Separate 1,000/24 h allocation |
| Combined URI + headers per REST call | 16,384 bytes (414/431 errors beyond); keep public URIs under ~2,000 chars |
| Stored third-party access/refresh tokens | up to 10,000 characters |
| Query cursors per user | 10 open; oldest released beyond that |

Monitoring: `Sforce-Limit-Info` response header, the `/limits` REST resource, `sf org list limits`,
and Setup > System Overview. APIs counting toward the allocation include REST, SOAP, Bulk API, Bulk
API 2.0, and most Connect REST APIs.

## REST API basics

```bash
# Versions and resources available in the org
sf api request rest "/services/data" --target-org vf-int --include

# Single record read
sf api request rest "/services/data/v67.0/sobjects/Account/001xx000003DGb2AAG" --target-org vf-int

# Create
sf api request rest "/services/data/v67.0/sobjects/Account" \
  --method POST --body '{"Name":"Acme Integration Test"}' --target-org vf-dev

# Upsert on an External Id (idempotent - safe to repeat)
sf api request rest "/services/data/v67.0/sobjects/Order__c/External_Id__c/EXT-1001" \
  --method PATCH --body '{"Status__c":"Shipped"}' --target-org vf-int

# Query
sf api request rest "/services/data/v67.0/query/?q=SELECT+Id,Name+FROM+Account+LIMIT+5" \
  --target-org vf-int

# Org limits (same data as sf org list limits)
sf api request rest "/services/data/v67.0/limits" --target-org vf-int
```

Raw curl equivalent (what the remote system does):

```bash
ACCESS_TOKEN="$(sf org display --target-org vf-int --json | jq -r '.result.accessToken')"
INSTANCE_URL="$(sf org display --target-org vf-int --json | jq -r '.result.instanceUrl')"

curl -sS "$INSTANCE_URL/services/data/v67.0/sobjects/Order__c/External_Id__c/EXT-1001" \
  -X PATCH \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"Status__c":"Shipped"}'
```

`sf org display --verbose` also prints the SFDX auth URL, which contains a refresh token - never log
or commit it.

## Composite

25 subrequests per call, at most 5 of which may be sObject Collections or query operations.
Subrequest output is referenced by `referenceId` in later subrequests. The whole series counts as one
API call.

```json
{
  "allOrNone": true,
  "compositeRequest": [
    {
      "method": "POST",
      "url": "/services/data/v67.0/sobjects/Account",
      "referenceId": "refAccount",
      "body": { "Name": "Acme Integration", "External_Id__c": "ACC-9001" }
    },
    {
      "method": "POST",
      "url": "/services/data/v67.0/sobjects/Contact",
      "referenceId": "refContact",
      "body": { "LastName": "Reyes", "AccountId": "@{refAccount.id}" }
    },
    {
      "method": "GET",
      "url": "/services/data/v67.0/sobjects/Account/@{refAccount.id}?fields=Id,Name",
      "referenceId": "refCheck"
    }
  ]
}
```

```bash
sf api request rest "/services/data/v67.0/composite" \
  --method POST --body @composite.json --include --target-org vf-int
```

Composite responds HTTP 200 even when a subrequest failed and the transaction rolled back. Always
inspect `compositeResponse[].httpStatusCode` and `body`, not just the outer status.

Supported inside composite: all sObject resources (including sObject Rows by External Id, excluding
sObject Blob Get), `query`, `queryAll`, and sObject Collections (API 43.0+).

## Composite Graph

Source: https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-graph-limits.html

| Limit | Value |
| --- | --- |
| Graphs per payload | 75 |
| Nodes per graph | 500 |
| Nodes per payload | 500 total (e.g. 1x500 or 50x10) |
| Graph depth | 15 |
| Distinct node types per payload (API version / method / object) | 15 |
| Graph failures per request before `PROCESSING_HALTED` | 14 |

Each graph commits or rolls back independently - the right choice when one bad customer record must
not block the other 74.

## sObject Collections

200 records per request, one API call, optional `allOrNone`.

```json
{
  "allOrNone": false,
  "records": [
    { "attributes": {"type": "Order__c"}, "External_Id__c": "EXT-1", "Status__c": "Shipped" },
    { "attributes": {"type": "Order__c"}, "External_Id__c": "EXT-2", "Status__c": "Cancelled" }
  ]
}
```

```bash
# Upsert by external id field
sf api request rest "/services/data/v67.0/composite/sobjects/Order__c/External_Id__c" \
  --method PATCH --body @collection.json --target-org vf-int
```

BLOB rules: sObject Basic Information / sObject Rows allow up to 2 GB for `ContentVersion` and
500 MB for other eligible standard objects; sObject Collections cap total files at 500 MB per request.

## Bulk API 2.0

Ingest lifecycle: create job -> upload CSV -> `UploadComplete` -> poll job -> fetch
successful/failed/unprocessed results. The `UploadComplete` PATCH is mandatory; without it nothing
processes.

```bash
# 1. Create the ingest job
sf api request rest "/services/data/v67.0/jobs/ingest" --method POST --target-org vf-int \
  --body '{"object":"Order__c","operation":"upsert","externalIdFieldName":"External_Id__c","contentType":"CSV","lineEnding":"LF"}'

# 2. Upload the CSV (jobId from the response)
sf api request rest "/services/data/v67.0/jobs/ingest/750xx000000000AAA/batches" \
  --method PUT --header "Content-Type:text/csv" --body @orders.csv --target-org vf-int

# 3. Close the job so processing starts
sf api request rest "/services/data/v67.0/jobs/ingest/750xx000000000AAA" \
  --method PATCH --body '{"state":"UploadComplete"}' --target-org vf-int

# 4. Poll, then fetch failures
sf api request rest "/services/data/v67.0/jobs/ingest/750xx000000000AAA" --target-org vf-int
sf api request rest "/services/data/v67.0/jobs/ingest/750xx000000000AAA/failedResults" --target-org vf-int
```

Job states you will see: `Open`, `UploadComplete`, `InProgress`, `JobComplete`, `Aborted`, `Failed`.
Delete is only allowed from `UploadComplete`, `JobComplete`, `Aborted`, or `Failed`.

For delivery work, prefer the first-class CLI commands (see skill `sf-data-management`):

```bash
sf data import bulk --sobject Order__c --file orders.csv --target-org vf-int --wait 10
sf data export bulk --query "SELECT Id, External_Id__c FROM Order__c" \
  --output-file orders.csv --result-format csv --target-org vf-int --wait 10
```

Limits recap: 15,000 batches/24 h shared with Bulk API, 150,000,000 records/24 h, 150 MB base64 per
job (upload <= 100 MB raw), ingest jobs open max 24 h, results retrievable for 7 days, query jobs
10,000/24 h. Bulk API 2.0 always processes in parallel - group child records by parent to avoid
lock contention. Platform events can be published through Bulk API 2.0 with insert/create only.

## Apex REST

```apex
@RestResource(urlMapping='/order-sync/*')
global with sharing class OrderSyncResource {
    @HttpGet
    global static List<Order__c> getOrder() {
        String externalId = RestContext.request.params.get('externalId');
        return [
            SELECT Id, External_Id__c, Status__c
            FROM Order__c
            WHERE External_Id__c = :externalId
            WITH USER_MODE
            LIMIT 1
        ];
    }

    @HttpPost
    global static String createOrder(String externalId, Decimal amount) {
        Order__c record = new Order__c(External_Id__c = externalId, Amount__c = amount);
        Database.UpsertResult r = Database.upsert(record, Order__c.External_Id__c, false, AccessLevel.USER_MODE);
        RestContext.response.statusCode = r.isCreated() ? 201 : 200;
        return r.getId();
    }

    @HttpDelete
    global static String deleteOrder() {
        String externalId = RestContext.request.params.get('externalId');
        List<Order__c> rows = [SELECT Id FROM Order__c WHERE External_Id__c = :externalId WITH USER_MODE LIMIT 1];
        if (rows.isEmpty()) {
            RestContext.response.statusCode = 404;
            return 'not found';
        }
        Database.delete(rows, AccessLevel.USER_MODE);
        return 'deleted';
    }
}
```

Annotations: `@RestResource(urlMapping='...')` on a `global` class, plus `@HttpGet`, `@HttpPost`,
`@HttpPut`, `@HttpPatch`, `@HttpDelete` on `global static` methods (one per verb per class).
Endpoint is `<instance>/services/apexrest/<mapping>`. Verified against
`trailheadapps/apex-recipes` `CustomRestEndpointRecipes.cls`.

```bash
sf api request rest "/services/apexrest/order-sync/?externalId=EXT-1001" \
  --method GET --include --target-org vf-int

sf api request rest "/services/apexrest/order-sync/" \
  --method POST --body '{"externalId":"EXT-1002","amount":420.50}' --target-org vf-int
```

Sharing and CRUD: declare `with sharing` (or `inherited sharing` when the caller decides), and run
DML/SOQL in user mode (`WITH USER_MODE`, `AccessLevel.USER_MODE`). See skill `sf-security-model`.

## GraphQL API

```bash
sf api request graphql --body graphql-query.txt --target-org vf-int
```

```graphql
query AccountsWithContacts {
  uiapi {
    query {
      Account(first: 5, where: { Name: { like: "Acme%" } }) {
        edges {
          node {
            Id
            Name { value }
            Contacts { edges { node { LastName { value } } } }
          }
        }
      }
    }
  }
}
```

Use when the caller needs several related objects with selective fields in one round trip; REST
composite is the alternative when writes are involved.

## Pub/Sub API (events in and out)

gRPC + HTTP/2, Avro-encoded payloads. Single interface for publish, subscribe, and schema retrieval,
replacing Streaming API/CometD for new work.

| Allocation | Value |
| --- | --- |
| Event message max size | 1 MB |
| Recommended publish batch size | <= 200 events; total batch <= 3 MB (gRPC hard limit 4 MB) |
| Events requested across FetchRequests in one Subscribe | 100 max (server clamps higher values) |
| Managed subscriptions per org | 200 |
| Concurrent streams per gRPC channel | 1,000 (HTTP/2) |
| High-volume event retention / replay | 72 hours |

Publishing an event without gRPC (REST fallback - a platform event behaves like an sObject):

```bash
sf api request rest "/services/data/v67.0/sobjects/Order_Submitted__e" \
  --method POST --body '{"Order_Id__c":"a01xx0000000001","Correlation_Id__c":"vf-1a2b"}' \
  --target-org vf-int
```

Org-side event allocations to watch in `sf org list limits`:
`HourlyPublishedPlatformEvents`, `HourlyPublishedStandardVolumePlatformEvents`,
`DailyDeliveredPlatformEvents`, `MonthlyPlatformEventsUsageEntitlement`,
`PlatformEventTriggersWithParallelProcessing`.

Hourly publishing allocation for platform events is 100,000 for standard-volume and 250,000 for
high-volume usage-based events; new platform events are high volume by default.

## Streaming API (legacy)

CometD/Bayeux long polling. Limits appear as `DurableStreamingApiConcurrentClients`,
`DailyDurableStreamingApiEvents`, `DailyDurableGenericStreamingApiEvents`. Keep only for existing
consumers; migrate to Pub/Sub API.

## Idempotency requirements for inbound calls

| Technique | Implementation |
| --- | --- |
| Upsert on External Id | Field flagged External ID + Unique; `PATCH /sobjects/<Object>/<ExternalIdField>/<value>` or `Database.upsert(record, Field, false, AccessLevel.USER_MODE)` |
| Idempotency key ledger | Custom object `Integration_Request__c` with a unique `Key__c`; insert-first, treat `DUPLICATE_VALUE` as "already processed" |
| Replay-ID dedupe (events) | Store the last processed `ReplayId` per subscriber; skip anything at or below it |
| Composite all-or-none | `"allOrNone": true` so a retry cannot leave partial state |
| Caller contract | Document that the caller must resend the same `Idempotency-Key` on retry after a timeout |

## Salesforce Functions

Salesforce Functions is retired as a product. Successor workloads belong in external compute
(for example a container or serverless function behind a Named Credential) invoked with the
Request and Reply pattern, or in Apex/Flow when platform limits allow. The docs set
`docs/platform/salesforce-functions` remains published for existing references `[unverified - no
current migration guide fetched this session]`.

## Cross-references

- Outbound direction, retries, transaction rules: `callout-and-retry.md`
- Endpoint/credential configuration: `named-credentials.md`
- Mocking these APIs in Apex tests: `integration-testing.md`
- SOQL shape and selectivity for inbound queries: skill `sf-soql-sosl-optimization`
- Bulk loading mechanics and CLI flags: skill `sf-data-management`
