# Testing Integrations

Apex tests never make real callouts. The runtime raises
`System.TypeException: Methods defined as TestMethod do not support Web service callouts` unless a
mock is registered with `Test.setMock`. Coverage gates come from
`gates.apexClassCoverageMin` / `gates.apexOrgCoverageMin` in `.vibeforce/config.json`; the enforcing
command is `vf-check apex`. General test conventions: skill `sf-apex-testing`.

## Mock registration rules

| Rule | Detail |
| --- | --- |
| One mock per test method | `Test.setMock(HttpCalloutMock.class, mock)` can be called once per test; later calls replace the mock |
| Multiple responses | Use a queue-based or router mock (below) rather than several `setMock` calls |
| SOAP callouts | `Test.setMock(WebServiceMock.class, new MyWebServiceMock())` |
| Static resource mocks | `new StaticResourceCalloutMock()` with `setStaticResource`, `setStatusCode`, `setHeader` |
| Continuations | `Test.setContinuationResponse(label, response)` then `Test.invokeContinuationMethod(controller, continuation)` |
| Async code | Wrap enqueue/execute in `Test.startTest()` / `Test.stopTest()` so the job runs before assertions |
| Finalizers | Finalizers do not execute in tests; test the finalizer class directly by calling `execute` with a stub context `[unverified - no doc fetched this session confirming finalizer behaviour under test]` |

## Single-response mock

```apex
@IsTest
public class SingleResponseMock implements HttpCalloutMock {
    private final Integer code;
    private final String body;

    public SingleResponseMock(Integer code, String body) {
        this.code = code;
        this.body = body;
    }

    public HttpResponse respond(HttpRequest request) {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(code);
        res.setStatus(code == 200 ? 'OK' : 'Error');
        res.setHeader('Content-Type', 'application/json');
        res.setBody(body);
        return res;
    }
}
```

## Ordered-queue mock (multiple sequential callouts)

Pattern verified from `trailheadapps/apex-recipes` `HttpCalloutMockFactory.cls`: one `setMock`, a
queue of responses, each `respond` removes the head.

```apex
@IsTest
public class QueueCalloutMock implements HttpCalloutMock {
    private final List<HttpResponse> queue;

    public QueueCalloutMock(List<HttpResponse> orderedResponses) {
        this.queue = orderedResponses;
    }

    public static HttpResponse response(Integer code, String body) {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(code);
        res.setBody(body);
        res.setHeader('Content-Type', 'application/json');
        return res;
    }

    public HttpResponse respond(HttpRequest request) {
        if (queue.isEmpty()) {
            throw new QueueCalloutMockException('Mock queue exhausted for ' + request.getEndpoint());
        }
        return queue.remove(0);
    }

    public class QueueCalloutMockException extends Exception {}
}
```

## Multi-endpoint router mock

The only mock worth using once a service touches more than one endpoint: it asserts the request
shape and fails loudly on an unexpected call, so a refactor that changes a path breaks the test.

```apex
@IsTest
public class RouterCalloutMock implements HttpCalloutMock {
    public class Route {
        public String method;
        public String endpointFragment;
        public Integer statusCode;
        public String body;
        public Map<String, String> headers = new Map<String, String>();
        public Integer hits = 0;
    }

    private final List<Route> routes = new List<Route>();
    public final List<HttpRequest> received = new List<HttpRequest>();

    public RouterCalloutMock route(String method, String endpointFragment, Integer statusCode, String body) {
        Route r = new Route();
        r.method = method.toUpperCase();
        r.endpointFragment = endpointFragment;
        r.statusCode = statusCode;
        r.body = body;
        routes.add(r);
        return this;
    }

    public Integer hits(String endpointFragment) {
        for (Route r : routes) {
            if (r.endpointFragment == endpointFragment) {
                return r.hits;
            }
        }
        return 0;
    }

    public HttpResponse respond(HttpRequest request) {
        received.add(request);
        for (Route r : routes) {
            if (r.method == request.getMethod().toUpperCase()
                && request.getEndpoint().contains(r.endpointFragment)) {
                r.hits++;
                HttpResponse res = new HttpResponse();
                res.setStatusCode(r.statusCode);
                res.setBody(r.body);
                res.setHeader('Content-Type', 'application/json');
                for (String key : r.headers.keySet()) {
                    res.setHeader(key, r.headers.get(key));
                }
                return res;
            }
        }
        throw new RouterCalloutMockException(
            'Unrouted callout: ' + request.getMethod() + ' ' + request.getEndpoint()
        );
    }

    public class RouterCalloutMockException extends Exception {}
}
```

