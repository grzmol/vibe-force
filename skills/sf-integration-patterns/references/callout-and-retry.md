# Callouts, Retry, Idempotency, Dead Letters

## Callout governor limits

| Limit | Value | Source |
| --- | --- | --- |
| Callouts (HTTP requests or web service calls) per transaction | 100 | Apex governor limits |
| Cumulative callout timeout per transaction | 120 seconds (additive across all callouts) | Apex callout timeouts |
| Default timeout per callout | 10,000 ms | Apex callout timeouts |
| Configurable timeout range | 1 ms to 120,000 ms | Apex callout timeouts |
| Max request or response size | 6 MB synchronous Apex, 12 MB asynchronous Apex | Apex governor limits |
| Callouts per `Continuation` | 3 | Continuation limits |
| Long-running request limit | All callouts are excluded since Winter '20 | Continuation docs |
| Data Virtualisation / external object callout timeout | 120 seconds configurable | Integration Patterns |

Sources: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_callouts_timeouts.htm,
https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm,
https://developer.salesforce.com/docs/platform/lwc/guide/apex-continuations-limits.html

Cumulative timeout maths: five callouts at `setTimeout(30000)` already exceed the 120 s transaction
budget when they all run slow. Size timeouts from the endpoint SLA, and split work across Queueable
chains when the budget is tight. See skill `sf-governor-limits`.

## Transaction rules

| Rule | Consequence | Correct shape |
| --- | --- | --- |
| No callout after uncommitted DML in the same transaction | `System.CalloutException: You have uncommitted work pending` | Call out first, or enqueue async work after the DML |
| No synchronous callout from a trigger context | Same exception class at runtime | Publish a platform event or enqueue a Queueable from the handler |
| `@future` needs `callout=true` | `CalloutException` for callouts in a future method without it | `@future(callout=true)` |
| `Queueable` needs the marker interface | Callouts fail without it | `implements Queueable, Database.AllowsCallouts` |
| Batch Apex needs the marker interface | Callouts fail without it | `implements Database.Batchable<SObject>, Database.AllowsCallouts` |
| Continuation methods cannot do DML | Transaction rolls back, error returned | DML in the callback method only |
| Platform events are not transactional | Published events cannot be rolled back | `Publish After Commit` when subscribers depend on committed data |

`implements Queueable, Database.AllowsCallouts` verified from `trailheadapps/apex-recipes`
`QueueableWithCalloutRecipes.cls`.

## Retry engine: Queueable + Finalizer + exponential backoff

Transaction finalizers run in their own transaction with fresh governor limits, even when the parent
Queueable died from an unhandled exception. Verified behaviour
(https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction_finalizers.htm):

| Fact | Detail |
| --- | --- |
| Attach | `System.attachFinalizer(finalizer)` inside the Queueable `execute` method |
| Count | Exactly one finalizer per Queueable job; attaching twice throws |
| Context | `FinalizerContext.getResult()` returns `System.ParentJobResult.SUCCESS` or `UNHANDLED_EXCEPTION` |
| Diagnostics | `getAsyncApexJobId()`, `getRequestId()`, `getException()` |
| Chaining | A finalizer may enqueue exactly one new async job (Queueable, future, or batch) |
| Callouts | Allowed inside a finalizer |

```apex
/**
 * Payload carrier. Keep it small and serialisable: Queueable state is persisted between attempts.
 */
public class OutboundRequest {
    public String namedCredential;
    public String path;
    public String method;
    public String body;
    public String correlationId;

    public OutboundRequest(String namedCredential, String path, String method, String body, String correlationId) {
        this.namedCredential = namedCredential;
        this.path = path;
        this.method = method;
        this.body = body;
        this.correlationId = correlationId;
    }
}
```

