# Large Data Volume Read Strategies - Reference

Source of record: *Best Practices for Deployments with Large Data Volumes*, *Bulk API 2.0 and Bulk
API Developer Guide*, Salesforce CLI Command Reference, Apex Developer Guide. URLs at the end of this
file.

## 1. The two levers

Every LDV technique reduces to one of two moves:

1. **Reduce scope** - write narrower, selective queries. A report summarising accounts by city in a
   single state is far cheaper than one summarising by city across all states.
2. **Reduce active data** - archive or discard at the same rate data arrives, so volume stops growing.

Once the retrieved row count is small enough, the platform can use ordinary database constructs -
indexes, de-normalisation - to speed retrieval.

## 2. Search architecture

For data to be searched it must first be indexed. Indexes are built by the search indexing servers.
Salesforce performs an indexed search by first searching the indexes for candidate records, then
narrowing results by access permissions, search limits, and other filters.

When large volumes are added or changed, the search system must index the new information before it
becomes searchable by all users, and that can take a long time. Do not build a post-load verification
step that depends on a SOSL hit immediately after a bulk load; use SOQL against indexed fields
instead.

## 3. SOQL versus SOSL

| | SOQL | SOSL |
| --- | --- | --- |
| Executes with | the database | search indexes |
| Uses the | `query()` call | `search()` call |

Use **SOQL** when you know which objects or fields hold the data, and you want to retrieve data from
one object or related objects, count records matching criteria, sort as part of the query, or read
number, date, or checkbox fields.

Use **SOSL** when you do not know which object or field holds the data and want to find it as
efficiently as possible, when you want to retrieve multiple objects and fields efficiently whether or
not they are related, or when you want data for a particular division using the divisions feature.

Documented trade-offs:

- When a search can be expressed either way, SOSL is generally faster than SOQL if the search
  expression uses a `CONTAINS` term.
- SOSL tokenises multiple terms within a field and indexes the tokens, so searching for a distinct
  term known to exist inside a field is often faster in SOSL. Example: finding `John` in fields
  containing `Paul and John Company`.
- When multiple `WHERE` filters prevent index use even though the fields are indexable, decompose the
  query into several single-filter queries and combine the results in code.
- A `WHERE` filter with null values for picklists or foreign key fields does not use the index. Avoid
  it; design the data model so null is not a valid field value.
- Keep the number of searchable or queryable fields in custom search UIs to a minimum - many fields
  produce many permutations that are hard to tune.

## 4. Rewriting a null-heavy query

The LDV guide's worked example. Original, poor performer:

```sql
SELECT Contact__c, Max_Score__c, CategoryName__c, Category__Team_Name__c
FROM Interest__c
WHERE Contact__c != null
  AND Contact__c IN :contacts
  AND override__c != 0
  AND ((override__c != null AND override__c > 0) OR (score__c != null AND score__c > 0))
  AND Category__c != null
  AND ((Category_Team_IsActive__c = true OR CategoryName__c IN :selectvalues)
       AND (Category_Team_Name__c != null AND Category_Team_Name__c IN :selectTeamValues))
```

Nulls in the criteria prevented index use, and several criteria were redundant. Rewritten:

```sql
SELECT Contact__c, Max_Score__c, CategoryName__c, Category_Team_Name__c
FROM Interest__c
WHERE Contact__c IN :contacts
  AND (override__c > 0 OR score__c > 0)
  AND Category__c != 'Default'
  AND ((Category_Team_IsActive__c = true OR CategoryName__c IN :selectvalues)
       AND Category_Team_Name__c IN :selectTeamValues)
```

The key change: the sentinel value `Default` replaces `NULL` for `Category__c`, which lets an index
be used for that field. `IN :contacts` already implies non-null, so `Contact__c != null` is redundant.

Guard rather than query when a dynamic bind can be null:

```apex
// WRONG - if acctid is null the whole Account table is scanned row by row
List<Account> found = [SELECT Name FROM Account WHERE Account_Id__c = :acctid WITH USER_MODE];
if (found.isEmpty()) { return 'Not Found'; }

// RIGHT
if (acctid == null) { return 'Not Found'; }
List<Account> found = [SELECT Name FROM Account WHERE Account_Id__c = :acctid WITH USER_MODE];
```

## 5. LDV best-practice tables

### Extracting data from the API

| Goal | Best practice |
| --- | --- |
| Use the most efficient operations | use SOAP `getUpdated()` and `getDeleted()` to sync an external system at intervals **greater than 5 minutes**; use outbound messaging for more frequent syncing |
| Handle very large result sets | when a query can return more than one million results, consider the Bulk API 2.0 query capability instead |

### Loading data through the API

