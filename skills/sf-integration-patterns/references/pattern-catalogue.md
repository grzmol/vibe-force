# Integration Pattern Catalogue

Source: Integration Patterns and Practices,
https://architect.salesforce.com/docs/architect/fundamentals/guide/integration-patterns.html

Pattern categories: **Data integration** (keep two stores consistent), **Process integration**
(one business process spans systems), **Virtual integration** (read/write remote data without
copying it). Timing is either synchronous (caller blocks) or asynchronous (one-way, near real time).

## Selection matrix

| From -> To | Type | Timing | Pattern |
| --- | --- | --- | --- |
| Salesforce -> other system | Process | Synchronous | Remote Process Invocation - Request and Reply |
| Salesforce -> other system | Process | Asynchronous | Remote Process Invocation - Fire and Forget |
| Salesforce -> other system | Data | Synchronous | Remote Process Invocation - Request and Reply |
| Salesforce -> other system | Data | Asynchronous | UI Update Based on Data Changes / CDC |
| Salesforce -> other system | Virtual | Synchronous | Data Virtualisation |
| Other system -> Salesforce | Process | Synchronous or asynchronous | Remote Call-In |
| Other system -> Salesforce | Data | Synchronous | Remote Call-In |
| Other system -> Salesforce | Data | Asynchronous | Batch Data Synchronisation |

## 1. Remote Process Invocation - Request and Reply

| Aspect | Detail |
| --- | --- |
| When | A Salesforce event (button click, record save) must start a remote process and the result must be stored/displayed in the same interaction. |
| Mechanism (best) | External Services invoking a REST API declaratively when an OpenAPI 2.0/3.0 spec exists; Apex `HttpRequest` via Named Credential when it does not. |
| Mechanism (good) | Flow HTTP Callout action - declarative outbound REST without full External Services registration. |
| Mechanism (suboptimal) | Trigger-initiated callouts (must be async, so it is really fire-and-forget); batch Apex synchronous callouts. |
| Timeliness | Apex callout timeout is configurable up to 120 s; keep user-facing calls near 5 s. Use `Continuation` in LWC for long-running calls. |
| Volume | Small payloads, real time. Never use for batch payloads. |
| Transactionality | Salesforce commits only after a successful response is processed; the caller owns error handling and retry. |
| Idempotency | Remote procedure must be idempotent; send a unique message id (correlation id) and upsert on it remotely. |
| Security | TLS by default; two-way TLS supported with self-signed or CA-signed certificates; OAuth 2.0 recommended; WS-Security is not natively supported. |
| State | Store the remote primary key on the Salesforce record, or the Salesforce Id remotely. |
| Complex cases | Orchestration, aggregation across systems, transformation, cross-system transactionality -> middleware or a composite service. |

Continuation constraints (LWC):

| Constraint | Value |
| --- | --- |
| Callouts per `Continuation` | 3 |
| Concurrency | Framework processes continuations serially; one in progress at a time |
| DML in the continuation method | Not allowed - transaction rolls back; do DML in the callback |
| Callout exclusion | Since Winter '20 all callouts are excluded from the long-running synchronous request limit |

```apex
public with sharing class SlowServiceController {
    @AuraEnabled(continuation=true cacheable=true)
    public static Object startRequest() {
        Continuation con = new Continuation(60); // seconds
        con.continuationMethod = 'processResponse';
        con.state = 'quote-request';
        HttpRequest req = new HttpRequest();
        req.setMethod('GET');
        req.setEndpoint('callout:Pricing_API/v1/quotes?accountId=001xx000003DGb2AAG');
        con.addHttpRequest(req);
        return con;
    }

    @AuraEnabled(cacheable=true)
    public static Object processResponse(List<String> labels, Object state) {
        HttpResponse response = Continuation.getResponse(labels[0]);
        if (response.getStatusCode() != 200) {
            throw new AuraHandledException('Pricing_API ' + response.getStatusCode());
        }
        return response.getBody();
    }
}
```

## 2. Remote Process Invocation - Fire and Forget

| Aspect | Detail |
| --- | --- |
| When | A Salesforce event must start remote work; Salesforce must not wait, and one or many unknown subscribers may care. |
| Mechanism (best) | Flow- or Apex-published platform events consumed externally with Pub/Sub API; Change Data Capture for record-change semantics; Event Relay for native Amazon EventBridge delivery. |
| Mechanism (good) | OmniStudio Integration Procedures; Apex-published platform events. |
| Mechanism (suboptimal/legacy) | Outbound Messaging (SOAP, contract-first, retries on non-ack); async Apex SOAP/HTTP callouts from triggers. |
| Timeliness | Control returns immediately. Bus delivery is near real time and not acknowledged to the publisher. |
| Reliability | Events are published to the bus once; no publisher-side retry. High-volume event messages are stored 72 hours and replayable by Replay ID. Rarely, an event may never be persisted and is unrecoverable. |
| Transaction behaviour | `Publish After Commit` publishes only on commit; `Publish Immediately` publishes regardless of commit. |
| Error handling | Subscriber owns error handling; Flow subscribers need fault paths writing to a monitored object. |
| Idempotency | Subscribers must dedupe on Replay ID or a business correlation id, since replay redelivers. |
| Limits | Event message max 1 MB. Publishing via API counts against org API allocations. |