```apex
public with sharing class OutboundCalloutJob implements Queueable, Database.AllowsCallouts {
    public static final Integer MAX_ATTEMPTS = 5;

    private final OutboundRequest request;
    private final Integer attempt;

    public OutboundCalloutJob(OutboundRequest request) { this(request, 1); }

    public OutboundCalloutJob(OutboundRequest request, Integer attempt) {
        this.request = request;
        this.attempt = attempt;
    }

    public void execute(QueueableContext ctx) {
        // The finalizer owns retry and dead-lettering; it runs even on an unhandled exception.
        System.attachFinalizer(new OutboundCalloutFinalizer(request, attempt));

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:' + request.namedCredential + request.path);
        req.setMethod(request.method);
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('X-Correlation-Id', request.correlationId);
        req.setHeader('Idempotency-Key', request.correlationId);
        req.setTimeout(20000);
        if (String.isNotBlank(request.body)) {
            req.setBody(request.body);
        }

        HttpResponse res = new Http().send(req);
        Integer status = res.getStatusCode();

        IntegrationLog.record(request.correlationId, request.namedCredential, request.path, status, attempt);

        if (status >= 200 && status < 300) {
            return;
        }
        if (isRetryable(status)) {
            // Let the finalizer schedule the next attempt.
            throw new RetryableCalloutException(
                request.namedCredential + ' returned ' + status + ' on attempt ' + attempt
            );
        }
        // 4xx other than 408/429 are permanent: the payload is wrong, retrying cannot help.
        DeadLetterService.park(request, status, res.getBody(), attempt);
    }

    private static Boolean isRetryable(Integer status) {
        return status == 408 || status == 429 || status == 425 || status >= 500;
    }

    public class RetryableCalloutException extends Exception {}
}
```

```apex
public with sharing class OutboundCalloutFinalizer implements Finalizer {
    private final OutboundRequest request;
    private final Integer attempt;

    public OutboundCalloutFinalizer(OutboundRequest request, Integer attempt) {
        this.request = request;
        this.attempt = attempt;
    }

    public void execute(FinalizerContext ctx) {
        if (ctx.getResult() == ParentJobResult.SUCCESS) {
            return;
        }

        Exception cause = ctx.getException();
        if (attempt >= OutboundCalloutJob.MAX_ATTEMPTS) {
            DeadLetterService.park(request, null, cause == null ? 'unknown' : cause.getMessage(), attempt);
            return;
        }

        // Exponential backoff. Queueable has no delay parameter, so schedule the next attempt.
        Integer delayMinutes = (Integer) Math.pow(2, attempt - 1); // 1, 2, 4, 8, 16
        System.scheduleBatch(
            new RequeueOutboundCallout(request, attempt + 1),
            'VF Retry ' + request.correlationId + ' #' + (attempt + 1),
            delayMinutes
        );
    }
}
```

```apex
/**
 * One-record batch used purely as a delay mechanism: System.scheduleBatch accepts a
 * minutes-from-now delay, which Queueable does not. start() returns a single dummy row.
 */
public with sharing class RequeueOutboundCallout implements Database.Batchable<SObject> {
    private final OutboundRequest request;
    private final Integer attempt;

    public RequeueOutboundCallout(OutboundRequest request, Integer attempt) {
        this.request = request;
        this.attempt = attempt;
    }

    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator([SELECT Id FROM Organization LIMIT 1]);
    }

    public void execute(Database.BatchableContext bc, List<SObject> scope) {
        System.enqueueJob(new OutboundCalloutJob(request, attempt));
    }

    public void finish(Database.BatchableContext bc) {}
}
```

Alternative delay mechanisms, in order of preference:

| Mechanism | Delay control | Notes |
| --- | --- | --- |
| `System.scheduleBatch(batchable, name, minutes)` | minutes, 1 minute granularity | Simple; consumes a scheduled-job slot per retry |
| `System.enqueueJob(job, delayInMinutes)` | 0-10 minutes `[unverified - confirm the overload in your org's API version]` | Cleanest when available |
| `Schedulable` scanning a retry queue object every N minutes | fixed tick | Best for high volume; one job drains many pending rows |
| Platform event + `EventBus.RetryableException` | platform-controlled, increasing | Only for event-driven subscribers, max 9 retries |

Asynchronous execution counts against `DailyAsyncApexExecutions`; see skill
`sf-async-apex-patterns` for chaining depth and queue limits.

## Dead letters