| Goal | Best practice |
| --- | --- |
| Balance batch size against timeouts | with SOAP API use as many batches as possible, up to 200, that still avoid network timeouts when records are large or saves entail heavy non-deferrable processing |
| Optimize the connector | use the Lightning Platform Web Service Connector (WSC) rather than other Java API clients such as Axis |
| Minimize parent record-locking conflicts | when changing child records, group them by parent - group records by `ParentId` in the same batch |
| Defer sharing calculations | use the defer sharing calculation permission until all data is loaded |
| Avoid loading at all | use mashups to couple applications loosely |
| Defer computations and raise throughput | disable Apex triggers, workflow rules, and validations during loads; process records afterwards with Batch Apex |

### Searching

| Goal | Best practice |
| --- | --- |
| Reduce records returned | keep searches specific and avoid wildcards. Search `Michael`, not `Mi*` |
| Reduce joins | use single-object searches for speed and accuracy |
| Improve efficiency | enable language optimizations and turn on enhanced lookups and auto-complete for lookup fields |
| Improve search performance | in some cases partition data with divisions |

### SOQL and SOSL

| Goal | Best practice |
| --- | --- |
| Allow indexed searches when multi-filter `WHERE` clauses cannot use indexes | decompose the query. Two indexed fields joined by `OR` can exceed the index threshold; split into two queries and join the results |
| Avoid querying formula fields, computed in real time | if you must, use formulas that avoid dynamic, non-deterministic references |
| Use the right language | see the SOQL versus SOSL table above |
| Avoid null values in a `WHERE` filter for picklists | replace nulls with a sentinel such as `NA` |

## 6. Deletion and the Recycle Bin

Salesforce soft-deletes: records are flagged deleted and made visible through the Recycle Bin. While
soft deleted, the data still occupies the table and must be excluded from every query, so it costs
query time even though it does not count against storage.

| Property | Value |
| --- | --- |
| Recycle Bin retention | 15 days, restorable during that window |
| Recycle Bin size cap | none |
| Storage consumption | soft-deleted items do not count against org storage |
| Hard delete | supported by Bulk API and Bulk API 2.0. Salesforce recommends **Bulk API 2.0 hard delete** for large volumes |
| Exact hard-delete timing after 15 days | not guaranteed |
| Sandbox custom objects | can be truncated with Salesforce Customer Support's help |

Always add `WHERE IsDeleted = false` when gathering selectivity statistics so soft-deleted rows do
not distort the counts.

## 7. Bulk API 2.0 query jobs

Use when a query returns more than roughly 10,000 records, or when the synchronous API times out.

### Chunking

Bulk API 2.0 automatically chunks large query jobs when the queried object supports chunking. This
includes custom objects and Sharing and History tables that support standard objects. No manual batch
configuration is needed. Check the `isPkChunkingSupported` field in the *Get Information About a
Query Job* response to see whether an object supports PK chunking.

### SOQL considerations

- `LIMIT` and `ORDER BY` **disable** PKChunking for SOQL queries. With chunking disabled queries run
  longer and can time out. If a bulk query times out, remove `ORDER BY` and `LIMIT` before any other
  troubleshooting.
- Bulk API 2.0 does not support SOQL containing:
  - `GROUP BY`, `OFFSET`, or `TYPEOF` clauses,
  - aggregate functions such as `COUNT()`,
  - date functions in `GROUP BY` clauses (date functions in `WHERE` clauses are supported),
  - compound address or compound geolocation fields - query the individual components instead.
- Five-level parent-to-child relationship queries are not supported in Bulk API or Bulk API 2.0.

### Paging results

```http
GET /services/data/vXX.X/jobs/query/<queryJobId>/results?maxRecords=50000
GET /services/data/vXX.X/jobs/query/<queryJobId>/results?locator=MTAwMDA&maxRecords=50000
```

The response carries an `Sforce-Locator` header. A non-null value means more results exist; pass it
back as the `locator` parameter. `maxRecords` is optional and caps records per result set.

For query jobs Bulk API 2.0 can compress the response body, reducing network traffic and improving
response time.

### Through the CLI

```bash
# Bulk API 2.0 export to CSV, waiting up to 10 minutes
sf data export bulk --target-org vf-uat \
  --query "SELECT Id, Name, Account.Name FROM Contact" \
  --output-file export-contacts.csv --wait 10

# JSON output, including soft-deleted rows
sf data export bulk --target-org vf-uat \
  --query "SELECT Id, Name FROM Contact" \
  --output-file export-contacts.json --result-format json --wait 10 --all-rows

# Resume a job that outran --wait
sf data export resume --target-org vf-uat --job-id 750XXXXXXXXXXXXXXX

# Read the query from a file instead
sf data export bulk --target-org vf-uat --query-file scripts/soql/contacts.soql \
  --output-file export-contacts.csv --wait 10
```

`--output-file` is required for `sf data export bulk`; `--query` and `--query-file` are mutually
exclusive. `sf data query` warns that results above 10,000 records should use `sf data export bulk`
instead, because Bulk API 2.0 has higher limits than the default API the command uses.