```apex
@IsTest
private class BillingGatewayTest {
    @IsTest
    static void createsAccountAndPropagatesCorrelationId() {
        RouterCalloutMock mock = new RouterCalloutMock()
            .route('POST', '/v1/accounts', 201, '{"id":"BILL-1","status":"active"}');
        Test.setMock(HttpCalloutMock.class, mock);

        Account a = new Account(Name = 'Acme');
        insert a;

        Test.startTest();
        BillingGateway.BillingAccount result = BillingGateway.createAccount(a.Id, 'vf-test-1');
        Test.stopTest();

        Assert.areEqual('BILL-1', result.id, 'Remote billing id must be returned to the caller');
        Assert.areEqual(1, mock.hits('/v1/accounts'), 'Exactly one billing callout expected');
        HttpRequest sent = mock.received[0];
        Assert.areEqual('vf-test-1', sent.getHeader('X-Correlation-Id'), 'Correlation id must be sent');
        Assert.areEqual('vf-test-1', sent.getHeader('Idempotency-Key'), 'Idempotency key must equal the correlation id');
        Assert.isTrue(sent.getEndpoint().startsWith('callout:'), 'Endpoint must use a named credential');
    }

    @IsTest
    static void surfacesEndpointFailures() {
        Test.setMock(HttpCalloutMock.class, new SingleResponseMock(503, '{"error":"unavailable"}'));
        Account a = new Account(Name = 'Acme');
        insert a;

        Test.startTest();
        try {
            BillingGateway.createAccount(a.Id, 'vf-test-2');
            Assert.fail('A 503 must not be swallowed');
        } catch (BillingGateway.GatewayException expected) {
            Assert.isTrue(expected.getMessage().contains('503'), 'Message must carry the status code');
        }
        Test.stopTest();
    }
}
```

## Testing the retry path

```apex
@IsTest
private class OutboundCalloutJobTest {
    @IsTest
    static void deadLettersPermanentFailures() {
        Test.setMock(HttpCalloutMock.class, new SingleResponseMock(422, '{"error":"invalid payload"}'));
        OutboundRequest req = new OutboundRequest('Billing_API', '/v1/accounts', 'POST', '{}', 'vf-dl-1');

        Test.startTest();
        System.enqueueJob(new OutboundCalloutJob(req, 1));
        Test.stopTest(); // job executes here

        List<Integration_Dead_Letter__c> parked = [
            SELECT Correlation_Id__c, Status_Code__c, Attempts__c, Status__c
            FROM Integration_Dead_Letter__c
            WHERE Correlation_Id__c = 'vf-dl-1'
        ];
        Assert.areEqual(1, parked.size(), '422 must be dead-lettered, not retried');
        Assert.areEqual(422, parked[0].Status_Code__c.intValue(), 'Status code must be recorded');
        Assert.areEqual('New', parked[0].Status__c, 'Operator must see it as New');
    }

    @IsTest
    static void retryableStatusRaisesRetryableException() {
        Test.setMock(HttpCalloutMock.class, new SingleResponseMock(503, 'busy'));
        OutboundRequest req = new OutboundRequest('Billing_API', '/v1/accounts', 'POST', '{}', 'vf-rt-1');

        Test.startTest();
        try {
            new OutboundCalloutJob(req, 1).execute(null);
            Assert.fail('503 must raise a retryable exception so the finalizer reschedules');
        } catch (OutboundCalloutJob.RetryableCalloutException expected) {
            Assert.isTrue(expected.getMessage().contains('503'), 'Status must be in the message');
        }
        Test.stopTest();

        Assert.areEqual(0, [SELECT COUNT() FROM Integration_Dead_Letter__c],
            'Retryable failures must not be dead-lettered on the first attempt');
    }
}
```