```apex
// Trigger-safe pattern: publish, never call out synchronously from a trigger.
public with sharing class AccountTriggerHandler {
    public static void afterUpdate(List<Account> updated, Map<Id, Account> oldMap) {
        List<Account_Tier_Changed__e> events = new List<Account_Tier_Changed__e>();
        for (Account a : updated) {
            if (a.Tier__c != oldMap.get(a.Id).Tier__c) {
                events.add(new Account_Tier_Changed__e(
                    Account_Id__c = a.Id,
                    New_Tier__c = a.Tier__c,
                    Correlation_Id__c = IntegrationContext.newCorrelationId()
                ));
            }
        }
        if (!events.isEmpty()) {
            EventBus.publish(events);
        }
    }
}
```

## 3. Batch Data Synchronisation

| Aspect | Detail |
| --- | --- |
| When | Initial loads and scheduled bidirectional syncs of large data sets. |
| Mechanism (best) | Third-party ETL (Informatica, MuleSoft) with change data capture on the source, writing via Bulk API 2.0; Composite Graph when Salesforce is master and payloads are graph-shaped; Data 360 actions/activations for org-to-org. |
| Mechanism (fit) | Data Loader / Data Import Wizard for stewardship tasks, not as an integration strategy. |
| Mechanism (suboptimal) | Continuous remote call-in or remote process invocation per record. |
| Timeliness | Not time critical; must finish inside the batch window. |
| Volume | >2,000 records per operation -> Bulk API 2.0. Under that, bulkified REST (composite/collections) or SOAP. |
| Locking | Group child records by parent key before loading to avoid row-lock contention (for example group Contacts by AccountId). |
| Watermarking | Middleware stores the last successfully processed timestamp in control tables outside Salesforce; Salesforce is the spoke, ETL is the hub. |
| Error handling | Log, retry non-infrastructure errors, terminate and alert on repeated failure; restart from control tables. |
| Locking model | Salesforce uses optimistic locking; API writers must handle concurrent-modification results. |

Bulk API 2.0 limits that shape the design:

| Item | Bulk API 2.0 |
| --- | --- |
| Batches per rolling 24 h (shared with Bulk API) | 15,000 |
| Records uploaded per rolling 24 h | 150,000,000 |
| Max file size per job | 150 MB base64; upload <= 100 MB raw CSV |
| Max characters per field / per record | 131,072 / 400,000 |
| Max fields per record | 5,000 |
| Job open max | 24 hours (ingest jobs) |
| Terminal job retention | 7 days (results retrievable within 7 days of completion) |
| Query jobs per rolling 24 h | 10,000 (`DailyBulkV2QueryJobs`) |
| Query result retrieval timeout | 20 minutes |
| Processing mode | Always parallel; no serial mode; each batch commits independently |

## 4. Remote Call-In

| Aspect | Detail |
| --- | --- |
| When | An external system creates/reads/updates/deletes Salesforce data or notifies Salesforce of an external event. |
| Mechanism (best) | REST API; Composite (25 subrequests); Composite Graph (75 graphs, 500 nodes); Bulk API 2.0 for bulk; GraphQL API for multi-object selective reads; Pub/Sub API to publish events. |
| Mechanism (suboptimal) | SOAP API; Apex SOAP web services; Apex REST services - only when multi-object transactionality or pre-commit logic is required. |
| Timing | Always synchronous request-reply from Salesforce's side; the caller may discard the response. |
| Transactionality | REST/SOAP default to per-record commit; composite supports all-or-none. A transaction cannot span multiple API calls. |
| Volume | 200 records per create/update/delete call; query batch size default 500, max 2,000; event message max 1 MB. |
| Idempotency | Caller must manage duplicate calls after timeouts; Salesforce-side upsert on External Id is the defence. |
| Security | Object- and field-level security of the authenticated user applies; profile IP restrictions can limit API access; TLS 1.2+ required. |
| Limits | Concurrent long-running (>=20 s) inbound requests: 25 production/sandbox, 5 Developer/Trial; REST/SOAP call timeout 10 minutes; query cursors 10 per user. |