```apex
public with sharing class DeadLetterService {
    public static void park(OutboundRequest request, Integer statusCode, String detail, Integer attempts) {
        Integration_Dead_Letter__c row = new Integration_Dead_Letter__c(
            Correlation_Id__c = request.correlationId,
            Named_Credential__c = request.namedCredential,
            Path__c = request.path,
            Http_Method__c = request.method,
            Request_Body__c = truncate(request.body, 131000),
            Status_Code__c = statusCode,
            Failure_Detail__c = truncate(detail, 131000),
            Attempts__c = attempts,
            Status__c = 'New'
        );
        Database.insert(row, false, AccessLevel.SYSTEM_MODE);
        // Optional: publish a monitoring event so an alerting subscriber can page someone.
        EventBus.publish(new Integration_Failure__e(
            Correlation_Id__c = request.correlationId,
            Named_Credential__c = request.namedCredential,
            Detail__c = truncate(detail, 500)
        ));
    }

    private static String truncate(String value, Integer max) {
        return value == null ? null : (value.length() > max ? value.substring(0, max) : value);
    }
}
```

Dead-letter object design:

| Field | Type | Purpose |
| --- | --- | --- |
| `Correlation_Id__c` | Text(64), External Id, Unique | Join key across Salesforce, middleware, and the remote system |
| `Named_Credential__c` | Text(80) | Which integration failed |
| `Path__c` / `Http_Method__c` | Text | Reproduce the call |
| `Request_Body__c` | Long Text Area | Replay payload |
| `Status_Code__c` | Number(3,0) | HTTP status when there was one |
| `Failure_Detail__c` | Long Text Area | Exception message or response body |
| `Attempts__c` | Number(2,0) | How many times it was tried |
| `Status__c` | Picklist: New / Replaying / Resolved / Discarded | Operator workflow |
| `Replayed_At__c` | DateTime | Audit |

Replay is an explicit operator action, never automatic:

```apex
// scripts/apex/replay-dead-letters.apex - run against a sandbox first.
List<Integration_Dead_Letter__c> rows = [
    SELECT Id, Correlation_Id__c, Named_Credential__c, Path__c, Http_Method__c, Request_Body__c
    FROM Integration_Dead_Letter__c
    WHERE Status__c = 'New' AND Named_Credential__c = 'Billing_API'
    LIMIT 50
];
for (Integration_Dead_Letter__c row : rows) {
    System.enqueueJob(new OutboundCalloutJob(new OutboundRequest(
        row.Named_Credential__c, row.Path__c, row.Http_Method__c, row.Request_Body__c, row.Correlation_Id__c
    )));
    row.Status__c = 'Replaying';
}
update rows;
System.debug(LoggingLevel.ERROR, 'VF_REPLAY enqueued=' + rows.size());
```

## Idempotency

| Direction | Technique |
| --- | --- |
| Outbound | Send a stable `Idempotency-Key` (the correlation id) and reuse it on every retry of the same logical request; require the remote system to dedupe on it |
| Outbound | Never generate a new correlation id inside the retry path - generate once when the work is created |
| Inbound | Upsert on an External Id field (External ID + Unique) so replays converge |
| Inbound | Insert-first into a request ledger with a unique key; `DUPLICATE_VALUE` means "already processed" |
| Events | Dedupe on `ReplayId` (or a business key), because a 72-hour replay window means redelivery is normal |
| Any | Make the operation naturally idempotent (set a state, not increment a counter) |

```apex
public with sharing class IntegrationContext {
    // Correlation id stable for one logical request; propagate it into every retry and log row.
    public static String newCorrelationId() {
        return 'vf-' + Datetime.now().formatGmt('yyyyMMddHHmmss') + '-' +
               EncodingUtil.convertToHex(Crypto.generateAesKey(64)).substring(0, 8);
    }
}
```

```apex
public with sharing class InboundRequestLedger {
    /** Returns true when this key has not been seen before (caller should process it). */
    public static Boolean claim(String idempotencyKey, String source) {
        Integration_Request__c row = new Integration_Request__c(
            Key__c = idempotencyKey, Source__c = source, Received_At__c = Datetime.now()
        );
        Database.SaveResult sr = Database.insert(row, false, AccessLevel.SYSTEM_MODE);
        if (sr.isSuccess()) {
            return true;
        }
        for (Database.Error e : sr.getErrors()) {
            if (e.getStatusCode() == StatusCode.DUPLICATE_VALUE) {
                return false; // replay of an already-processed request
            }
        }
        throw new IntegrationException('Cannot claim idempotency key: ' + sr.getErrors()[0].getMessage());
    }

    public class IntegrationException extends Exception {}
}
```

