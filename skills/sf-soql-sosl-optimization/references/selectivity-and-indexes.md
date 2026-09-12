# Selectivity, Indexes, and the Query Optimizer - Reference

Source of record: *Best Practices for Deployments with Large Data Volumes*, the Apex Developer Guide
topic `langCon_apex_SOQL_VLSQ`, and the REST API *Query Performance Feedback (Beta)* resource. URLs
at the end of this file.

## 1. What the Lightning Platform query optimizer does

Salesforce is multitenant, so the underlying database optimizer cannot plan tenant queries
effectively. The platform optimizer sits in front of it and works on the generated queries behind
reports, list views, and SOQL. Specifically it:

- determines the best index to drive the query, based on the filters;
- determines the best table to drive from when no good index exists;
- orders the remaining tables to minimise cost;
- injects custom foreign key value tables needed for efficient join paths;
- influences the execution plan for remaining joins, including sharing joins, to minimise database
  I/O;
- updates statistics.

The optimizer maintains a statistics table describing data distribution per index and runs a
**pre-query** against it to decide whether an index would actually help.

Because the platform keeps its own statistics, bulk creates, updates, and deletes through the API
leave the statistics stale until the nightly statistics-gathering process runs. Expect the first day
after a large load to plan worse than the second.

## 2. Threshold arithmetic

| Index kind | Used when the filter matches |
| --- | --- |
| Standard indexed field | fewer than 30% of the first million records **and** fewer than 15% of records beyond the first million |
| Custom indexed field | fewer than 10% of the first million records **and** fewer than 5% of records beyond the first million |

Worked examples straight from the LDV guide:

| Object rows | Index kind | Index used when the filter matches at most |
| --- | --- | --- |
| 2,000,000 | standard | 450,000 rows |
| 5,000,000 | standard | 900,000 rows |
| 500,000 | custom | 50,000 rows |
| 5,000,000 | custom | 300,000 rows |

Combining filters:

| Operator | Rule |
| --- | --- |
| `AND` | the optimizer uses the indexes unless one of them returns more than 20% of the object's records. The combined filter also counts as selective when each filter is under **twice** its own threshold, or when the **intersection** of the filters is under the single threshold |
| `OR` | the optimizer uses the indexes unless they **all** return more than 10% of the object's records. Every field in the `OR` must be indexed for any index to be used, and each filter must clear the threshold individually |
| `LIKE` | the optimizer ignores its statistics table and samples up to 100,000 records of real data to decide whether to use the custom index |
| `CONTAINS` | a custom index is typically not used once more than 333,333 rows must be scanned, because `CONTAINS` requires a full index scan. Threshold subject to change |

Worked `AND` example from the LDV guide, with a 150,000-row selectivity threshold:

```sql
SELECT Id, Name FROM Opportunity
WHERE Stagename = 'Closed Won'
  AND CloseDate = THIS_WEEK
```

- `Stagename = 'Closed Won'` matches 49,899 rows, which is below 150,000, so it is selective.
- `CloseDate = THIS_WEEK` matches about 3,000 rows, also selective.
- Combined: selective.

If `Stagename = 'Closed Won'` instead matched 250,000 rows, the combined filter is still selective
when **either** each filter matches fewer than 300,000 rows (twice each threshold), **or** the
intersection of `Stagename = 'Closed Won' AND CloseDate = THIS_WEEK` is under 150,000 rows.

Apex Developer Guide best-practice restatement: treat a query as selective when a filter on an
indexed field matches **less than 10% of total rows**.

## 3. Gathering the statistics yourself

