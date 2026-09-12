# Anonymous-Apex Smoke Scripts

Every script here is a complete anonymous block, runnable as-is:

```bash
sf apex run --file scripts/apex/smoke-core.apex --target-org vf-int --json
```

Conventions used by all scripts and by `vf-check smoke`:

| Convention | Detail |
| --- | --- |
| Marker lines | `System.debug(LoggingLevel.ERROR, 'VF_PROBE ...')` - `ERROR` level survives default log filters |
| Success marker | final `VF_PROBE_OK <name>` line |
| Failure signal | `throw` - flips `result.success` to `false` and makes the CLI exit non-zero |
| Failure payload | `VF_PROBE_FAIL <reason> | <reason>` - all failures collected, then thrown once |
| Production safety | No DML unless `Organization.IsSandbox = true`, and then only inside a savepoint that is always rolled back |
| No class definitions | Anonymous blocks are statement bodies; keep everything inline so the script always compiles |
| Idempotent | Re-running a probe must not change org state |

Output shape of `sf apex run --json` (fields from `@salesforce/apex-node`
`ExecuteAnonymousResponse` / `ExecAnonApiResponse`):

```json
{
  "status": 0,
  "result": {
    "compiled": true,
    "success": false,
    "logs": "...execution log...",
    "diagnostic": [
      { "lineNumber": 42, "columnNumber": 1, "compileProblem": "",
        "exceptionMessage": "System.IllegalArgumentException: VF_PROBE_FAIL missing object: Order__c",
        "exceptionStackTrace": "AnonymousBlock: line 42, column 1" }
    ]
  }
}
```

## 1. `scripts/apex/smoke-core.apex` - org identity, schema, services, limits

Read-only. Safe in every org including production.

```apex
// VF smoke: core. Read-only. Safe in production.
List<String> failures = new List<String>();

Organization org = [SELECT Id, Name, IsSandbox, OrganizationType, InstanceName FROM Organization LIMIT 1];
System.debug(LoggingLevel.ERROR, 'VF_PROBE org=' + org.Name + ' id=' + org.Id
    + ' sandbox=' + org.IsSandbox + ' type=' + org.OrganizationType + ' instance=' + org.InstanceName);

// --- 1. Objects and fields the story depends on exist and are reachable -----
Map<String, List<String>> required = new Map<String, List<String>>{
    'Account' => new List<String>{ 'Name' },
    'Order__c' => new List<String>{ 'Status__c', 'External_Id__c', 'Amount__c' },
    'Order_Line__c' => new List<String>{ 'Order__c', 'Quantity__c' },
    'Integration_Log__c' => new List<String>{ 'Correlation_Id__c' }
};
Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
for (String objectName : required.keySet()) {
    Schema.SObjectType sobjectType = globalDescribe.get(objectName.toLowerCase());
    if (sobjectType == null) {
        failures.add('missing object: ' + objectName);
        continue;
    }
    Schema.DescribeSObjectResult describe = sobjectType.getDescribe();
    if (!describe.isAccessible()) {
        failures.add('not accessible to the running user: ' + objectName);
    }
    Map<String, Schema.SObjectField> fields = describe.fields.getMap();
    for (String fieldName : required.get(objectName)) {
        if (!fields.containsKey(fieldName.toLowerCase())) {
            failures.add('missing field: ' + objectName + '.' + fieldName);
        }
    }
    System.debug(LoggingLevel.ERROR, 'VF_PROBE object=' + objectName
        + ' queryable=' + describe.isQueryable() + ' createable=' + describe.isCreateable());
}

// --- 3. Service entry points answer without throwing ------------------------
try {
    Integer openOrders = [SELECT COUNT() FROM Order__c WHERE Status__c = 'Open' WITH USER_MODE];
    System.debug(LoggingLevel.ERROR, 'VF_PROBE openOrders=' + openOrders);
} catch (Exception e) {
    failures.add('open order query failed: ' + e.getTypeName() + ' ' + e.getMessage());
}

// Instantiate the deployed service and call a read-only method.
try {
    Object result = OrderService.summarise(null); // read-only summary; no DML
    System.debug(LoggingLevel.ERROR, 'VF_PROBE OrderService.summarise=' + String.valueOf(result));
} catch (System.TypeException te) {
    failures.add('OrderService missing or signature changed: ' + te.getMessage());
} catch (Exception e) {
    failures.add('OrderService.summarise threw: ' + e.getTypeName() + ' ' + e.getMessage());
}

// --- 4. Org limits headroom -------------------------------------------------
Map<String, System.OrgLimit> orgLimits = System.OrgLimits.getMap();
for (String limitName : new List<String>{ 'DailyApiRequests', 'DailyAsyncApexExecutions', 'DataStorageMB' }) {
    System.OrgLimit orgLimit = orgLimits.get(limitName);
    if (orgLimit == null) { continue; }
    Integer max = orgLimit.getLimit();
    Decimal usedPercent = max == 0 ? 0 : (Decimal.valueOf(orgLimit.getValue()) / max * 100).setScale(1);
    System.debug(LoggingLevel.ERROR, 'VF_PROBE limit=' + limitName
        + ' used=' + orgLimit.getValue() + ' max=' + max + ' pct=' + usedPercent);
    if (usedPercent > 90) {
        failures.add('limit above 90 percent: ' + limitName + ' (' + usedPercent + '%)');
    }
}

// --- 5. Verdict -------------------------------------------------------------
if (!failures.isEmpty()) {
    throw new System.IllegalArgumentException('VF_PROBE_FAIL ' + String.join(failures, ' | '));
}
System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-core');
```