## Error classification

| Class | HTTP / Apex signal | Action |
| --- | --- | --- |
| Transient network | `System.CalloutException` with "Read timed out", "Unable to tunnel" | Retry with backoff |
| Throttling | 429, sometimes with `Retry-After` | Retry, honour `Retry-After` when present |
| Server error | 500, 502, 503, 504 | Retry with backoff |
| Auth failure | 401, 403 | Do not retry blindly; alert - credential/principal problem |
| Contract failure | 400, 404, 409, 422 | Dead letter immediately; retrying will not help |
| Salesforce limit | `System.LimitException` | Not catchable in the failing transaction; the finalizer sees `UNHANDLED_EXCEPTION`; reduce batch size |
| Uncommitted work | `CalloutException: You have uncommitted work pending` | Code defect - restructure the transaction |

## Platform event subscriber retries

```apex
trigger BillingSyncEventTrigger on Billing_Sync__e (after insert) {
    EventBus.TriggerContext ctx = EventBus.TriggerContext.currentContext();
    try {
        BillingSyncEventHandler.handle(Trigger.new);
    } catch (Exception e) {
        if (ctx.retries < 9) {
            // Entire batch is redelivered in ReplayId order; DML so far is rolled back.
            throw new EventBus.RetryableException(
                'retry ' + (ctx.retries + 1) + ': ' + e.getMessage()
            );
        }
        // Ninth retry exhausted: park it, otherwise the trigger enters an error state and
        // stops consuming new events until the trigger is re-saved.
        BillingSyncEventHandler.deadLetter(Trigger.new, e);
    }
}
```

Facts (https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_subscribe_apex_refire.htm):
maximum 10 runs per batch sequence (1 + 9 retries); DML before the exception is rolled back; the
platform delays redelivery with an increasing backoff; after exhaustion the trigger enters an error
state and events published during the outage are not resent.

## Observability

| Signal | Implementation |
| --- | --- |
| Correlation id | Generated once per logical request, sent as a header, stored on log/dead-letter rows and on the business record |
| Integration log object | `Integration_Log__c`: `Correlation_Id__c`, `Named_Credential__c`, `Path__c`, `Http_Status__c`, `Attempt__c`, `Duration_Ms__c`, `Direction__c`, `Payload_Hash__c` |
| Payload hygiene | Never log secrets or full PII payloads; store a hash plus the fields needed to replay |
| Failure alerting | `Integration_Failure__e` platform event with a subscriber that creates a Case or notifies an owner |
| Async failures | Query `AsyncApexJob` for `Status = 'Failed'` and non-null `ExtendedStatus` after deploys |
| Debug logs | `sf apex log list`/`sf apex log get` with a Callout-category trace flag; see skill `sf-debugging-logs` |
| Event Monitoring | `ApiEvent`, `ApiTotalUsage` and callout events for orgs with Shield; `getRequestId()` from the finalizer correlates to log lines |

```bash
# Async failures after a deploy
sf data query --target-org vf-int --query \
  "SELECT ApexClass.Name, JobType, Status, ExtendedStatus, NumberOfErrors, CompletedDate \
   FROM AsyncApexJob WHERE Status = 'Failed' AND CreatedDate = TODAY ORDER BY CompletedDate DESC"

# Dead letters created in the last day
sf data query --target-org vf-int --query \
  "SELECT Correlation_Id__c, Named_Credential__c, Status_Code__c, Attempts__c \
   FROM Integration_Dead_Letter__c WHERE CreatedDate = LAST_N_DAYS:1 AND Status__c = 'New'"

# Integration-relevant org limits
sf org list limits --target-org vf-int --json
```

## Cross-references

- Tests for every branch above: `integration-testing.md`
- Credential and endpoint setup: `named-credentials.md`
- Async limits, chaining, scheduling: skill `sf-async-apex-patterns`
- Per-transaction limit budgets: skill `sf-governor-limits`
- Log capture and trace flags: skill `sf-debugging-logs`
- Proving the integration in an org after deploy: skill `sf-post-deploy-verification`
