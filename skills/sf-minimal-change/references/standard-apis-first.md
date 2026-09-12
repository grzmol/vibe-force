# Standard APIs First

Rung 4 of the ladder in `SKILL.md`, integration half. A custom Apex REST endpoint is a permanent
liability: a versioned public contract, a security surface, a test suite, and a deployment
dependency. The platform already exposes almost every shape of data access. This file is the
decision table, the limits, and the commands to prove a standard endpoint does the job.

## Decision table

| Requirement | Standard capability | Why it is smaller | Genuinely needs Apex REST when |
| --- | --- | --- | --- |
| Read or write a single record | REST API sObject resources | No deployable metadata at all | Never |
| Read records by criteria | Query / QueryAll resource | SOQL is the contract | Never for a plain query |
| Create/update/delete many records of one object in one call | sObject Collections (API 42.0 and later) - counts as a single call toward API limits | One round trip, per-record results | Never |
| Several unrelated operations in one round trip | Composite - up to 25 subrequests, the whole series counting as a single API call | Output of one subrequest feeds the next by reference ID; rollback scope is chosen per request | Never |
| Insert a dependent record graph (parent plus children) atomically | Composite Graph (API 50.0 and later) | Up to 500 nodes per graph, 75 graphs per payload, per-graph success or failure | Never |
| Move more than 2,000 records | Bulk API 2.0 ingest job | Asynchronous, chunked, isolated CPU budget | Never |
| Export a large result set | Bulk API 2.0 query job (designed for 2,000 records or more) | No custom pagination code | Never |
| Fetch a precise field set across several objects in one call | GraphQL API | Single endpoint, single request | Never |
| Subscribe to record changes | Change Data Capture over Pub/Sub API | Near-real-time, no polling job | Consumer needs a payload Salesforce does not publish |
| Publish a business event | Platform event (Data APIs or Pub/Sub API) | Schema-versioned, replayable | Event needs server-side assembly beyond a Flow or trigger |
| Authenticated outbound callout | Named credential (`callout:Name/path`) | Salesforce manages authentication; no remote site setting needed for the named credential's site | Never - a custom auth handler is the wrong answer |
| Expose an operation that is **not** CRUD | Apex REST | - | The endpoint performs multi-object business logic in one transaction, enforces a domain invariant, or must present a non-Salesforce-shaped contract that the caller cannot change |

The last row is the only legitimate Apex REST case, and it must be written into the decision log
with the invariant it protects. "The vendor prefers a simpler URL" is not an invariant; a mapping
layer on their side is cheaper than an endpoint on yours.

## Limits that decide the choice