```sql
-- Distribution plus grand total for a picklist
SELECT StageName, COUNT(Id) FROM Opportunity GROUP BY ROLLUP(StageName)

-- Distribution by week and year for a date field
SELECT WEEK_IN_YEAR(CloseDate), CALENDAR_YEAR(CloseDate), COUNT(Id)
FROM Opportunity
GROUP BY ROLLUP(WEEK_IN_YEAR(CloseDate), CALENDAR_YEAR(CloseDate))
ORDER BY CALENDAR_YEAR(CloseDate), WEEK_IN_YEAR(CloseDate)

-- Exclude soft-deleted rows explicitly
SELECT StageName, COUNT(Id) FROM Opportunity WHERE IsDeleted = false GROUP BY StageName
```

`IsDeleted` is a Boolean present on every standard and custom object. A `GROUP BY ROLLUP` query
without an `IsDeleted` filter counts both live and soft-deleted records; deleted rows still sit in
the table and must be excluded from every query, so they do cost time.

Deleted items remain in the Recycle Bin for **15 days** and do not count against storage; there is no
cap on Recycle Bin size. Bulk API and Bulk API 2.0 support hard delete, which bypasses the Recycle
Bin; Salesforce recommends Bulk API 2.0 hard delete for large volumes. Custom objects in a sandbox can
be truncated with Salesforce Support's help.

## 4. Fields indexed by default

From the LDV guide (indexes the platform maintains on most objects):

| Field | Note |
| --- | --- |
| `Id` | primary key |
| `Name` | primary key set |
| `OwnerId` | primary key set |
| `CreatedDate` | audit date |
| `SystemModstamp` (`LastModifiedDate`) | audit date |
| `RecordTypeId` | indexed for all standard objects that have it |
| `Division` | when divisions are enabled |
| `Email` | Contact and Lead |
| every lookup and master-detail foreign key | relationship fields |

Also indexed, per the Apex Developer Guide: custom fields marked **External ID** or **Unique**.
Salesforce automatically indexes additional fields when the optimizer sees that an index would
improve frequently run queries.

## 5. Custom indexes

Creation: raise a case with Salesforce Customer Support, or deploy a custom index XML file through
Metadata API. Custom indexes that Support creates in production are copied to every sandbox created
from that production org.

Not indexable:

| Field type | Reason |
| --- | --- |
| Text area (long) | no index support |
| Text area (rich) | no index support |
| Non-deterministic formula fields | value can change without a write to the record |
| Encrypted text | no index support |
| Multi-select picklists | no index support |
| Currency fields in a multi-currency org | value depends on conversion rates |
| Binary fields (blob, file) | no index support |
| Formula fields calling `TEXT()` on a picklist | explicitly excluded |

New, typically complex, data types are added to Salesforce periodically and do not always support
custom indexing.

External ID can be created only on Auto Number, Email, Number, and Text fields; creating one causes
an index to be built and the optimizer then considers that field. For any other field type, including
standard fields, Support must create the index.

### Why index tables exist

The multitenant data table for custom fields is unsuitable for direct indexing, so the platform keeps
an **index table** holding a copy of the data plus data-type information, and builds a standard
database index on that. Two consequences:

1. The index table places an upper limit on how many records an indexed search can effectively
   return - this is the source of the threshold rules above.
2. **Index tables exclude null rows by default.** A filter such as `WHERE Foreign_Key__c != null`
   cannot use the index. Salesforce Support can create custom indexes that include null rows, but
   existing custom indexes must be explicitly enabled and rebuilt to pick up empty-value rows.

### When a custom index is typically not used

- The queried values exceed the system-defined threshold.
- The filter operator is negative: `!=`, `NOT CONTAINS`, `NOT STARTS WITH`.
- `CONTAINS` is used and the scan exceeds 333,333 rows.
- The comparison is against an empty value, for example `Name != ''`.

Other complex scenarios also defeat indexes; contact Salesforce when a case is not covered.

### Non-deterministic formula fields

A formula is non-deterministic, and therefore not indexable, when it:

- references other entities, for example fields reached through lookup fields;
- includes other formula fields that span other entities;
- uses dynamic date and time functions such as `TODAY` or `NOW`.

Also treated as non-deterministic:

- Owner, autonumber, division, or audit fields (except `CreatedDate` and `CreatedById`);
- references to fields the platform cannot index;
- multi-select picklists;
- currency fields in a multi-currency org;
- long text area fields;
- binary fields (blob, file, encrypted text);
- these standard fields with special functionality:

| Object | Fields |
| --- | --- |
| Opportunity | `Amount`, `TotalOpportunityQuantity`, `ExpectedRevenue`, `IsClosed`, `IsWon` |
| Case | `ClosedDate`, `IsClosed` |
| Product | `ProductFamily`, `IsActive`, `IsArchived` |
| Solution | `Status` |
| Lead | `Status` |
| Activity | `Subject`, `TaskStatus`, `TaskPriority` |

If a formula is modified after its index is created, the index is rebuilt.

### Cross-object indexes

Cross-object notation is typically used as an index when written explicitly, which is the documented
replacement for formula fields that cannot be indexed because they reference other objects:

```sql
SELECT Id
FROM Score__c
WHERE CrossObject1__r.CrossObject2__r.IndexedField__c = 'x'
```

The referenced field must be indexed. The notation can span multiple levels.

### Two-column custom indexes

Useful where one field selects records and another sorts them - list views are the canonical case. An
Account list view selecting by State and sorting by City uses a two-column index with State first and
City second.

```sql
-- A two-column index on (f1__c, f2__c) beats single indexes on f1__c and f2__c here
SELECT Name FROM Account WHERE f1__c = 'foo' AND f2__c = 'bar'
```

Two-column indexes carry the same restrictions as single-column indexes, with one exception: they
**can** contain nulls in the second column. Single-column indexes cannot contain nulls unless
Salesforce Support explicitly enables the option.

## 6. Skinny tables

Salesforce can create a skinny table containing frequently used fields, avoiding a join. Skinny
tables stay in sync with their source tables.

| Property | Detail |
| --- | --- |
| Who creates them | Salesforce Customer Support only. You cannot create, access, or modify them |
| Why they help | for each visible object table the platform maintains separate underlying tables for standard and custom fields; a query touching both kinds normally needs a join. A skinny table holds both kinds and omits soft-deleted records |
| Best fit | read-only operations - reports, list views, SOQL - on tables with millions of records |
| Supported objects | custom objects, plus Account, Contact, Opportunity, Lead, Case |
| Maximum columns | 200 |
| Cross-object fields | not allowed |
| Encrypted data | skinny tables and skinny indexes can contain encrypted data |
| Sandbox copying | copied to **Full** sandboxes only. For other sandbox types, ask Support to activate them |
| Maintenance | if the report, list view, or query changes (for example a new field), Support must update the skinny table definition |

Supported field types: Checkbox, Currency, Date, Date and time, Email, Number, Percent, Phone,
Picklist (multi-select), Text, Text area, Text area (long), URL.

Worked example from the guide: instead of filtering an annual report on a date range such as
`01/01/11` to `12/31/11`, which forces a repeated expensive computation, include a `Year` field in the
skinny table and filter on `Year = '2011'`.

Warning from the guide: skinny tables are not a universal fix. Maintaining separate tables holding
copies of live data has overhead, and using them in the wrong context degrades performance.

## 7. Divisions

Divisions partition data in large deployments to reduce the number of records returned by queries and
reports - for example `US`, `EMEA`, `APAC` groupings of customer records. Prerequisites: more than one
million records in a single object and more than 35 licences. Enabled by Salesforce Customer Support.
`Division` is one of the fields the platform indexes by default.

## 8. Query Performance Feedback (Beta) response fields

`GET /services/data/vXX.X/query?explain=<query>` - API version 30.0 and later. The response contains
one or more plans sorted from most to least optimal; the first plan is the one that executes.

