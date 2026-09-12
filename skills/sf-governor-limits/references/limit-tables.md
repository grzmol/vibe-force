# Apex limit tables - API version 67.0

Source: Apex Developer Guide, "Execution Governors and Limits", Summer '26 / API version 67.0
(`atlas.en-us.262.0.apexcode.meta`). Reproduced because agents need the exact numbers offline.

Limits are enforced by the runtime. Exceeding one throws a runtime exception that **cannot be
caught and handled**.

## Per-transaction Apex limits

These count for each Apex transaction. For Batch Apex they reset for each execution of a batch of
records in the `execute` method.

| Description | Synchronous | Asynchronous |
| --- | --- | --- |
| Total number of SOQL queries issued [1] | 100 | 200 |
| Total number of records retrieved by SOQL queries | 50,000 | 50,000 |
| Total number of records retrieved by `Database.getQueryLocator` | 10,000 | 10,000 |
| Total number of SOSL queries issued | 20 | 20 |
| Total number of records retrieved by a single SOSL query | 2,000 | 2,000 |
| Total number of DML statements issued [2] | 150 | 150 |
| Total records processed by DML, `Approval.process`, `Database.emptyRecycleBin` | 10,000 | 10,000 |
| Total stack depth for recursive trigger-firing insert/update/delete [3] | 16 | 16 |
| Total number of callouts (HTTP or web service) in a transaction | 100 | 100 |
| Maximum cumulative timeout for all callouts in a transaction | 120 s | 120 s |
| Maximum `@future` methods per Apex invocation | 50 | 0 in batch and future contexts; 50 in queueable context |
| Maximum jobs added to the queue with `System.enqueueJob` | 50 | 1 |
| Total number of `sendEmail` methods allowed | 10 | 10 |
| Total heap size [4] | 6 MB | 12 MB |
| Maximum CPU time on the Salesforce servers [5] | 10,000 ms | 60,000 ms |
| Maximum execution time for each Apex transaction | 10 minutes | 10 minutes |
| Maximum push notification method calls per transaction | 10 | 10 |
| Maximum push notifications sent per push notification method call | 2,000 | 2,000 |
| Maximum `EventBus.publish` calls for publish-immediately platform events | 150 | 150 |
| Maximum rows across all Apex cursors per transaction | 50 million | 50 million |
| Maximum `Cursor.fetch` calls per transaction | 100 | 100 |
| Maximum rows across all Apex pagination cursors per transaction | 100,000 | 100,000 |
| Maximum Apex pagination cursor instances per transaction | 50 | 50 |
| Maximum rows retrieved per page from an Apex pagination cursor | 2,000 | 2,000 |

Notes from the guide:

- Although scheduled Apex is an asynchronous feature, **synchronous limits apply to scheduled Apex
  jobs**.
- For Bulk API and Bulk API 2.0 transactions the effective limit is the **higher** of the
  synchronous and asynchronous limits. Example: the maximum number of Bulk Apex jobs added with
  `System.enqueueJob` is the synchronous limit (50), which is higher than the asynchronous
  limit (1).
- Limits apply individually to each `testMethod`.

### Footnotes

**[1] Queries.** In a SOQL query with parent-child relationship subqueries, each parent-child
relationship counts as an extra query. These queries have a limit of **three times** the number
for top-level queries; that subquery limit is what `Limits.getLimitAggregateQueries()` returns.
Row counts from relationship queries contribute to the overall row count. This limit does **not**
apply to custom metadata types - in a single transaction, custom metadata records can have
unlimited SOQL queries. These methods also count as SOQL statements:

- `Database.countQuery`, `Database.countQueryWithBinds`
- `Database.getQueryLocator`, `Database.getQueryLocatorWithBinds`
- `Database.query`, `Database.queryWithBinds`

**[2] DML.** These count as DML statements:

- `Approval.process`
- `Database.convertLead`
- `Database.emptyRecycleBin`
- `Database.rollback`
- `Database.setSavePoint`
- `delete` and `Database.delete`
- `insert` and `Database.insert`
- `merge` and `Database.merge`
- `undelete` and `Database.undelete`
- `update` and `Database.update`
- `upsert` and `Database.upsert`
- `EventBus.publish` for platform events configured to publish **after commit**
- `System.runAs`

**[3] Stack depth.** Recursive Apex that does not fire triggers exists in a single invocation with
a single stack. Recursive Apex that fires a trigger spawns the trigger in a *new* Apex invocation,
which is a more expensive operation, so the restriction on that kind of recursion is tighter.

**[4] Heap.** Email services heap size is 50 MB. HTTP request and response sizes count toward heap.

**[5] CPU time.** Calculated for all executions on the Salesforce application servers in one Apex
transaction, including package code and workflows called from it. CPU time is private to a
transaction and isolated from other transactions. Application-server CPU spent in DML operations
counts. Operations that do not consume application-server CPU do **not** count: the portion of
execution time spent in the database for DML, SOQL and SOSL is excluded, as is waiting time for
Apex callouts. Bulk API and Bulk API 2.0 consume a unique CPU governor limit with a maximum of
60,000 ms.

## Per-transaction certified managed package limits

Certified managed packages - managed packages that have passed the AppExchange security review -
get their own set of limits for most per-transaction limits. Installing one adds, for example, its
own 150 DML statements and its own 100 synchronous SOQL queries on top of your org's.

There is no limit on the number of certified namespaces invoked in a single transaction, but each
namespace must stay inside the per-transaction limits, and a cumulative cross-namespace limit of
**11x the per-namespace limit** applies.

| Description | Cumulative cross-namespace limit |
| --- | --- |
| Total number of SOQL queries issued | 1,100 |
| Total records retrieved by `Database.getQueryLocator` | 110,000 |
| Total number of SOSL queries issued | 220 |
| Total number of DML statements issued | 1,650 |
| Total number of callouts in a transaction | 1,100 |
| Total number of `sendEmail` methods allowed | 110 |

All per-transaction limits count separately for certified managed packages **except**:

- total heap size
- maximum CPU time
- maximum transaction execution time
- maximum number of unique namespaces

Those four count for the entire transaction regardless of how many certified managed packages run
in it.

Cross-namespace limits apply **only** to certified managed packages. Namespaces in non-certified
packages have no separate governor limits: their resource use counts against the same limits as
your org's custom code.

## Salesforce Platform Apex limits

Not specific to a transaction; enforced by the platform.

| Description | Limit |
| --- | --- |
| Maximum asynchronous Apex method executions (batch, future, queueable, scheduled) per 24 hours - the `DailyAsyncApexExecutions` org limit | 250,000, or the number of applicable user licenses multiplied by 200, whichever is greater |
| Total queueable and future executions enqueueable per 24 hours including throttled elastic executions (beta) - the `DailyAsyncApexElasticExecutions` org limit | The daily async limit plus either the licensed daily limit or 10 million executions, whichever is less |
| Maximum Apex cursors per day | 10,000 |
| Maximum cumulative new cursor rows and pagination cursor rows per 24 hours | 100 million |
| Maximum Apex pagination cursor instances per 24 hours | 200,000 |
| Synchronous concurrent transactions running longer than 5 seconds | Ratio of 100 licenses to 1 concurrent long-running transaction; minimum 10, maximum 50 |
| Maximum Apex classes scheduled concurrently | 100 (5 in Developer Edition) |
| Maximum batch Apex jobs in the flex queue in Holding status | 100 |
| Maximum batch Apex jobs queued or active concurrently | 5 |
| Maximum batch Apex `start` method concurrent executions | 1 |
| Maximum batch jobs submitted in a running test | 5 |
| Maximum test classes queued per 24 hours (production, non-Developer Edition) | The greater of 500, or 10 x the number of test classes in the org |
| Maximum test classes queued per 24 hours (sandbox and Developer Edition) | The greater of 500, or 20 x the number of test classes in the org |