## 2. `scripts/apex/smoke-permissions.apex` - CRUD/FLS and assignments

Read-only. `Schema` describes reflect the running user's effective permissions, which is exactly what
a permission change must be verified against.

```apex
// VF smoke: permissions. Read-only.
List<String> failures = new List<String>();

// Expected object-level access for the running user (the integration or admin user).
Map<String, String> expectedObjectAccess = new Map<String, String>{
    'Order__c' => 'CRU',        // create, read, update
    'Order_Line__c' => 'CRU',
    'Integration_Log__c' => 'CR'
};

Map<String, Schema.SObjectType> globalDescribe = Schema.getGlobalDescribe();
for (String objectName : expectedObjectAccess.keySet()) {
    Schema.SObjectType sobjectType = globalDescribe.get(objectName.toLowerCase());
    if (sobjectType == null) {
        failures.add('missing object: ' + objectName);
        continue;
    }
    Schema.DescribeSObjectResult d = sobjectType.getDescribe();
    String expected = expectedObjectAccess.get(objectName);
    if (expected.contains('C') && !d.isCreateable()) { failures.add(objectName + ' not createable'); }
    if (expected.contains('R') && !d.isAccessible()) { failures.add(objectName + ' not readable'); }
    if (expected.contains('U') && !d.isUpdateable()) { failures.add(objectName + ' not updateable'); }
    if (!expected.contains('D') && d.isDeletable()) {
        System.debug(LoggingLevel.ERROR, 'VF_PROBE warn=' + objectName + ' is deletable but was not expected to be');
    }
    System.debug(LoggingLevel.ERROR, 'VF_PROBE access=' + objectName
        + ' C=' + d.isCreateable() + ' R=' + d.isAccessible()
        + ' U=' + d.isUpdateable() + ' D=' + d.isDeletable());
}

// Field-level security on sensitive fields.
Map<String, Schema.SObjectField> orderFields =
    globalDescribe.get('order__c').getDescribe().fields.getMap();
for (String fieldName : new List<String>{ 'Amount__c', 'Status__c' }) {
    Schema.SObjectField field = orderFields.get(fieldName.toLowerCase());
    if (field == null) {
        failures.add('missing field: Order__c.' + fieldName);
        continue;
    }
    Schema.DescribeFieldResult fd = field.getDescribe();
    System.debug(LoggingLevel.ERROR, 'VF_PROBE field=Order__c.' + fieldName
        + ' readable=' + fd.isAccessible() + ' updateable=' + fd.isUpdateable());
    if (!fd.isAccessible()) { failures.add('field not readable: Order__c.' + fieldName); }
}

// Permission set assignments landed.
Map<String, Integer> assignmentCounts = new Map<String, Integer>();
for (AggregateResult row : [
    SELECT PermissionSet.Name name, COUNT(Id) total FROM PermissionSetAssignment
    WHERE PermissionSet.Name IN ('Order_Management', 'Billing_Integration') GROUP BY PermissionSet.Name
]) {
    assignmentCounts.put((String) row.get('name'), (Integer) row.get('total'));
}
for (String permissionSetName : new List<String>{ 'Order_Management', 'Billing_Integration' }) {
    Integer count = assignmentCounts.get(permissionSetName);
    System.debug(LoggingLevel.ERROR, 'VF_PROBE permset=' + permissionSetName + ' assignments=' + count);
    if (count == null || count == 0) { failures.add('no assignments for permission set: ' + permissionSetName); }
}

if (!failures.isEmpty()) {
    throw new System.IllegalArgumentException('VF_PROBE_FAIL ' + String.join(failures, ' | '));
}
System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-permissions');
```