| Field | Type | Meaning |
| --- | --- | --- |
| `cardinality` | number | estimated number of records the query would return, based on index fields if any |
| `fields` | string[] | when `leadingOperationType` is `Index`, the index fields used; otherwise null |
| `leadingOperationType` | string | `Index` - uses an index on the query object. `Other` - uses optimizations internal to Salesforce. `Sharing` - uses an index based on the user's sharing rules, which can optimize the query when sharing rules limit visibility. `TableScan` - scans all records and uses no index |
| `notes` | note[] | each note has `description` (detail about part of the optimization, including optimizations that could not be used and why), `fields` (fields used for the optimization), and `tableEnumOrId` (the table name for those fields). API 33.0 and later |
| `relativeCost` | number | cost of this query relative to the SOQL selective-query threshold. **A value greater than 1.0 means the query is not selective** |
| `sobjectCardinality` | number | approximate count of all records in the org for the query object |
| `sobjectType` | string | the query object, for example `Merchandise__c` |

Worked response from the REST guide:

```bash
curl "https://MyDomainName.my.salesforce.com/services/data/v67.0/query/?explain=SELECT+Name+FROM+Merchandise__c+WHERE+CreatedDate+=+TODAY+AND+Price__c+>+10.0"
```

```json
{
  "plans": [
    {
      "cardinality": 1,
      "fields": ["CreatedDate"],
      "leadingOperationType": "Index",
      "notes": [
        {
          "description": "Not considering filter for optimization because unindexed",
          "fields": ["IsDeleted"],
          "tableEnumOrId": "Merchandise__c"
        }
      ],
      "relativeCost": 0.0,
      "sobjectCardinality": 3,
      "sobjectType": "Merchandise__c"
    },
    {
      "cardinality": 1,
      "fields": [],
      "leadingOperationType": "TableScan",
      "notes": [
        {
          "description": "Not considering filter for optimization because unindexed",
          "fields": ["IsDeleted"],
          "tableEnumOrId": "Merchandise__c"
        }
      ],
      "relativeCost": 0.65,
      "sobjectCardinality": 3,
      "sobjectType": "Merchandise__c"
    }
  ]
}
```

Reading: two plans were found. The first uses the `CreatedDate` index and runs. The second is a full
table scan. Both note that filtering out deleted records cannot be secondarily optimised because
`IsDeleted` is not indexed.

Through the vibe-force CLI wrapper:

```bash
sf api request rest "/services/data/v67.0/query/?explain=SELECT+Id+FROM+Account+WHERE+Type+%3D+%27Customer+-+Direct%27" --target-org vf-dev
```

URL-encode the query: `=` becomes `%3D`, a single quote becomes `%27`, spaces become `+`.

## 9. Worked selectivity analyses

From the Apex Developer Guide, assuming Account has more than one million records including
soft-deleted rows.

| Query | Verdict |
| --- | --- |
| `SELECT Id FROM Account WHERE Id IN (<list of ids>)` | the filter is on an indexed field (`Id`). Selective when `SELECT COUNT() FROM Account WHERE Id IN (<list>)` returns fewer rows than the threshold - typically true for short id lists |
| `SELECT Id FROM Account WHERE Name != ''` | `Name` is indexed but the filter returns almost every row, so the query is **not** selective |
| `SELECT Id FROM Account WHERE Name != '' AND CustomField__c = 'ValueA'` | the first filter is not selective, so evaluate the second. Selective if `SELECT COUNT() FROM Account WHERE CustomField__c = 'ValueA'` is below the threshold **and** `CustomField__c` is indexed |

## 10. Source URLs

- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_introduction.htm
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_infrastructure_force_com_query_optimizer.htm
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_infrastructure_skinny_tables.htm
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_large_data_volumes_bp.meta/salesforce_large_data_volumes_bp/ldv_deployments_infrastructure_indexes.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_SOQL_VLSQ.htm
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query_performance_feedback.htm
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query_explain.htm
- PDF snapshots used while authoring: https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/salesforce_large_data_volumes_bp.pdf and https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/api_rest.pdf