Enqueueing more async work inside `Test.stopTest()` is not allowed, so test the finalizer's
scheduling decision by calling it with a stub context rather than by letting the platform run it.

## Testing Apex REST resources

Build a `RestRequest` by hand and set `RestContext`.

```apex
@IsTest
private class OrderSyncResourceTest {
    private static RestRequest request(String method, String uri, String body) {
        RestRequest req = new RestRequest();
        req.httpMethod = method;
        req.requestURI = uri;
        if (body != null) {
            req.requestBody = Blob.valueOf(body);
        }
        RestContext.request = req;
        RestContext.response = new RestResponse();
        return req;
    }

    @IsTest
    static void postIsIdempotentOnExternalId() {
        request('POST', '/services/apexrest/order-sync/', null);
        Test.startTest();
        String firstId = OrderSyncResource.createOrder('EXT-1', 100);
        String secondId = OrderSyncResource.createOrder('EXT-1', 250);
        Test.stopTest();

        Assert.areEqual(firstId, secondId, 'Repeat POST with the same external id must update, not duplicate');
        Assert.areEqual(1, [SELECT COUNT() FROM Order__c WHERE External_Id__c = 'EXT-1'],
            'Only one record may exist for an external id');
        Assert.areEqual(200, RestContext.response.statusCode, 'Second call updates, so 200 not 201');
    }

    @IsTest
    static void getReturns404StyleEmptyForUnknownId() {
        RestRequest req = request('GET', '/services/apexrest/order-sync/', null);
        req.params.put('externalId', 'MISSING');
        Test.startTest();
        List<Order__c> found = OrderSyncResource.getOrder();
        Test.stopTest();
        Assert.isTrue(found.isEmpty(), 'Unknown external id must not return rows');
    }
}
```

## Testing platform events

```apex
@IsTest
private class OrderEventPublisherTest {
    @IsTest
    static void triggerHandlerRunsOnPublish() {
        Test.startTest();
        EventBus.publish(new Order_Submitted__e(Order_Id__c = 'a01xx0000000001', Correlation_Id__c = 'vf-e-1'));
        Test.stopTest(); // event is delivered here; subscribers run

        Assert.areEqual(1, [SELECT COUNT() FROM Integration_Log__c WHERE Correlation_Id__c = 'vf-e-1'],
            'Subscriber must log exactly one processed event');
    }
}
```

| Technique | Use |
| --- | --- |
| `EventBus.publish` before `Test.stopTest()` | Subscriber triggers fire at `stopTest` |
| `Test.getEventBus().deliver()` | Deliver mid-test to assert intermediate state |
| `Test.getEventBus().setResumeCheckpoint(...)` | Control replay/retry checkpoints `[unverified - method surface not confirmed this session]` |
| `EventBus.TriggerContext.currentContext().retries` | Cannot be forced directly; extract the decision into a handler method taking `retries` as a parameter and unit-test that |

Design the subscriber so the retry decision is a pure function:

```apex
public with sharing class RetryPolicy {
    public static Boolean shouldRetry(Integer retries, Exception error) {
        return retries < 9 && (error instanceof CalloutException || error instanceof QueryException);
    }
}
```

```apex
@IsTest
private class RetryPolicyTest {
    @IsTest
    static void stopsRetryingAtNine() {
        Assert.isTrue(RetryPolicy.shouldRetry(0, new CalloutException('timeout')), 'First failure retries');
        Assert.isTrue(RetryPolicy.shouldRetry(8, new CalloutException('timeout')), 'Ninth attempt still retries');
        Assert.isFalse(RetryPolicy.shouldRetry(9, new CalloutException('timeout')),
            'Tenth run must dead-letter instead of entering the trigger error state');
        Assert.isFalse(RetryPolicy.shouldRetry(0, new DmlException('bad data')),
            'Permanent errors must not be retried');
    }
}
```