For Batch Apex, "method executions" includes executions of `start`, `execute` and `finish`. The
daily async limit is org-wide and shared across Batch, Queueable, scheduled Apex and future
methods.

If a job needs more async executions than remain in the 24-hour rolling window, an exception is
thrown. Batch Apex pre-checks capacity when `Database.executeBatch` is called and the `start`
method has returned the workload; the batch does not start unless capacity for the entire job is
available, and the remaining executions are left unchanged.

Example of the long-running concurrency ratio: 4,000 licenses gives 40; 5,000 or more gives the
capped maximum of 50; 1,000 or fewer gives the floor of 10. HTTP callout processing time is not
included when calculating this limit.

Check remaining capacity with the REST API `limits` resource, or with `OrgLimits.getAll()` /
`OrgLimits.getMap()` in Apex, or `sf org list limits`.

## Static Apex limits

| Description | Limit |
| --- | --- |
| Default timeout of callouts in a transaction | 10 seconds |
| Maximum size of callout request or response [1] | 6 MB synchronous, 12 MB asynchronous |
| Maximum SOQL query run time before Salesforce cancels the transaction | 120 seconds |
| Maximum class and trigger code units in a deployment of Apex | 7,500 |
| Apex trigger batch size [2] | 200 |
| For loop list batch size | 200 |
| Maximum records returned for a Batch Apex query in `Database.QueryLocator` | 50 million |

**[1]** Request and response sizes count toward total heap size.
**[2]** The trigger batch size for platform events and Change Data Capture events is 2,000. It
does not apply when using Mass Transfer Records.

## Size-specific Apex limits

| Description | Limit |
| --- | --- |
| Maximum characters for a class | 1 million |
| Maximum characters for a trigger | 1 million |
| Maximum code used by all Apex code in an org [1][3][4] | 6 MB |
| Method size limit [2] | 65,535 bytecode instructions in compiled form |

**[1]** Does not apply to Apex in 1GP or 2GP managed packages (separate namespace), nor to any
code in a class annotated `@IsTest`.
**[2]** Methods that exceed the limit throw an exception during execution.
**[3]** The default 6 MB can be raised via a support case.
**[4]** For scratch orgs the limit is 10 MB.

## Miscellaneous Apex limits

| Area | Rule |
| --- | --- |
| Connect in Apex | Every write operation in the `ConnectApi` namespace costs one DML statement. `ConnectApi` calls are also rate limited; most count toward the org's 24-hour API request allocation. Calls that require Chatter are limited per user, per namespace, per hour. Exceeding it throws `ConnectApi.RateLimitException`, which your code must catch. |
| Data.com Clean | Apex triggers on account, contact or lead combined must not exceed 200 SOQL queries per batch or the Clean job for that object fails. Triggers calling future methods are limited to 10 future calls per batch. |
| Event Reports | Maximum records returned: 20,000 for non-admins, 100,000 for system administrators. |
| `MAX_DML_ROWS` in Apex testing | 450,000 rows inserted, updated or deleted in a single synchronous Apex test execution context. Exceeding it produces `Your runallTests is consuming too many DB resources`. |
| SOQL query performance | Use selective queries, especially inside triggers. See skill `sf-soql-sosl-optimization`. |

## Email limits relevant to Apex

### Inbound

| Description | Limit |
| --- | --- |
| Email Services: maximum email messages processed (includes On-Demand Email-to-Case) | User licenses x 1,000; maximum 1,000,000 |
| Email Services: maximum size of email message (body and attachments) | 25 MB |
| On-Demand Email-to-Case: maximum attachment size | 25 MB |

Email service addresses created in a sandbox cannot be copied to production. An email with a 35 MB
attachment will exceed the 25 MB message limit once headers, body and encoding are counted.

### Outbound

Each licensed org can send single emails to a maximum of 5,000 external email addresses per day,
based on Greenwich Mean Time.