## 8. PK chunking (Bulk API v1 header)

PK chunking splits a bulk query on a large table into chunks bounded by record id. Each chunk becomes
a separate batch that counts against the daily batch limit, and each batch's results must be
downloaded separately.

| Property | Value |
| --- | --- |
| Default chunk size | 100,000 |
| Maximum chunk size | 250,000 |
| Recommended range | 100,000-250,000. Smaller sizes increase the chance of empty batches |
| Default starting id | the first record in the table; override it to restart a job that failed mid-chunking |
| Query restrictions | works only with queries that have no subqueries and no conditions other than `WHERE` |
| Original batch status on success | `NOT_PROCESSED` - monitor the subsequent batches, retrieve each result, then close the job |
| Original batch status on chunking failure | `FAILED`, but chunked batches that were successfully queued still process normally |
| When to enable | tables with more than 10 million records, or a bulk query that consistently times out |

Mechanics: the header adds record-id boundaries with a `WHERE` clause. For a 10,000,000-row Account
table with a chunk size of 250,000 and a starting id of `001300000000000`, the query
`SELECT Name FROM Account` becomes 40 batched queries:

```sql
SELECT Name FROM Account WHERE Id >= 001300000000000 AND Id < 00130000000132G
SELECT Name FROM Account WHERE Id >= 00130000000132G AND Id < 00130000000264W
SELECT Name FROM Account WHERE Id >= 00130000000264W AND Id < 00130000000396m
-- ...
SELECT Name FROM Account WHERE Id >= 00130000000euQ4 AND Id < 00130000000fxSK
```

Boundaries are base-62 id values. Soft-deleted record ids are counted when chunks are computed but
omitted from results, so a chunk can return fewer rows than the chunk size; in some scenarios the net
chunk size can also exceed the specified size. Only a fixed list of objects supports PK chunking -
Account, Case, Contact, Campaign, CampaignMember, Asset, Contract, ContentVersion, ContentDocument,
and others; check `isPkChunkingSupported` rather than relying on memory.

## 9. Apex-side strategies for large reads

| Strategy | Reach | Notes |
| --- | --- | --- |
| SOQL for loop, single sObject | 50,000 rows | keeps the row set off the heap; higher CPU |
| SOQL for loop, `List<sObject>` | 50,000 rows in 200-record batches | correct form when the loop body does DML |
| `Database.getQueryLocator` in Batch Apex | 50,000,000 rows | bypasses the SOQL row limit for the driving query; avoid relationship subqueries so the fast chunked implementation is used |
| `Iterable` in Batch Apex | bounded by the 50,000 SOQL row limit | only for scopes not expressible as one SOQL statement; forces the slow non-chunking implementation |
| `Database.getCursor` + chained Queueable | 50,000,000 rows | 100 `Cursor.fetch()` calls per transaction; no Batch Apex slot consumption |
| Bulk API 2.0 query | millions | out-of-transaction extraction to CSV or JSON |
| Big objects | consistent performance from 1 million to 1 billion records | load with Bulk API or Batch Apex for long-term storage of very large datasets |

Both `Database.getQueryLocator()` and Apex cursors fix the set of record ids at creation time.
Later updates that would remove a record from the `WHERE` clause, and later sharing-rule changes, do
not alter the result set. See skill `sf-async-apex-patterns` for the full Batch and cursor patterns.

## 10. Other LDV techniques worth knowing

| Technique | What it does | Trade-off |
| --- | --- | --- |
| Mashups (external website or callouts) | keep the large dataset in another application and surface it in Salesforce on demand | data is never stale and no proprietary sync is needed, but access is slower and reporting and workflow do not work on external data. Limited to short interactions and small payloads |
| Defer sharing calculation | suspend group membership and sharing rule recalculation during large configuration or data changes, resume during a maintenance window | avoids long sharing evaluations and timeouts during business hours |
| Divisions | partition data to reduce records returned by queries and reports | needs more than one million records in a single object and more than 35 licences; enabled by Support |
| Skinny tables | avoid the standard/custom field join and omit soft-deleted rows | Support-managed, 200 columns, no cross-object fields, not copied to non-Full sandboxes |
| Archiving | move aged records out of the active dataset | keeps volume flat over time |

## 11. Source URLs

- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_introduction.htm
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_techniques_using_soql_sosl.htm
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_techniques_deleting_data.htm
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_best_practices.htm
- https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/queries.htm
- https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/query_get_job_results.htm
- https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/async_api_headers_enable_pk_chunking.htm
- https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_data_commands_unified.htm
- PDF snapshots used while authoring: https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/salesforce_large_data_volumes_bp.pdf, https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/api_asynch.pdf, https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/sfdx_cli_reference.pdf