## 5. UI Update Based on Data Changes

| Aspect | Detail |
| --- | --- |
| When | A Salesforce user must see a change without refreshing the page. |
| Mechanism | Platform event published by trigger or Flow; LWC subscriber via `lightning/empApi`; external UI subscribes via Pub/Sub API. |
| Guarantees | Delivery is not guaranteed, ordering is not guaranteed, and record changes made by Bulk API do not generate notifications. |
| Replay | 72-hour replay window for high-volume events. |
| Security | Subscriber needs read access to the event entity; publisher needs create access. |

## 6. Data Virtualisation

| Aspect | Detail |
| --- | --- |
| When | Users must view/search/modify external data in Salesforce without copying it (data residency, volume, freshness). |
| Mechanism | Salesforce Connect adapters: OData 4.01/4.0/2.0, AWS (Athena, DynamoDB), Snowflake, GraphQL via AWS AppSync, cross-org (Salesforce REST API), custom Apex Connector Framework. |
| Alternatives | Data 360 zero copy / Data Cloud One for harmonised read access (data in Data 360 is not editable - use Salesforce Connect when writes are needed). |
| Timeliness | Every page render is a live callout; 120-second maximum timeout. |
| Volume | Small pages. Server-driven paging caps a page at 2,000 rows; client-driven paging defaults to 500. High Data Volume option bypasses most rate limits with caveats. |
| Relationships | Lookup (18-char Id), external lookup (parent External ID standard field), indirect lookup (parent custom field with External ID + Unique). |
| Limits to watch | `HourlyODataCallout`, `HourlyShortTermIdMapping`, `HourlyLongTermIdMapping` in the org limits resource. |

## Middleware capability matrix

Which middleware capabilities each pattern needs (M = mandatory, D = desirable, - = not required):

| Capability | Req/Reply | Fire & Forget | Batch Sync | Remote Call-In | Data Virtualisation |
| --- | --- | --- | --- | --- | --- |
| Event handling | D | D | D | D | D |
| Protocol conversion | D | D | D | D | M |
| Translation/transformation | D | D | M | D | M |
| Queuing and buffering | D | M | M | M | M |
| Synchronous transport | M | - | M | M | M |
| Asynchronous transport | - | M | - | - | D |
| Mediation routing | D | D | D | D | D |
| Choreography/orchestration | D | D | M | D | D |
| Transactionality | D | M | D | M | M |
| ETL | - | - | M | D (bulk) | - |
| Long polling | - | M (Streaming API) | M (CDC) | - | - |
| gRPC (Pub/Sub API) | - | M | M | D | - |

Salesforce cannot participate in distributed transactions initiated outside itself. Compensation and
rollback across systems belong in middleware.

## Legacy replacement table

| Product | Status | Replacement | Migration |
| --- | --- | --- | --- |
| Outbound Messaging | Legacy (supported) | Flow + platform events | Re-implement as platform events for modern auth and retry |
| Process Builder | End of support | Flow Builder | Migrate to Flow tool, refactor complex logic |
| Salesforce-to-Salesforce | Retiring Spring '27 | Change Data Capture, Salesforce Connect, Pub/Sub API | Move to CDC or Pub/Sub API with middleware |
| Streaming API (CometD/Bayeux) | Legacy (supported) | Pub/Sub API | gRPC/HTTP2 subscription, higher throughput |
| SOAP API `login()` | Unavailable in v65.0+, retires Summer '27 | OAuth 2.0 flows | External Client Apps + OAuth |

## Security appendix highlights

| Topic | Guidance |
| --- | --- |
| Secrets | Only in External Credentials (and their principal parameters). Never in Apex, custom settings, or static resources. |
| Private networking | Salesforce Private Connect (AWS PrivateLink) for bidirectional traffic that must avoid the public internet; `PrivateConnectOutboundCalloutHourlyLimitMB` applies. |
| Two-way TLS | Supported for Apex callouts with self-signed or CA-signed certificates. |
| WS-Security | Not natively generated. Prefer a security/XML gateway or transport-level encryption over hand-rolled Apex SOAP headers. |
| Encryption at rest | Shield Platform Encryption for sensitive replicated data. |
| Integration users | API-only access with least-privilege permission sets; separate users per integration so cursor and API allocations are attributable. |

## Cross-references

- Callout limits, retry engine, transaction rules: `callout-and-retry.md`
- Endpoint and credential configuration: `named-credentials.md`
- Inbound API specifics and curl/CLI probes: `inbound-apis.md`
- Async execution model and chaining: skill `sf-async-apex-patterns`
- Governor limits: skill `sf-governor-limits`
- Post-deploy verification of a live integration: skill `sf-post-deploy-verification`
