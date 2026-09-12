# `Limits` and `OrgLimits` API

Source: Apex Reference Guide, `Limits`, `OrgLimit` and `OrgLimits` classes, Summer '26 / API
version 67.0 (`atlas.en-us.262.0.apexref.meta`).

`Limits` reports **Apex governor limits** for the current transaction. `OrgLimits` reports
**Salesforce API limits** for the org (SOAP API requests, Bulk API requests, Streaming API and so
on). They are different things and are not interchangeable.

## `System.Limits`

Every method is `public static Integer` and takes no arguments. Methods pair up: `getX()` is what
has been consumed so far in this transaction, `getLimitX()` is the ceiling.

### Queries and rows

| Consumed | Ceiling | Meaning |
| --- | --- | --- |
| `getQueries()` | `getLimitQueries()` | SOQL queries issued |
| `getQueryRows()` | `getLimitQueryRows()` | Records returned by SOQL queries |
| `getAggregateQueries()` | `getLimitAggregateQueries()` | Aggregate queries processed with any SOQL statement. The ceiling is also the parent-child subquery limit: 3x the top-level query limit |
| `getQueryLocatorRows()` | `getLimitQueryLocatorRows()` | Records returned by `Database.getQueryLocator` |
| `getSoslQueries()` | `getLimitSoslQueries()` | SOSL queries issued |

### DML

| Consumed | Ceiling | Meaning |
| --- | --- | --- |
| `getDmlStatements()` | `getLimitDmlStatements()` | DML statements and `Database.emptyRecycleBin` calls made |
| `getDmlRows()` | `getLimitDmlRows()` | Records processed by any statement that counts against DML limits |
| `getPublishImmediateDML()` | `getLimitPublishImmediateDML()` | `EventBus.publish` calls for publish-immediately platform events |

### Resources

| Consumed | Ceiling | Meaning |
| --- | --- | --- |
| `getCpuTime()` | `getLimitCpuTime()` | CPU time in milliseconds used in the current transaction |
| `getHeapSize()` | `getLimitHeapSize()` | Approximate heap memory in bytes |
| `getCallouts()` | `getLimitCallouts()` | Web service statements processed |
| `getEmailInvocations()` | `getLimitEmailInvocations()` | Email invocations such as `sendEmail` |
| `getMobilePushApexCalls()` | `getLimitMobilePushApexCalls()` | Apex calls used by mobile push notifications in the current metering interval |

### Async

| Consumed | Ceiling | Meaning |
| --- | --- | --- |
| `getFutureCalls()` | `getLimitFutureCalls()` | `@future` methods executed (not necessarily completed) |
| `getQueueableJobs()` | `getLimitQueueableJobs()` | Queueable jobs added to the queue this transaction |
| `getAsyncCalls()` | `getLimitAsyncCalls()` | Reserved for future use - do not rely on these |

### Cursors

| Consumed | Ceiling | Meaning |
| --- | --- | --- |
| `getApexCursors()` | `getLimitApexCursors()` | Apex cursors created; the ceiling is per 24-hour period |
| `getApexCursorRows()` | `getLimitApexCursorRows()` | Rows returned by an Apex cursor |
| `getApexPaginationCursors()` | `getLimitApexPaginationCursors()` | Pagination cursors created; ceiling is per 24-hour period |
| `getApexPaginationCursorRows()` | `getLimitApexPaginationCursorRows()` | Rows returned by a pagination cursor |
| `getFetchCallsOnApexCursor()` | `getLimitFetchCallsOnApexCursor()` | `fetch` calls made on an Apex cursor |

### Deprecated - do not use in new code

| Method | Returns |
| --- | --- |
| `getFindSimilarCalls()` / `getLimitFindSimilarCalls()` | Same as `getSoslQueries()` / `getLimitSoslQueries()` |
| `getRunAs()` / `getLimitRunAs()` | Same as `getDmlStatements()` / `getLimitDmlStatements()` |
| `getSavepoints()` / `getLimitSavepoints()` | Same as `getDmlStatements()` / `getLimitDmlStatements()` |
| `getSavepointRollbacks()` / `getLimitSavepointRollbacks()` | Same as `getDmlStatements()` / `getLimitDmlStatements()` |
| `getChildRelationshipsDescribes()` | Number of child relationship objects returned |

## `System.OrgLimits`

| Method | Signature | Returns |
| --- | --- | --- |
| `getAll()` | `public static List<System.OrgLimit> getAll()` | A list of every org limit |
| `getMap()` | `public static Map<String, System.OrgLimit>` | The same limits keyed by name |

## `System.OrgLimit`

| Method | Signature | Returns |
| --- | --- | --- |
| `getName()` | `public String getName()` | The limit's name |
| `getValue()` | `public Integer getValue()` | Current usage |
| `getLimit()` | `public Integer getLimit()` | Maximum allowed value |
| `toString()` | `public String toString()` | String representation |

Org limit values are updated **asynchronously, in near-real-time**. Do not build a tight control
loop on them; use them for capacity checks and reporting.

## Usage recipes

### A budget probe you can paste into anonymous Apex

```apex
void report(String tag) {
    System.debug(LoggingLevel.INFO, String.format(
        '{0} | SOQL {1}/{2} | rows {3}/{4} | DML {5}/{6} | heap {7}/{8} | CPU {9}/{10}',
        new List<Object>{
            tag,
            Limits.getQueries(), Limits.getLimitQueries(),
            Limits.getQueryRows(), Limits.getLimitQueryRows(),
            Limits.getDmlStatements(), Limits.getLimitDmlStatements(),
            Limits.getHeapSize(), Limits.getLimitHeapSize(),
            Limits.getCpuTime(), Limits.getLimitCpuTime()
        }
    ));
}

report('before');
MyService.doTheWork(someIds);
report('after');
```

### Guarding an unbounded loop

```apex
for (SObject record : records) {
    if (Limits.getDmlRows() > Limits.getLimitDmlRows() - 200) {
        throw new WorkTooLargeException('Split this job; DML row budget nearly spent');
    }
    // ...
}
```

Failing loudly with a clear message beats an uncatchable `LimitException` with no context. Better
still, size the work correctly up front and move it to Batch Apex.

### Asserting bulk safety in a test

```apex
Test.startTest();
Integer q = Limits.getQueries();
Integer d = Limits.getDmlStatements();
MyService.process(twoHundredRecords);
Assert.areEqual(2, Limits.getQueries() - q, 'query count must not scale with input size');
Assert.areEqual(1, Limits.getDmlStatements() - d, 'one DML for the whole collection');
Test.stopTest();
```

`Test.startTest()` resets governor limits so the code under test gets a fresh budget; the counters
you read inside the block belong to that budget. Limits apply individually to each test method.

### Org capacity before a large job

```apex
Map<String, System.OrgLimit> byName = OrgLimits.getMap();
for (String key : new List<String>{ 'DailyAsyncApexExecutions', 'DailyApiRequests' }) {
    System.OrgLimit l = byName.get(key);
    if (l != null) {
        System.debug(l.getName() + ': ' + l.getValue() + ' / ' + l.getLimit());
    }
}
```

The CLI equivalent is `sf org list limits --target-org <alias>`, and the REST equivalent is the
`limits` resource in the REST API Developer Guide.