## 3. `scripts/apex/smoke-integration.apex` - named credential reachability

Makes callouts. Sandbox endpoints only. Aborts before calling out when the org is not a sandbox, so
the same script is safe to schedule against any alias.

```apex
// VF smoke: integration. Performs callouts - sandbox endpoints only.
List<String> failures = new List<String>();

Organization org = [SELECT Id, IsSandbox FROM Organization LIMIT 1];
if (!org.IsSandbox) {
    // Production probes must not call partner endpoints; verify credentials by metadata instead.
    System.debug(LoggingLevel.ERROR, 'VF_PROBE skipped=callouts reason=not-a-sandbox');
    System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-integration (skipped)');
} else {
    Map<String, String> healthChecks = new Map<String, String>{  // credential => health path
        'Billing_API' => '/v1/health', 'Pricing_API' => '/status'
    };

    for (String credentialName : healthChecks.keySet()) {
        Long startedAt = System.currentTimeMillis();
        try {
            HttpRequest req = new HttpRequest();
            req.setEndpoint('callout:' + credentialName + healthChecks.get(credentialName));
            req.setMethod('GET');
            req.setHeader('X-Correlation-Id', 'vf-smoke-' + credentialName);
            req.setTimeout(10000);
            HttpResponse res = new Http().send(req);
            System.debug(LoggingLevel.ERROR, 'VF_PROBE callout=' + credentialName
                + ' status=' + res.getStatusCode() + ' ms=' + (System.currentTimeMillis() - startedAt));
            if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
                failures.add(credentialName + ' health check returned ' + res.getStatusCode());
            }
        } catch (System.CalloutException ce) {
            failures.add(credentialName + ' callout failed: ' + ce.getMessage());
        }
    }

    // Dead letters must be empty after a deploy.
    Integer newDeadLetters = [
        SELECT COUNT() FROM Integration_Dead_Letter__c WHERE Status__c = 'New' AND CreatedDate = TODAY
    ];
    System.debug(LoggingLevel.ERROR, 'VF_PROBE deadLetters=' + newDeadLetters);
    if (newDeadLetters > 0) { failures.add('new dead letters today: ' + newDeadLetters); }

    // Event publishing allocations.
    Map<String, System.OrgLimit> orgLimits = System.OrgLimits.getMap();
    for (String limitName : new List<String>{ 'HourlyPublishedPlatformEvents', 'DailyDeliveredPlatformEvents' }) {
        System.OrgLimit orgLimit = orgLimits.get(limitName);
        if (orgLimit == null) { continue; }
        System.debug(LoggingLevel.ERROR, 'VF_PROBE limit=' + limitName
            + ' used=' + orgLimit.getValue() + ' max=' + orgLimit.getLimit());
    }

    if (!failures.isEmpty()) {
        throw new System.CalloutException('VF_PROBE_FAIL ' + String.join(failures, ' | '));
    }
    System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-integration');
}
```

## 4. `scripts/apex/smoke-schema.apex` - fields, picklists, record types

Read-only.