| Capability | Limit | Source |
| --- | --- | --- |
| Composite | 25 subrequests per call; at most 5 of them sObject Collections or query/queryAll operations; the whole series counts as one API call; sObject Blob Get and sObject Rich Text Image Get are unsupported | [Composite](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-composite-post.html) |
| Composite Graph | 75 graphs per payload; maximum graph depth 15; 500 nodes per graph; 500 nodes per payload; 15 "different" node types per payload (different API version, HTTP method, or object counts as different); processing halts after 14 graph failures with `PROCESSING_HALTED` | [Composite Graph Limits](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-graph-limits.html) |
| sObject Collections | Available in API version 42.0 and later; the entire request counts as a single call | [sObject Collections](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-sobjects-collections.html) |
| Bulk API 2.0 | Use above 2,000 records; below that, use bulkified synchronous REST (for example Composite) or SOAP; enabled by default for Performance, Unlimited, Enterprise, and Developer Editions; requires the API Enabled permission | [Bulk API intro](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-intro.html), [Bulk API 2.0](https://developer.salesforce.com/docs/platform/api-asynch/guide/bulk-api-2-0.html) |
| Bulk processing semantics | Each chunk of 200 records is processed as a separate transaction; job status and batch results are available for 7 days | [Bulk API limits](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-concepts-limits.html) |
| Bulk CPU budget | Bulk API and Bulk API 2.0 consume a unique CPU governor limit of 60,000 ms, isolated from the per-transaction Apex CPU limit | [Bulk API 2.0 limits](https://developer.salesforce.com/docs/platform/api-asynch/guide/bulk-common-limits.html) |
| Bulk query SOQL restrictions | No `GROUP BY`, `OFFSET`, `TYPEOF`, aggregate functions, date functions in `GROUP BY`, compound address or geolocation fields | [Bulk API limits](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-concepts-limits.html) |
| GraphQL API | Available in Enterprise, Performance, Unlimited, and Developer Editions | [GraphQL API](https://developer.salesforce.com/docs/platform/graphql/guide/graphql-about.html) |
| Pub/Sub API | gRPC over HTTP/2, binary Avro messages; single interface for platform events, change data capture events, and real-time event monitoring events; available in Enterprise, Performance, Unlimited, and Developer Editions | [Pub/Sub API](https://developer.salesforce.com/docs/platform/pub-sub-api/guide/intro.html) |
| Apex REST | `@HttpGet` and `@HttpDelete` methods must have no parameters; JSON and XML supported, with XML unable to serialise maps and lists; Connect in Apex objects support JSON only | [Apex REST Methods](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_rest_methods.htm) |
| `sf data query` | Above 10,000 records, use `sf data export bulk`, which runs the query through Bulk API 2.0 | [data query](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_data_query.html) |

`apiVersion` for every example below is `67.0`, from `config/vibe-force.defaults.json`.

## Proving the standard endpoint works

`sf api request rest` makes an authenticated HTTP request through the CLI, so you can prove an
endpoint before writing any code
([api request rest](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_api_request_rest.html)).

### Single record

```bash
sf api request rest "services/data/v67.0/sobjects/Account/0018000000abcde" --target-org vf-dev
```

### Create with the POST method

```bash
sf api request rest "services/data/v67.0/sobjects/Account" \
  --method POST \
  --body '{"Name":"Northwind Trading","BillingCity":"Boise"}' \
  --target-org vf-dev
```

### sObject Collections: many records of one object, one call

```bash
cat > /tmp/collection.json <<'JSON'
{
  "allOrNone": false,
  "records": [
    { "attributes": {"type": "Account"}, "Name": "Acme 1" },
    { "attributes": {"type": "Account"}, "Name": "Acme 2" }
  ]
}
JSON

sf api request rest "services/data/v67.0/composite/sobjects" \
  --method POST --body @/tmp/collection.json --target-org vf-dev
```

`allOrNone` chooses whether the whole collection rolls back; that is the decision an Apex endpoint
would otherwise be making in code.

### Composite: dependent operations by reference ID

```bash
cat > /tmp/composite.json <<'JSON'
{
  "allOrNone": true,
  "compositeRequest": [
    {
      "method": "POST",
      "url": "/services/data/v67.0/sobjects/Account",
      "referenceId": "refAccount",
      "body": { "Name": "Northwind Trading" }
    },
    {
      "method": "POST",
      "url": "/services/data/v67.0/sobjects/Contact",
      "referenceId": "refContact",
      "body": { "LastName": "Vance", "AccountId": "@{refAccount.id}" }
    },
    {
      "method": "GET",
      "url": "/services/data/v67.0/query/?q=SELECT+Id,Name+FROM+Account+WHERE+Id='@{refAccount.id}'",
      "referenceId": "refQuery"
    }
  ]
}
JSON

sf api request rest "services/data/v67.0/composite" \
  --method POST --body @/tmp/composite.json --include --target-org vf-dev
```

25 subrequests maximum, at most 5 of them queries or sObject Collections. This replaces the
classic "custom Apex REST endpoint that creates an account and a contact together".

### Composite Graph: atomic record graph, per-graph failure isolation

```bash
cat > /tmp/graph.json <<'JSON'
{
  "graphs": [
    {
      "graphId": "order-1001",
      "compositeRequest": [
        {
          "method": "POST",
          "url": "/services/data/v67.0/sobjects/Account",
          "referenceId": "acct",
          "body": { "Name": "Northwind Trading" }
        },
        {
          "method": "POST",
          "url": "/services/data/v67.0/sobjects/Contact",
          "referenceId": "primaryContact",
          "body": { "LastName": "Vance", "AccountId": "@{acct.id}" }
        }
      ]
    }
  ]
}
JSON

sf api request rest "services/data/v67.0/composite/graph" \
  --method POST --body @/tmp/graph.json --target-org vf-dev
```

Each graph succeeds or fails as a unit, so one bad order does not block the rest of the payload -
the behaviour teams usually hand-roll in Apex with savepoints.

### Bulk API 2.0 ingest with curl

```bash
ORG_JSON=$(sf org display --target-org vf-dev --json)
INSTANCE=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).result.instanceUrl)" <<< "$ORG_JSON")
TOKEN=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).result.accessToken)" <<< "$ORG_JSON")

JOB=$(curl -s -X POST "$INSTANCE/services/data/v67.0/jobs/ingest" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"object":"Account","contentType":"CSV","operation":"upsert","externalIdFieldName":"External_Id__c","lineEnding":"LF"}')
JOB_ID=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).id)" <<< "$JOB")

curl -s -X PUT "$INSTANCE/services/data/v67.0/jobs/ingest/$JOB_ID/batches" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/csv" \
  --data-binary @accounts.csv

curl -s -X PATCH "$INSTANCE/services/data/v67.0/jobs/ingest/$JOB_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"state":"UploadComplete"}'

curl -s "$INSTANCE/services/data/v67.0/jobs/ingest/$JOB_ID" -H "Authorization: Bearer $TOKEN"
```

Upsert on an external ID is the idempotency mechanism - a floor item. Job status and results stay
available for 7 days. Data-loading strategy and staging live in skill `sf-data-management`.

### GraphQL API

```bash
cat > /tmp/gql.json <<'JSON'
{
  "query": "query accounts { uiapi { query { Account(first: 5, where: { Industry: { eq: \"Energy\" } }) { edges { node { Id Name { value } Industry { value } } } } } } }"
}
JSON

sf api request rest "services/data/v67.0/graphql" \
  --method POST --body @/tmp/gql.json --target-org vf-dev
```

One request, exactly the requested fields, no Apex. The same capability is available inside LWC
through the `graphql` wire adapter (`references/base-components-first.md`).

### Events instead of polling

```bash
# Confirm Change Data Capture is already publishing for the object before designing a poller
sf org list metadata --metadata-type PlatformEventChannelMember --target-org vf-dev
sf org list metadata --metadata-type PlatformEventChannel --target-org vf-dev
```

Change Data Capture publishes create, update, delete, and undelete change events for records, and
Pub/Sub API is the single subscription interface for platform events, change data capture events,
and real-time event monitoring events. Any design that polls Salesforce on a timer to detect
changes has skipped this rung.

## If Apex REST really is the answer

Minimum shape: one class, one resource, one method per HTTP verb the contract needs, no framework.

```apex
@RestResource(urlMapping='/orders/*/submit')
global with sharing class OrderSubmitResource {
    @HttpPost
    global static SubmitResult submit(String idempotencyKey) {
        RestRequest request = RestContext.request;
        String orderId = request.requestURI.substringBetween('/orders/', '/submit');

        List<Order> orders = [
            SELECT Id, Status, Submission_Key__c
            FROM Order
            WHERE Id = :orderId
            WITH USER_MODE
            LIMIT 1
        ];
        if (orders.isEmpty()) {
            RestContext.response.statusCode = 404;
            return new SubmitResult('NOT_FOUND', null);
        }

        Order order = orders[0];
        if (order.Submission_Key__c == idempotencyKey) {
            // Replay of a request we already processed: same answer, no side effect.
            return new SubmitResult('ALREADY_SUBMITTED', order.Id);
        }

        order.Status = 'Submitted';
        order.Submission_Key__c = idempotencyKey;
        update as user order;
        return new SubmitResult('SUBMITTED', order.Id);
    }

    global class SubmitResult {
        global String outcome;
        global Id orderId;
        global SubmitResult(String outcome, Id orderId) {
            this.outcome = outcome;
            this.orderId = orderId;
        }
    }
}
```

Rules carried from the floor:

| Rule | Implementation above |
| --- | --- |
| Sharing declared explicitly | `with sharing` on the class (a class with no declaration behaves as `with sharing` at API 67.0+) |
| Object and field permissions enforced | `WITH USER_MODE` on the query, `update as user` on the DML; never `WITH SECURITY_ENFORCED`, which is not allowed in Apex SOQL at 67.0+ |
| Idempotency | Caller-supplied key persisted on the record and checked before mutation |
| Error behaviour | Explicit status codes, no swallowed exceptions |
| `@HttpGet`/`@HttpDelete` signature | No parameters allowed, per the Apex REST documentation |
| Tests | One test per outcome branch: not found, first submit, replay (skill `sf-apex-testing`) |

What must **not** appear: a generic dispatcher, a router table, a "resource base class", a
per-endpoint DTO hierarchy, or a logging framework. One resource, one behaviour.

## Outbound: never hand-roll authentication

```apex
public with sharing class ErpClient {
    public HttpResponse submitOrder(String payload) {
        HttpRequest request = new HttpRequest();
        request.setEndpoint('callout:ERP_Named_Credential/orders');
        request.setMethod('POST');
        request.setHeader('Content-Type', 'application/json');
        request.setBody(payload);
        request.setTimeout(60000);
        return new Http().send(request);
    }
}
```

A named credential specifies the endpoint URL and its authentication parameters in one definition;
Salesforce manages the authentication, and remote site settings are not required for that site.
The same named-credential name can point at different endpoints per org, so the Apex is
environment-agnostic. Pair it with an external credential for the principal. Full patterns,
retries, and circuit breaking: skill `sf-integration-patterns`.

## Verification

```bash
# Any new Apex REST endpoint is a rung-4 exception and must be justified
grep -rn "@RestResource" force-app/main/default/classes

# Hard-coded endpoints or tokens are floor violations
grep -rnE "https?://[a-z0-9.-]+" force-app/main/default/classes | grep -v "callout:"
grep -rniE "(api[_-]?key|secret|bearer [A-Za-z0-9])" force-app/main/default/classes

# Prove the standard endpoint you chose actually returns what the story needs
sf api request rest "services/data/v67.0/limits" --target-org vf-dev

node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local
```

Post-deploy confirmation of the integration path belongs to `vf-check smoke` and skill
`sf-post-deploy-verification`.

## Sources

- [Composite](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-composite-post.html) - 25 subrequests, 5 query/collection subrequests, reference IDs, rollback choice, unsupported blob resources, single API call.
- [Composite Graph](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-graph.html) and [Composite Graph Limits](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-graph-limits.html) - 75 graphs, depth 15, 500 nodes, 15 different nodes, 14 failures then `PROCESSING_HALTED`.
- [sObject Collections](https://developer.salesforce.com/docs/platform/api-rest/guide/resources-composite-sobjects-collections.html) - API 42.0 and later, single call.
- [Introduction to Bulk API 2.0 and Bulk API](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-intro.html) - 2,000-record threshold and the synchronous alternative.
- [Bulk API 2.0](https://developer.salesforce.com/docs/platform/api-asynch/guide/bulk-api-2-0.html) - editions, API Enabled permission, ingest and query jobs.
- [Bulk API 2.0 Limits](https://developer.salesforce.com/docs/platform/api-asynch/guide/bulk-common-limits.html) - 60,000 ms isolated CPU limit.
- [Bulk API Limits](https://developer.salesforce.com/docs/platform/api-asynch/guide/asynch-api-concepts-limits.html) - 200-record transactions, 7-day retention, bulk-query SOQL restrictions.
- [GraphQL API](https://developer.salesforce.com/docs/platform/graphql/guide/graphql-about.html) - single endpoint, editions.
- [Pub/Sub API](https://developer.salesforce.com/docs/platform/pub-sub-api/guide/intro.html) - gRPC/HTTP2, Avro, single publish/subscribe interface.
- [Change Data Capture](https://developer.salesforce.com/docs/platform/change-data-capture/guide/cdc-intro.html) - near-real-time create/update/delete/undelete change events.
- [Apex REST Methods](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_rest_methods.htm) - supported types, `@HttpGet`/`@HttpDelete` parameter restriction, JSON/XML support.
- [Named Credentials as Callout Endpoints](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts_named_credentials.htm) - `callout:` scheme, managed authentication, remote site settings skipped, per-org endpoints.
- [api request rest](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_api_request_rest.html) and [data query](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_data_query.html) - CLI flags used above.
