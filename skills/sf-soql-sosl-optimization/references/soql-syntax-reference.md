# SOQL and SOSL Syntax - Clause Reference with Limits

Source of record: SOQL and SOSL Reference (Summer '26 / API 67.0 snapshot for that deliverable),
Apex Developer Guide `apex_gov_limits`, `apex_dynamic_soql`, `langCon_apex_loops_for_SOQL`,
`langCon_apex_locking_records`. URLs at the end of this file.

## 1. SELECT grammar and clause order

```sql
SELECT fieldList [subquery][...]
[TYPEOF typeOfField whenExpression[...] elseExpression END][...]
FROM objectType[,...]
    [USING SCOPE filterScope]
[WHERE conditionExpression]
[WITH [DATA CATEGORY] filteringExpression]
[GROUP BY {fieldGroupByList | ROLLUP (fieldSubtotalGroupByList) | CUBE (fieldSubtotalGroupByList)}
    [HAVING havingConditionExpression] ]
[ORDER BY fieldOrderByList {ASC|DESC} [NULLS {FIRST|LAST}] ]
[LIMIT numberOfRowsToReturn]
[OFFSET numberOfRowsToSkip]
[{FOR VIEW | FOR REFERENCE} ]
[UPDATE {TRACKING|VIEWSTAT} ]
[SET OPTIONS (optionName = optionValue [, optionName = optionValue])]
[FOR UPDATE]
```

## 2. Clause-by-clause table

| Clause | Required | Availability | Limits and behaviour |
| --- | --- | --- | --- |
| `SELECT fieldList` | yes | all | needs read-level permission on each field; field order in `fieldList` sets result field order. Supports `count()`, aggregate functions, `toLabel()`, `FIELDS(STANDARD\|CUSTOM\|ALL)` |
| subquery in `fieldList` | no | all | parent-to-child; the subquery `FROM` must relate to the outer `FROM`. For standard objects the relationship name is the plural child name |
| `TYPEOF ... WHEN ... THEN ... ELSE ... END` | no | API 46.0 and later | polymorphic relationship fields only; `SELECT` clause only. See the restriction list below |
| `FROM objectType` | yes | all | needs read-level permission on the object |
| `USING SCOPE filterScope` | no | API 32.0 and later | enumeration per object; discover with `describeSObject` (SOAP) or sObject Describe (REST) and read `supportedScopes`. **Cannot** be used to limit a parent-child relationship query |
| `WHERE conditionExpression` | no | all | omitted means every row the user can see |
| `WITH DATA CATEGORY` | no | all | only filters `Question` and `KnowledgeArticleVersion` |
| `WITH USER_MODE` / `WITH SYSTEM_MODE` | no | Apex only | recommended way to enforce field- and object-level security. From API 67.0, Apex defaults to user mode |
| `WITH SECURITY_ENFORCED` | no | Apex only, API 45.0-66.0 | **not allowed in API 67.0 and later.** Salesforce recommends `WITH USER_MODE` because it has fewer limitations |
| `GROUP BY fieldGroupByList` | no | API 18.0 and later | see the GROUP BY considerations below |
| `GROUP BY ROLLUP(...)` / `CUBE(...)` | no | API 18.0 and later | up to **three** fields in the subtotal list |
| `HAVING` | no | API 18.0 and later | may contain aggregate functions; **cannot** contain semi-join or anti-join subqueries; every non-aggregated field in `HAVING` must appear in `GROUP BY` |
| `ORDER BY ... [ASC\|DESC] [NULLS FIRST\|LAST]` | no | all | **not allowed** in a query that uses `FOR UPDATE`; not allowed with bare `COUNT()`; external objects do not support it in relationship queries over the OData 2.0 adapter |
| `LIMIT n` | no | all | required to be paired with `GROUP BY` when the query uses an aggregate function |
| `OFFSET n` | no | API 24.0 and later | **maximum 2,000 rows**; above that `NUMBER_OUTSIDE_VALID_RANGE`. Not allowed in Bulk API or Streaming API SOQL. Intended for top-level queries; invalid in most subqueries (`MALFORMED_QUERY`) |
| `FOR VIEW` / `FOR REFERENCE` | no | all | updates the record's last-viewed or last-referenced date |
| `UPDATE TRACKING` / `UPDATE VIEWSTAT` | no | all | Knowledge article keyword tracking and view statistics |
| `SET OPTIONS (...)` | no | all | query options as name/value pairs |
| `FOR UPDATE` | no | Apex only | locks the returned rows until the transaction completes; no `ORDER BY`; not applicable to Batch Apex `start` |

### Statement-level limits

| Limit | Value |
| --- | --- |
| SOQL statement length | 100,000 characters by default; above that `MALFORMED_QUERY`. Does **not** apply to dynamic Apex SOQL |
| Complexity | a statement under 100,000 characters can still fail with `QUERY_TOO_COMPLICATED` because Salesforce expands it internally. Many formula fields, many currency fields (each roughly doubles its API name length because SOQL must apply a format method), or a Lightning page layout with more than 250 fields can all trigger it - even with no customer-written SOQL |
| List view search scope | only the first 2,000 records in a list are searched |
| Query result batch size | default and maximum 2,000 records |

Paging strategies when a `SELECT` returns too much per record:

| Context | Mechanism |
| --- | --- |
| SOQL | `OFFSET` + `LIMIT`, checking the returned count each time. **Do not** just increment `OFFSET` by `LIMIT` |
| SOAP API | `queryMore()` |
| REST API | `nextRecordsUrl` from `/query` and `/queryAll` |
| Bulk API 2.0 | the `Sforce-Locator` response header on the job results |

## 3. Per-transaction Apex limits that govern queries

| Description | Synchronous | Asynchronous |
| --- | --- | --- |
| SOQL queries issued | 100 | 200 |
| Records retrieved by SOQL queries | 50,000 | 50,000 |
| Records retrieved by `Database.getQueryLocator` | 10,000 | 10,000 |
| SOSL queries issued | 20 | 20 |
| Records retrieved by a single SOSL query | 2,000 | 2,000 |
| Rows across all Apex cursors per transaction | 50,000,000 | 50,000,000 |
| `Cursor.fetch()` calls per transaction | 100 | 100 |
| Rows across all Apex pagination cursors per transaction | 100,000 | 100,000 |
| Apex pagination cursor instances per transaction | 50 | 50 |
| Rows retrieved per page from an Apex pagination cursor | 2,000 | 2,000 |
| Total heap size | 10 MB | 25 MB |
| Maximum CPU time | 10,000 ms | 60,000 ms |

In a SOQL query with parent-child relationship subqueries, **each parent-child relationship counts as
an extra query**.

Counters: `Limits.getQueries()`, `Limits.getLimitQueries()`, `Limits.getQueryRows()`,
`Limits.getLimitQueryRows()`, `Limits.getSoslQueries()`, `Limits.getAggregateQueries()`.

## 4. Relationship queries

| Rule | Value |
| --- | --- |
| Child-to-parent relationships per query | no more than 55. A custom object allows up to 40 relationships, so all of a custom object's child-to-parent relationships fit in one query |
| Levels per child-to-parent relationship | no more than five, for example `Contact.Account.Owner.FirstName` is three |
| Parent-to-child relationships per query | no more than 20 |
| Parent-to-child nesting, API 57.0 and earlier | two levels |
| Parent-to-child nesting, API 58.0 and later | up to five levels, via REST, SOAP, and Apex query calls, for standard and custom objects. The parent counts as level one, so children can go four levels deep from the parent root. More than five levels is an error. **Not** supported for big objects, external objects, Bulk API, or Bulk API 2.0 |
| Polymorphic fields | one `TYPEOF` query can count several times against the child-to-parent limit. `SELECT TYPEOF What WHEN Account ... WHEN Opportunity ... END FROM Event` counts 3 (`What`, `Account`, `Opportunity`). Adding `WHERE Id = 'someId'` reduces it to 1. The same relationship used repeatedly counts once |
| Notes and attachments | queryable, but you cannot filter on the body. You cannot filter on the content of textarea fields, blobs, or Scontrol components in any object |
| `USING SCOPE` | cannot limit a parent-child relationship query |

External object relationship limits:

| Rule | Value |
| --- | --- |
| Rows fetched by a subquery involving external objects, or a filter on parent external objects | up to 1,000 |
| Joins across external objects and other object types per SOQL query | up to 4. Each join is a separate round trip to the external system |
| `ORDER BY` in relationship queries | unsupported via the OData 2.0 adapter for Salesforce Connect |
| `queryMore()` when the driving object is external | supports only the primary object, no subqueries |

Examples:

```sql
-- child-to-parent
SELECT Contact.FirstName, Contact.Account.Name FROM Contact
-- parent-to-child
SELECT Name, (SELECT LastName FROM Contacts) FROM Account
-- parent-to-child with filters on both levels
SELECT Name, (SELECT LastName FROM Contacts WHERE CreatedBy.Alias = 'x')
FROM Account WHERE Industry = 'media'
-- custom objects
SELECT Name, (SELECT Name FROM Line_Items__r) FROM Merchandise__c WHERE Name LIKE 'Acme%'
-- polymorphic
SELECT TYPEOF What
         WHEN Account THEN Phone, NumberOfEmployees
         WHEN Opportunity THEN Amount, CloseDate
         ELSE Name, Email
       END
FROM Event
```

## 5. `TYPEOF` restrictions

- Not allowed on a relationship field whose `namePointing` attribute is false.
- Not allowed on a relationship field whose `relationshipName` attribute is false.
- Allowed only in the `SELECT` clause. Filter on polymorphic type with `WHERE Type = ...` instead.
- Not allowed in queries that do not return objects, such as `COUNT()`.
- Not allowed in Streaming API PushTopic queries.
- Not allowed in Bulk API SOQL.
- Cannot be nested inside another `TYPEOF`'s `WHEN` clause.
- Not allowed in the `SELECT` clause of a semi-join query; allowed in the outer `SELECT` of a query
  that contains semi-joins.
- Not allowed in queries with functions in the `SELECT` clause.
- Not allowed with `GROUP BY`, `GROUP BY ROLLUP`, `GROUP BY CUBE`, or `HAVING`.
- `typeOfField` cannot reference a relationship field that also appears in `fieldList`.

## 6. Aggregate functions

Available: `AVG()`, `COUNT()`, `COUNT(fieldName)`, `COUNT_DISTINCT()`, `MIN()`, `MAX()`, `SUM()`.

| Rule | Detail |
| --- | --- |
| Return shape | any query with an aggregate function returns `AggregateResult` objects, not sObjects |
| `LIMIT` without `GROUP BY` | invalid. `SELECT MAX(CreatedDate) FROM Account LIMIT 1` fails; `SELECT Name, MAX(CreatedDate) FROM Account GROUP BY Name LIMIT 5` is valid |
| `COUNT()` | must be the only element in the `SELECT` list; counts rows including nulls that match the filter; may be used with `LIMIT`; **cannot** be used with `ORDER BY`. In SOAP, `size` holds the count and `records` is null |
| `COUNT(fieldName)` | counts rows where `fieldName` is non-null; result arrives in `expr0` unless aliased; multiple `COUNT(fieldName)` items are allowed in one `SELECT`. `COUNT()` and `COUNT(Id)` behave like SQL `COUNT(*)` |
| `queryMore` | queries with an aggregate function do not support `queryMore`. A run-time exception occurs if an aggregate query returning more than 2,000 rows is used in a for loop |
| Unsupported data types | `base64`, `boolean`, and `byte` support none of the aggregate functions |
| Aliases | `SELECT Name n, MAX(Amount) max FROM Opportunity GROUP BY Name` - read back with `ar.get('max')` |

```apex
AggregateResult[] grouped = [
    SELECT LeadSource, COUNT(Name) leads
    FROM Lead
    WHERE IsDeleted = false
    GROUP BY LeadSource
    HAVING COUNT(Name) > 100
    WITH USER_MODE
];
for (AggregateResult ar : grouped) {
    System.debug(ar.get('LeadSource') + ': ' + ar.get('leads'));
}
```

### `GROUP BY ROLLUP` and `GROUP BY CUBE`

| Feature | `ROLLUP` | `CUBE` |
| --- | --- | --- |
| Subtotals produced | for a subset of the grouped field combinations, following the field order | for **every** combination of the grouped fields, plus a grand total |
| Fields allowed | up to three | up to three |
| Distinguishing subtotal rows | `GROUPING(fieldName)` returns 1 when the row is a subtotal for that field, 0 otherwise | same |

Field order in `ROLLUP` matters: `GROUP BY ROLLUP(LeadSource, Rating)` subtotals per `LeadSource`,
while `GROUP BY ROLLUP(Rating, LeadSource)` subtotals per `Rating`.

```sql
SELECT Type, BillingCountry,
       GROUPING(Type) grpType, GROUPING(BillingCountry) grpCty,
       COUNT(Id) accts
FROM Account
GROUP BY CUBE(Type, BillingCountry)
ORDER BY GROUPING(Type), GROUPING(BillingCountry)
```

Ordering by the `GROUPING()` expressions pushes subtotal and grand-total rows to the end, which makes
iteration in code simpler.

### `GROUP BY` considerations

- Some field types do not support grouping. Check the `groupable` boolean on the field in a
  `describeSObject` / sObject Describe response, or in the Object Reference for standard objects.
- A query with an aggregate function **and** a `LIMIT` clause must also have a `GROUP BY`.
- Child relationship expressions using `__r` syntax are not allowed in a `GROUP BY` query.
- SOAP `queryMore()` cannot page a `GROUP BY` query; REST cannot use a query locator for one.
- Formula fields cannot be grouped.

## 7. Semi-joins and anti-joins

A semi-join is an `IN` subquery on another object; an anti-join is a `NOT IN` subquery.

| Restriction group | Rule |
| --- | --- |
| Basic | no more than **two** `IN` or `NOT IN` statements per `WHERE` clause |
| Basic | `NOT` cannot be used as a conjunction with semi-joins or anti-joins - it flips one into the other. Write the intended form directly |
| Main query | the left operand must query a single Id (primary key) or reference (foreign key) field |
| Main query | the left operand cannot use relationships. `WHERE Account.Id IN (...)` is invalid |
| Subquery | must query a field referencing the same object type as the main query |
| Subquery | no limit on records matched inside the subquery; standard SOQL limits still apply to the main query |
| Subquery | the selected column must be a foreign key field and cannot traverse relationships. `SELECT AccountId FROM Contact` is valid; `SELECT Account.Id FROM Contact` and `SELECT Contact.AccountId FROM Case` are not |
| Subquery | cannot query the same object as the main query. Rewrite self semi-joins without a subquery |

```sql
-- valid semi-join
SELECT Id, Name FROM Account
WHERE Id IN (SELECT AccountId FROM Contact WHERE LastName LIKE 'Brown_%')

-- valid semi-join on a polymorphic parent
SELECT Id FROM Idea
WHERE Id IN (SELECT ParentId FROM Vote WHERE CreatedDate > LAST_WEEK AND Parent.Type = 'Idea')
```

## 8. `FOR UPDATE` and row locking

```apex
Account[] accts = [SELECT Id FROM Account LIMIT 2 FOR UPDATE];
```

- While a record is locked, no other client or user can update it through code or the UI.
- The lock is released when the transaction completes.
- `ORDER BY` is not allowed in any locking query.
- `FOR UPDATE` works in SOQL for loops; the loop corresponds internally to `query()` and
  `queryMore()` calls.
- Not applicable to Batch Apex `start`. To lock inside a batch, select `Id` in the locator and
  requery with `FOR UPDATE` inside `execute`.
- Reduce deadlocks by grouping child records by `ParentId` in the same batch when loading data.

## 9. SOQL for loops

```sql
for (variable : [soql_query]) { code_block }
for (variable_list : [soql_query]) { code_block }
```

| Form | Iterations | Use when |
| --- | --- | --- |
| single sObject | once per record | no DML inside the loop |
| `List<sObject>` | once per batch of **200** records | DML inside the loop, so each statement processes a bulk list |

- For loops use internal `query`/`queryMore` chunking, which keeps large result sets off the heap at
  the cost of extra CPU cycles.
- `break` and `continue` work in both forms; in the list form `continue` skips to the next list.
- DML statements process at most 10,000 records at a time and list for loops arrive in batches of
  200, so inserting, updating, or deleting more than one record per returned record can hit runtime
  limits.
- Accessing 200 or more child records of a retrieved sObject inside the loop - `acct.Contacts`,
  `acct.Contacts.size()` - throws `QueryException: Aggregate query has too many rows for direct
  assignment, use FOR loop`. `JSON.serialize()` on such a parent also produces an incomplete child
  set. Iterate the child relationship with a nested for loop instead.
- For finer control than a for loop, use Apex cursors (`Database.getCursor`, `Cursor.fetch`).

## 10. Dynamic SOQL

| Method | Returns | Notes |
| --- | --- | --- |
| `Database.query(q)` / `Database.query(q, accessLevel)` | `List<sObject>` or a single sObject | `accessLevel` optional |
| `Database.queryWithBinds(q, bindMap, accessLevel)` | `List<sObject>` | API 57.0 and later; `accessLevel` **required** |
| `Database.countQuery(q)` / `Database.countQueryWithBinds(q, bindMap, accessLevel)` | `Integer` | row count without materialising rows |
| `Database.getQueryLocator(q[, accessLevel])` / `Database.getQueryLocatorWithBinds(q, bindMap, accessLevel)` | `Database.QueryLocator` | Batch Apex and Visualforce |
| `Database.getCursor(q[, accessLevel])` / `Database.getCursorWithBinds(q, bindMap, accessLevel)` | `Database.Cursor` | chunked traversal up to 50 million rows |

Bind-map rules for the `WithBinds` variants:

- String map keys are case-sensitive as map keys, but `queryWithBinds` compares them
  **case-insensitively**. Duplicate case-insensitive keys throw
  `System.QueryException: The bindMap consists of duplicate case-insensitive keys: [Acctname, acctName]`.
- Keys must start with an ASCII letter, must not start with a number, must not use reserved keywords,
  and must satisfy Apex variable naming rules.
- Dot notation in map keys is supported but discouraged.

SOQL injection prevention: bind every value. When a fragment genuinely cannot be bound (object or
field API name, sort direction), validate it against an allowlist built from
`Schema.getGlobalDescribe()` and pass remaining free text through `String.escapeSingleQuotes()`,
which escapes single quotation marks so they are treated as string delimiters rather than database
commands.

```apex
public with sharing class DynamicQuery {
    private static final Set<String> SORTABLE = new Set<String>{ 'Name', 'CreatedDate' };

    public static List<Account> search(String namePrefix, String sortField) {
        if (!SORTABLE.contains(sortField)) {
            throw new IllegalArgumentException('Unsupported sort field: ' + sortField);
        }
        Map<String, Object> binds = new Map<String, Object>{ 'prefix' => namePrefix + '%' };
        return (List<Account>) Database.queryWithBinds(
            'SELECT Id, Name FROM Account WHERE Name LIKE :prefix ORDER BY ' + sortField,
            binds,
            AccessLevel.USER_MODE
        );
    }
}
```

## 11. Single-record assignment

When the left-hand side of an assignment is a single sObject type, Apex assigns the one record in the
result list. Zero records or more than one record raises a runtime exception.

```apex
Account acct = [SELECT Id FROM Account WHERE Id = :recordId WITH USER_MODE];
String name = [SELECT Name FROM Account WHERE Id = :recordId WITH USER_MODE].Name;
```

Supported with `Database.query`, the safe navigation operator, the null coalescing operator, and
`Map.values`.

## 12. SOSL grammar

```sql
FIND {SearchQuery}
[ IN SearchGroup ]
[ RETURNING FieldSpec [[toLabel(fields)] [convertCurrency(Amount)] [FORMAT()]] ]
[ WITH DivisionFilter ]
[ WITH DATA CATEGORY DataCategorySpec ]
[ WITH SNIPPET[(target_length=n)] ]
[ WITH NETWORK NetworkIdSpec ]
[ WITH PricebookId ]
[ WITH METADATA ]
[ LIMIT n ]
[ UPDATE [TRACKING], [VIEWSTAT] ]
```

`OFFSET n` and `WHERE` live **inside** `RETURNING FieldSpec`, not at the top level.

| Clause | Required | Notes |
| --- | --- | --- |
| `FIND {SearchQuery}` | yes | the words or phrases to search for, in braces |
| `IN SearchGroup` | no | `ALL FIELDS`, `NAME FIELDS`, `EMAIL FIELDS`, `PHONE FIELDS`, `SIDEBAR FIELDS` |
| `RETURNING FieldSpec` | **required in Apex**, optional elsewhere | objects and fields to return; per-object `WHERE`, `ORDER BY`, `LIMIT`, `OFFSET` go here. Only one list view may be specified, and only its first 2,000 records are searched |
| `WITH SNIPPET[(target_length=n)]` | no | returns a highlighted snippet |
| `LIMIT n` | no | overall row cap |

When no fields are specified in `RETURNING`, all fields are searched.

### SOSL result limits

1. The search engine matches the search term across a maximum of **2,000 records** (API 28.0 and
   later).
2. A single-object query returns up to **250** records. Adding a `WHERE` or `ORDER BY` clause raises
   that to up to 2,000.
3. A multi-object query returns, per object, up to `min(2000/n, 250)` where `n` is the number of
   objects. Two objects: 250 each. Ten objects: 200 each.
4. Users with View All Data see the full returned set.
5. All other users get permission-filtered results, so result sets and ordering vary per user and can
   change through the day as records enter and leave the index.

External object limits in SOSL: enable search on both the external object and the external data
source (syncing overwrites the object's search status to match the data source); only text, text
area, and long text area fields are searchable; objects with no searchable fields return nothing;
`INCLUDES` and `LIKE` are unsupported. External objects must be named explicitly in `RETURNING`.

Note that `FIND {MyProspect OR "John Smith"}` searches for the literal phrase
`MyProspect OR John Smith` rather than performing a boolean search in that position.

## 13. Source URLs

- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_typeof.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_using_scope.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_groupby_rollup.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_groupby_cube.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_group_by_considerations.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_agg_functions.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_offset.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_for_update.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_relationships_query_limits.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_sosl_syntax.htm
- https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_sosl_limits.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dynamic_soql.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_loops_for_SOQL.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_locking_records.htm
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm
- PDF snapshots used while authoring: https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/salesforce_soql_sosl.pdf and https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/salesforce_apex_developer_guide.pdf