```apex
// VF smoke: schema. Read-only.
List<String> failures = new List<String>();

Schema.SObjectType orderType = Schema.getGlobalDescribe().get('order__c');
if (orderType == null) {
    throw new System.IllegalArgumentException('VF_PROBE_FAIL missing object: Order__c');
}
Schema.DescribeSObjectResult orderDescribe = orderType.getDescribe();

// --- Picklist value set -----------------------------------------------------
Set<String> expectedStatuses = new Set<String>{ 'Draft', 'Open', 'Shipped', 'Cancelled' };
Set<String> actualStatuses = new Set<String>();
Schema.SObjectField statusField = orderDescribe.fields.getMap().get('status__c');
if (statusField == null) {
    failures.add('missing field: Order__c.Status__c');
} else {
    for (Schema.PicklistEntry entry : statusField.getDescribe().getPicklistValues()) {
        if (entry.isActive()) { actualStatuses.add(entry.getValue()); }
    }
    System.debug(LoggingLevel.ERROR, 'VF_PROBE statuses=' + actualStatuses);
    Set<String> missing = new Set<String>(expectedStatuses);
    missing.removeAll(actualStatuses);
    if (!missing.isEmpty()) { failures.add('missing picklist values on Order__c.Status__c: ' + missing); }
}

// --- Record types available to the running user -----------------------------
Set<String> availableRecordTypes = new Set<String>();
for (Schema.RecordTypeInfo info : orderDescribe.getRecordTypeInfos()) {
    if (info.isAvailable() && !info.isMaster()) { availableRecordTypes.add(info.getDeveloperName()); }
}
System.debug(LoggingLevel.ERROR, 'VF_PROBE recordTypes=' + availableRecordTypes);
Set<String> missingRecordTypes = new Set<String>{ 'Standard', 'Expedited' };
missingRecordTypes.removeAll(availableRecordTypes);
if (!missingRecordTypes.isEmpty()) {
    failures.add('record types unavailable to the running user: ' + missingRecordTypes);
}

// --- Relationship integrity and external id uniqueness ----------------------
Integer orphanLines = [SELECT COUNT() FROM Order_Line__c WHERE Order__c = null];
System.debug(LoggingLevel.ERROR, 'VF_PROBE orphanOrderLines=' + orphanLines);
if (orphanLines > 0) { failures.add('orphan Order_Line__c rows: ' + orphanLines); }

List<AggregateResult> duplicates = [
    SELECT External_Id__c externalId, COUNT(Id) total FROM Order__c
    WHERE External_Id__c != null GROUP BY External_Id__c HAVING COUNT(Id) > 1 LIMIT 5
];
if (!duplicates.isEmpty()) {
    failures.add('duplicate External_Id__c values found: ' + duplicates.size() + ' (showing max 5)');
}

if (!failures.isEmpty()) {
    throw new System.IllegalArgumentException('VF_PROBE_FAIL ' + String.join(failures, ' | '));
}
System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-schema');
```

## 5. `scripts/apex/smoke-config.apex` - custom metadata, flags, jobs, flows

Read-only.