## Testing SOAP callouts

```apex
@IsTest
global class BillingWebServiceMock implements WebServiceMock {
    global void doInvoke(
        Object stub, Object request, Map<String, Object> response, String endpoint,
        String soapAction, String requestName, String responseNS, String responseName, String responseType
    ) {
        BillingService.CreateAccountResponse_element result = new BillingService.CreateAccountResponse_element();
        result.accountNumber = 'BILL-1';
        response.put('response_x', result);
    }
}
```

```apex
Test.setMock(WebServiceMock.class, new BillingWebServiceMock());
```

## Testing continuations

```apex
@IsTest
private class SlowServiceControllerTest {
    @IsTest
    static void callbackParsesResponse() {
        Continuation con = (Continuation) SlowServiceController.startRequest();
        HttpResponse res = new HttpResponse();
        res.setStatusCode(200);
        res.setBody('{"quote":42}');

        // Map the mock response to the continuation's request label, then invoke the callback.
        Map<String, HttpRequest> requests = con.getRequests();
        Assert.areEqual(1, requests.size(), 'One callout expected in this continuation');
        String label = new List<String>(requests.keySet())[0];
        Test.setContinuationResponse(label, res);

        Object result = Test.invokeContinuationMethod(new SlowServiceController(), con);
        Assert.areEqual('{"quote":42}', (String) result, 'Callback must return the response body');
    }
}
```

## Contract tests against a real org

Unit tests prove your Apex; contract tests prove the wire format. Run these outside the Apex test
framework, against a sandbox, as part of `vf-check smoke`:

```bash
# 1. Inbound contract: does the Apex REST resource still answer with the agreed shape?
sf api request rest "/services/apexrest/order-sync/?externalId=EXT-SMOKE" \
  --method GET --include --target-org vf-int

# 2. Outbound contract: does the named credential reach the sandbox endpoint?
sf apex run --file scripts/apex/probe-named-credential.apex --target-org vf-int --json

# 3. Event contract: publish a probe event and confirm the subscriber logged it.
sf api request rest "/services/data/v67.0/sobjects/Order_Submitted__e" \
  --method POST --body '{"Order_Id__c":"SMOKE","Correlation_Id__c":"vf-smoke-1"}' --target-org vf-int
sf data query --target-org vf-int --query \
  "SELECT Correlation_Id__c, CreatedDate FROM Integration_Log__c WHERE Correlation_Id__c = 'vf-smoke-1'"
```

Rules for contract probes:

| Rule | Reason |
| --- | --- |
| Sandbox or scratch org only | Probes write records and call endpoints |
| Read-only where possible | Prefer GET/query probes; keep writes to dedicated probe records |
| Deterministic identifiers | Prefix probe data (`EXT-SMOKE`, `vf-smoke-*`) so cleanup and assertions are unambiguous |
| Assert on shape, not on counts of production data | Production data drifts; the contract does not |
| Never target a third-party production endpoint | A smoke test must not create real orders or charge cards |

## Local checks

```bash
# Static analysis + Jest, no org required
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local --changed

# Apex tests with coverage gates in a dev org
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-dev \
  --tests BillingGatewayTest,OutboundCalloutJobTest,OrderSyncResourceTest

# Raw CLI equivalent
sf apex run test --tests BillingGatewayTest --tests OutboundCalloutJobTest \
  --code-coverage --result-format json --wait 20 --target-org vf-dev
```

`gates.requireTestForApexClass` means every new integration Apex class needs a test class; the
analyzer step of `vf-check static` enforces the Code Analyzer ruleset in `config/code-analyzer.yml`.

## Cross-references

- Callout limits and the retry engine under test: `callout-and-retry.md`
- Endpoint/credential setup that the mocks stand in for: `named-credentials.md`
- Inbound API payload shapes: `inbound-apis.md`
- Test data factories, assertion style, `Assert` class: skill `sf-apex-testing`
- Org-level verification after deploy: skill `sf-post-deploy-verification`
