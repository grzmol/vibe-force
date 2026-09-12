# Bulk API and Bulk API 2.0 limits and allocations

Source: Salesforce Developer Limits and Allocations Quick Reference, "Bulk API and Bulk API 2.0
Limits and Allocations", Summer '26 / API version 67.0
(`atlas.en-us.262.0.salesforce_app_limits_cheatsheet.meta`).

## When Bulk API 2.0 is the right tool

> Any data operation that includes more than 2,000 records is a good candidate for Bulk API 2.0 to
> successfully prepare, execute, and manage an asynchronous workflow that makes use of the Bulk
> framework. Jobs with fewer than 2,000 records should involve "bulkified" synchronous calls in
> REST (for example, Composite) or SOAP.

## Batch allocations

You can submit up to **15,000 batches per rolling 24-hour period**. This allocation is **shared**
between Bulk API and Bulk API 2.0: every batch processed in either counts toward it.

- In Bulk API 2.0, only **ingest** jobs consume batches. Query jobs do not.
- In Bulk API 2.0, batches are created **for you automatically**.
- In Bulk API 1.0, you create the batches yourself.

That asymmetry is the practical argument for 2.0: a 1.0 load built from 10,000-record batches eats
the shared allocation far faster than it needs to.

## General limits

| Item | Bulk API | Bulk API 2.0 |
| --- | --- | --- |
| Batch and job lifespan | Batches and jobs older than 7 days are removed from the queue if batches are in a terminal state (completed, aborted, failed), regardless of job status. The 7 days are measured from the youngest batch associated with a job, or from the job's age if it has no batches. You **cannot** create batches associated with a job more than 24 hours old. Batches in a non-terminal state older than 7 days are periodically cleaned up with their jobs | Jobs in a terminal state (completed, aborted, failed) older than 7 days are deleted. Jobs in a non-terminal state older than 7 days are periodically cleaned up |
| Binary content | File name at most 512 bytes. Zip file at most 10 MB. Unzipped content at most 20 MB. At most 1,000 files in a zip; directories do not count | N/A |
| Maximum time a job can remain open | 24 hours | 24 hours, but only for ingest jobs, not query jobs |

## Limits specific to ingest jobs

| Item | Bulk API | Bulk API 2.0 |
| --- | --- | --- |
| Maximum records uploaded per 24-hour rolling period | 150,000,000 (15,000 batches x 10,000 records per batch maximum) | 150,000,000 |
| Batch processing time | Batches are processed in chunks. Chunk size is 100 records in API 20.0 and earlier, **200 records in API 21.0 and later**. Start with the maximum batch size of 10,000 records and adjust by observed processing time. A batch that takes too long times out and returns an error - reduce the batch size and resubmit. A job that takes only seconds should use a larger batch. Avoid small batches: they increase the total batch count and the risk of hitting the daily allocation | Same as Bulk API |
| Maximum time before a batch is retried | 5 minutes | The API handles retries automatically. A message saying it retried more than **20 times** means you should use a smaller upload file and try again |
| Results lifespan | Success, failed and unprocessed records retrievable within **7 days** of job completion, unless the job is explicitly deleted | Same as Bulk API |
| Maximum file size | 10 MB per batch | **150 MB per job** of base64-encoded content |
| Maximum characters in a field | 131,072 | Same |
| Maximum fields in a record | 5,000 | Same |
| Maximum characters in a record | 400,000 | Same |
| Maximum records in a batch | 10,000 | N/A - batches are automatic |
| Maximum characters for all data in a batch | 10,000,000 | N/A |

### The base64 trap

The guide's note on the 150 MB figure: a request can provide CSV data that does not in total exceed
150 MB of **base64-encoded** content. When job data is uploaded it is converted to base64, and that
conversion can increase the data size by approximately **50%**. To account for the increase, upload
data that does not exceed **100 MB**.

Plan chunk sizes against 100 MB, not 150 MB.

## Limits specific to query jobs

| Item | Bulk API | Bulk API 2.0 |
| --- | --- | --- |
| Number of attempts to query | 30 attempts at 5 minutes each to process the batch, plus a 2-minute limit on query processing time. More than 30 attempts returns "Tried more than thirty times"; over 2 minutes returns `QUERY_TIMEOUT` | The API handles retries automatically. A message saying it retried more than **15 times** means you should apply filter criteria and try again |
| Batch size | Without PK chunking, only one batch is created. With PK chunking enabled, batches are broken up by the number of records in the chunk, ranging from **100,000 to 250,000** records. A chunk size between 100,000 and 250,000 is recommended, because smaller chunks can produce empty batches | The API handles batch management automatically |
| Number of retrieved files | 15 files. If the query returns more, add filters to return less data. Bulk batch sizes are not used for bulk queries | N/A |
| Timeout for retrieving query results | 20 minutes | Same as Bulk API |
| Results lifespan | Retrievable within 7 days of job completion | Same as Bulk API |

## Interaction with Apex governor limits

Two facts from the Apex Developer Guide that matter when a load triggers automation:

1. For Bulk API and Bulk API 2.0 transactions, the effective per-transaction limit is **the higher**
   of the synchronous and asynchronous limits. Example given in the guide: the maximum number of
   Bulk Apex jobs added with `System.enqueueJob` is the synchronous limit (50), which is higher than
   the asynchronous limit (1).
2. Bulk API and Bulk API 2.0 consume a **unique governor limit for CPU time** on Salesforce servers,
   with a maximum value of 60,000 ms.

A load still fires triggers, flows and validation rules for every record. If a trigger is not bulk
safe, the load is where you find out. See skill `sf-governor-limits`.

## Planning arithmetic

| Question | Calculation |
| --- | --- |
| How many 24-hour periods does my load need? | `records / 150,000,000`, and separately `batches / 15,000` |
| How big should each file be? | Under 100 MB of raw CSV, to stay under 150 MB after base64 |
| How many records per file? | `100 MB / average record size in bytes`. A 400-character record is roughly 250,000 records per 100 MB |
| Will the job finish inside its window? | A job may stay open for 24 hours. Query results must be retrieved within 20 minutes and stay available for 7 days |
| Can I re-run tomorrow? | Only if every row carries a unique external id and the load is an upsert |

## Checks before a large load

- [ ] Records counted at source and target, recorded before the load
- [ ] Every row carries a unique external id, and the field is marked External ID and Unique
- [ ] Files under 100 MB each
- [ ] Estimated batch count under the remaining share of the 15,000 daily allocation
- [ ] Triggers, flows and validation rules on the target object reviewed for bulk safety
- [ ] Target is not a production alias, or `VF_ALLOW_PROD=1` was set deliberately
- [ ] `--wait` set, or the job id captured for `sf data bulk results`
- [ ] A rollback plan: for an insert, the list of created ids; for an update, the exported prior values