```apex
// VF smoke: configuration. Read-only.
List<String> failures = new List<String>();

// --- Custom metadata rows ---------------------------------------------------
Map<String, Integration_Setting__mdt> settings = new Map<String, Integration_Setting__mdt>();
for (Integration_Setting__mdt row : [
    SELECT DeveloperName, Endpoint_Path__c, Is_Enabled__c, Max_Attempts__c FROM Integration_Setting__mdt
]) {
    settings.put(row.DeveloperName, row);
}
for (String developerName : new List<String>{ 'Billing_API', 'Pricing_API' }) {
    Integration_Setting__mdt row = settings.get(developerName);
    if (row == null) {
        failures.add('missing custom metadata row: Integration_Setting__mdt.' + developerName);
        continue;
    }
    if (row.Max_Attempts__c == null || row.Max_Attempts__c <= 0) {
        failures.add('invalid Max_Attempts__c on ' + developerName);
    }
    System.debug(LoggingLevel.ERROR, 'VF_PROBE setting=' + developerName
        + ' enabled=' + row.Is_Enabled__c + ' maxAttempts=' + row.Max_Attempts__c);
}

// --- Hierarchy custom setting defaults --------------------------------------
Feature_Flags__c flags = Feature_Flags__c.getOrgDefaults();
if (flags == null || flags.Id == null) {
    failures.add('Feature_Flags__c org defaults row missing');
} else {
    System.debug(LoggingLevel.ERROR, 'VF_PROBE flags newOrderRouting=' + flags.New_Order_Routing__c);
}

// --- Scheduled jobs ---------------------------------------------------------
Map<String, CronTrigger> scheduled = new Map<String, CronTrigger>();
for (CronTrigger job : [
    SELECT Id, State, CronExpression, NextFireTime, PreviousFireTime, TimesTriggered,
           CronJobDetail.Name, CronJobDetail.JobType
    FROM CronTrigger
]) {
    scheduled.put(job.CronJobDetail.Name, job);
    System.debug(LoggingLevel.ERROR, 'VF_PROBE job=' + job.CronJobDetail.Name
        + ' state=' + job.State + ' next=' + job.NextFireTime + ' fired=' + job.TimesTriggered);
}
for (String jobName : new List<String>{ 'VF Nightly Order Sync' }) {
    CronTrigger job = scheduled.get(jobName);
    if (job == null) {
        failures.add('scheduled job not found: ' + jobName);
    } else if (job.NextFireTime == null || job.NextFireTime < Datetime.now()) {
        failures.add('scheduled job has no future fire time: ' + jobName);
    }
}

// --- Active flow versions ---------------------------------------------------
for (FlowDefinitionView flow : [
    SELECT ApiName, Label, IsActive, ProcessType, TriggerType, ActiveVersionId
    FROM FlowDefinitionView WHERE ApiName IN ('Order_Routing', 'Order_Notification')
]) {
    System.debug(LoggingLevel.ERROR, 'VF_PROBE flow=' + flow.ApiName + ' active=' + flow.IsActive
        + ' type=' + flow.ProcessType + ' trigger=' + flow.TriggerType);
    if (!flow.IsActive) { failures.add('flow is not active: ' + flow.ApiName); }
}

// --- Failed async jobs today ------------------------------------------------
Integer failedJobs = [
    SELECT COUNT()
    FROM AsyncApexJob
    WHERE Status IN ('Failed', 'Aborted') AND CreatedDate = TODAY
];
System.debug(LoggingLevel.ERROR, 'VF_PROBE failedAsyncJobsToday=' + failedJobs);
if (failedJobs > 0) {
    failures.add('failed or aborted async jobs today: ' + failedJobs);
}

if (!failures.isEmpty()) {
    throw new System.IllegalArgumentException('VF_PROBE_FAIL ' + String.join(failures, ' | '));
}
System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-config');
```

## 6. `scripts/apex/smoke-write-rollback.apex` - exercise DML without persisting

The only probe allowed to touch DML. It refuses to run outside a sandbox and always rolls back, so
trigger, flow, and validation-rule behaviour is exercised with zero residue.

```apex
// VF smoke: write path with guaranteed rollback. Sandbox only.
List<String> failures = new List<String>();

Organization org = [SELECT Id, IsSandbox FROM Organization LIMIT 1];
if (!org.IsSandbox) {
    System.debug(LoggingLevel.ERROR, 'VF_PROBE skipped=write-path reason=not-a-sandbox');
    System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-write-rollback (skipped)');
} else {
    System.Savepoint savepoint = Database.setSavepoint();
    try {
        Account account = new Account(Name = 'VF Smoke Account ' + Datetime.now().getTime());
        insert as user account;

        Order__c order = new Order__c(
            External_Id__c = 'VF-SMOKE-' + Datetime.now().getTime(), Status__c = 'Draft', Amount__c = 100
        );
        insert as user order;

        // The trigger/flow under test should have derived something on insert.
        Order__c reloaded = [
            SELECT Id, Status__c, Amount__c, Order_Number__c
            FROM Order__c WHERE Id = :order.Id WITH USER_MODE LIMIT 1
        ];
        System.debug(LoggingLevel.ERROR, 'VF_PROBE insertedOrder status=' + reloaded.Status__c
            + ' number=' + reloaded.Order_Number__c);
        if (String.isBlank(reloaded.Order_Number__c)) {
            failures.add('Order_Number__c was not populated by automation on insert');
        }

        // Exercise the state transition the story added.
        reloaded.Status__c = 'Open';
        update as user reloaded;
        Order__c afterUpdate = [
            SELECT Id, Status__c, Opened_On__c FROM Order__c WHERE Id = :reloaded.Id WITH USER_MODE LIMIT 1
        ];
        System.debug(LoggingLevel.ERROR, 'VF_PROBE updatedOrder status=' + afterUpdate.Status__c
            + ' openedOn=' + afterUpdate.Opened_On__c);
        if (afterUpdate.Opened_On__c == null) {
            failures.add('Opened_On__c was not stamped when Status__c moved to Open');
        }

        // Negative check: the validation rule must reject an invalid transition.
        Boolean rejected = false;
        try {
            afterUpdate.Status__c = 'Draft';
            update as user afterUpdate;
        } catch (DmlException expected) { rejected = true; }
        if (!rejected) { failures.add('validation rule did not reject Open -> Draft'); }
    } catch (Exception e) {
        failures.add('write path threw: ' + e.getTypeName() + ' ' + e.getMessage());
    } finally {
        // Always roll back: the probe must leave no records behind.
        Database.rollback(savepoint);
        System.debug(LoggingLevel.ERROR, 'VF_PROBE rolledBack=true');
    }

    if (!failures.isEmpty()) {
        throw new System.IllegalArgumentException('VF_PROBE_FAIL ' + String.join(failures, ' | '));
    }
    System.debug(LoggingLevel.ERROR, 'VF_PROBE_OK smoke-write-rollback');
}
```

Savepoint caveats: platform events published with `Publish Immediately` and any completed callout
are **not** undone by `Database.rollback`. Keep event publishing and callouts out of this probe, or
point them at a sandbox-safe target.

## 7. Parsing probe output

```bash
# Run a probe and fail the shell on an unsuccessful execution.
run_probe() {
  local file="$1" alias="$2"
  local out
  out="$(sf apex run --file "$file" --target-org "$alias" --json)"
  echo "$out" | jq -r '.result.logs' | grep -E '^.*VF_PROBE' || true
  local ok
  ok="$(echo "$out" | jq -r '.result.success')"
  if [ "$ok" != "true" ]; then
    echo "$out" | jq -r '.result.diagnostic[]? | "FAIL line \(.lineNumber): \(.exceptionMessage // .compileProblem)"'
    return 1
  fi
}

run_probe scripts/apex/smoke-core.apex vf-int
run_probe scripts/apex/smoke-config.apex vf-int
```

| Signal | Meaning | Runner action |
| --- | --- | --- |
| `result.compiled = false` | The probe does not compile against the deployed metadata - usually a renamed field or method | Finding severity `error`; exit 1 |
| `result.success = false` with `VF_PROBE_FAIL` | Probe assertions failed | Finding per `|`-separated reason; exit 1 |
| `result.success = false` without a marker | Unexpected runtime exception | Finding with the raw `exceptionMessage`; exit 1 |
| `VF_PROBE_OK <name>` present | Probe passed | Finding severity `info` |
| `VF_PROBE skipped=` present | Probe intentionally skipped (production) | Finding severity `warning`, does not fail the gate |
| CLI exit 1 with a connection error | Org/network problem, not a gate failure | Runner maps it to exit code 3 |

## 8. Probe authoring checklist

- [ ] Runs read-only, or guards DML behind `Organization.IsSandbox` and a rolled-back savepoint.
- [ ] Collects every failure in a list and throws once, so one run reports all problems.
- [ ] Emits `VF_PROBE` marker lines at `LoggingLevel.ERROR` for each fact it establishes.
- [ ] Ends with `VF_PROBE_OK <name>` on the success path.
- [ ] References only metadata the story actually deployed (no aspirational fields).
- [ ] Uses `WITH USER_MODE` / `insert as user` so it verifies the permissions a real user has.
- [ ] Contains no secrets, no production endpoints, and no hardcoded record ids from another org.
- [ ] Is idempotent: re-running changes nothing.
- [ ] Lives in `scripts/apex/` of the consumer project and is committed with the story.

## Cross-references

- Which probe to run for which change: `verification-catalogue.md`
- Query library for the checks above: `org-health-queries.md`
- Reading failures: `failure-triage.md`
- Callout probes and credential setup: skill `sf-integration-patterns`
- Apex test-mode assertions (`System.runAs`, `Assert`): skill `sf-apex-testing`
- Debug log capture while probing: skill `sf-debugging-logs`
