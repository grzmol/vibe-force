# fflib_QueryFactory complete API

Source: `apex-enterprise-patterns/fflib-apex-common` @ `master` commit `dab5977`,
`sfdx-source/apex-common/main/classes/fflib_QueryFactory.cls` (928 lines). Every signature,
default and generated-SOQL claim below was read from that file this session.

Class declaration:

```apex
public class fflib_QueryFactory { //No explicit sharing declaration - inherit from caller
```

The missing sharing keyword is deliberate and documented in the source. Sharing enforcement for a
query therefore comes from the class that calls `Database.query`, not from the factory.

## 1. Enums, fields and defaults

| Member | Type | Default | Notes |
| --- | --- | --- | --- |
| `SortOrder` | enum | - | `ASCENDING`, `DESCENDING` |
| `FLSEnforcement` | enum | - | `NONE`, `LEGACY`, `USER_MODE`, `SYSTEM_MODE` |
| `table` | `Schema.SObjectType` | ctor arg | `public ... {get; private set;}` |
| `fields` | `Set<String>` | empty | `@TestVisible private`; dedup happens here |
| `conditionExpression` | `String` | `null` | WHERE clause without the keyword |
| `limitCount` / `offsetCount` | `Integer` | `null` | omitted from SOQL when null |
| `order` | `List<Ordering>` | empty | emitted in insertion order |
| `mFlsEnforcement` | `FLSEnforcement` | `NONE` | set by the constructor |
| `sortSelectFields` | `Boolean` | `true` | alphabetically sorts the SELECT list |
| `allRows` | `Boolean` | `false` | appends `ALL ROWS` |
| `relationship` | `Schema.ChildRelationship` | `null` | non-null only for subselect factories |
| `subselectQueryMap` | `Map<ChildRelationship, fflib_QueryFactory>` | `null` until first subselect | lazily created |

## 2. Constructors

| Signature | Access | Notes |
| --- | --- | --- |
| `fflib_QueryFactory(Schema.SObjectType table)` | public | initialises `fields`, `order`, `mFlsEnforcement = NONE` |
| `fflib_QueryFactory(Schema.ChildRelationship relationship)` | **private** | used internally for subselects; sets `table` to `relationship.getChildSObject()` |

You never construct the subselect factory yourself - `subselectQuery(...)` returns it. Inside a
selector, always obtain the parent factory from `newQueryFactory()` so the selector's field list,
ordering and security mode are applied.

## 3. Security and formatting

| Method | Returns | Behaviour |
| --- | --- | --- |
| `assertIsAccessible()` | `this` | `fflib_SecurityUtils.checkObjectIsReadable(table)`; throws `fflib_SecurityUtils.CrudException` |
| `setEnforceFLS(Boolean enforce)` *(deprecated)* | `this` | maps to `LEGACY` or `NONE` |
| `setEnforceFLS(FLSEnforcement enforcement)` | `this` | sets the mode |
| `setSortSelectFields(Boolean doSort)` | `this` | `false` skips the alphabetical sort of the SELECT list |
| `setAllRows()` / `setAllRows(Boolean)` | `this` | appends `ALL ROWS` (archived/deleted rows) |

`FLSEnforcement` changes far more than the emitted clause:

| Mode | Field path resolution | Per-field check | SOQL suffix | Field-name case in SELECT |
| --- | --- | --- | --- | --- |
| `NONE` | resolved via `fflib_SObjectDescribe`; unknown field throws `InvalidFieldException` | none | none | canonical (`DescribeFieldResult.getName()`) |
| `LEGACY` | resolved via describe | `fflib_SecurityUtils.checkFieldIsReadable` per field and per path segment | none | canonical |
| `USER_MODE` | **not resolved** - `getFieldPath` returns the string unchanged | none in Apex; platform enforces at query time | ` WITH USER_MODE` | lower-cased by `addField` |
| `SYSTEM_MODE` | **not resolved** | none | ` WITH SYSTEM_MODE` | lower-cased by `addField` |

Consequences of the `USER_MODE`/`SYSTEM_MODE` short-circuit, all visible in `getFieldPath` and
`addField`:

- `selectField('Nmae')` does **not** throw `InvalidFieldException`; the typo surfaces as a runtime
  `QueryException` from `Database.query`.
- Field paths are lower-cased so that `selectField('annualrevenue')` and a field-set member
  `AnnualRevenue` deduplicate to one entry. The source comments explain this explicitly.
- Your generated SOQL contains lower-case field names. Tests asserting on SOQL text must expect that.

## 4. Field selection

| Method | Returns | Notes |
| --- | --- | --- |
| `selectField(String fieldName)` | `this` | delegates to `selectFields(Set<String>)` |
| `selectField(String fieldName, Schema.SObjectType relatedObjectType)` | `this` | disambiguates polymorphic lookups (`Owner` -> `Group`/`User`) |
| `selectField(Schema.SObjectField field)` | `this` | token form, no ambiguity |
| `selectFields(Set<String>)` / `selectFields(List<String>)` | `this` | each goes through `getFieldPath` |
| `selectFields(Set<Schema.SObjectField>)` / `selectFields(List<Schema.SObjectField>)` | `this` | uses `getFieldTokenPath` -> `DescribeFieldResult.getLocalName()`; `null` token throws `InvalidFieldException` |
| `selectFieldSet(Schema.FieldSet fieldSet)` | `this` | equivalent to `selectFieldSet(fieldSet, true)` |
| `selectFieldSet(Schema.FieldSet fieldSet, Boolean allowCrossObject)` | `this` | throws `InvalidFieldSetException` if the field set is for another SObject, or if `allowCrossObject == false` and a member path contains `.` |
| `getSelectedFields()` | `Set<String>` | the live internal set |

Selecting fields is idempotent - `fields` is a `Set<String>`.

Token form uses `getLocalName()`, which strips your own namespace prefix. In a namespaced package
that is what you want; across namespaces prefer the token, never a hand-typed string.

### Parent traversal semantics (`getFieldPath`)

For `NONE`/`LEGACY` and a dotted path, each segment is resolved through
`fflib_SObjectDescribe.getDescribe(lastSObjectType).getField(segment.toLowerCase())`:

| Situation | Result |
| --- | --- |
| segment unknown | `InvalidFieldException('Invalid field ... for object ...')` |
| non-terminal segment is `ID` soap type, or `STRING` soap type with `REFERENCE` display type | appends `DescribeFieldResult.getRelationshipName()` and walks into the referenced SObject |
| non-terminal segment is a plain field | `NonReferenceFieldException('<Object>.<field> is not a lookup or master-detail field but is used in a cross-object query field.')` |
| terminal segment | appends `DescribeFieldResult.getName()` |
| polymorphic reference with `relatedSObjectType == null` | first entry of `getReferenceTo()` is used |
| polymorphic reference with `relatedSObjectType` supplied | matching entry is used |

```apex
// Account.Owner is a User lookup -> 'Owner.Name'
qf.selectField('Account.Owner.Name');
// Lead.Owner is Group|User -> pass the intended type
qf.selectField('Owner.Name', User.SObjectType);
// Account.Industry is not a reference -> NonReferenceFieldException
qf.selectField('Industry.Name');
```

## 5. Filtering, paging and ordering

| Method | Returns | Notes |
| --- | --- | --- |
| `setCondition(String conditionExpression)` | `this` | WHERE clause without the keyword; no validation, no escaping |
| `getCondition()` | `String` | - |
| `setLimit(Integer limitCount)` | `this` | `null` removes the clause |
| `getLimit()` | `Integer` | - |
| `setOffset(Integer offsetCount)` | `this` | `null` removes the clause |
| `getOffset()` | `Integer` | - |
| `addOrdering(Ordering o)` | `this` | appends |
| `addOrdering(String fieldName, SortOrder direction)` | `this` | `NULLS FIRST` |
| `addOrdering(String fieldName, SortOrder direction, Boolean nullsLast)` | `this` | - |
| `addOrdering(SObjectField field, SortOrder direction[, Boolean nullsLast])` | `this` | token form, direct fields only |
| `setOrdering(...)` (same four shapes) | `this` | **replaces** all existing orderings |
| `getOrderings()` | `List<Ordering>` | - |

`setCondition` is a raw string. Bind tokens (`:idSet`) resolve against the local scope of whichever
method calls `Database.query`, or against the map passed to `Database.queryWithBinds`.

### `Ordering` inner class

| Member | Notes |
| --- | --- |
| `Ordering(String sObjectTypeName, String fieldName, SortOrder direction)` | resolves the field via `fflib_SObjectDescribe.getDescribe(String)` |
| `Ordering(Schema.SObjectField field, SortOrder direction)` | `nullsLast = false` - the SOQL default is NULLS FIRST |
| `Ordering(Schema.SObjectField field, SortOrder direction, Boolean nullsLast)` | - |
| `getField()` / `getDirection()` | - |
| `toSOQL()` | `field + ' ' + ('ASC'\|'DESC') + (' NULLS LAST ' \| ' NULLS FIRST ')` - note the trailing space |

## 6. Subselects

| Method | Returns | Notes |
| --- | --- | --- |
| `subselectQuery(SObjectType related)` *(deprecated)* | child factory | resolves the relationship by child SObject type; logs `LoggingLevel.WARN` |
| `subselectQuery(SObjectType related, Boolean assertIsAccessible)` *(deprecated)* | child factory | same, plus optional CRUD check |
| `subselectQuery(String relationshipName)` | child factory | preferred; `assertIsAccessible = false` |
| `subselectQuery(String relationshipName, Boolean assertIsAccessible)` | child factory | throws `InvalidSubqueryRelationshipException` when the name is unknown |
| `subselectQuery(Schema.ChildRelationship relationship[, Boolean assertIsAccessible])` | child factory | when you already hold the describe |
| `getSubselectQueries()` | `List<fflib_QueryFactory>` or `null` | `null` before the first subselect |

`setSubselectQuery` is idempotent per relationship: a second call for the same `ChildRelationship`
returns the factory created the first time, so two selectors contributing fields to the same child
relationship compose instead of conflicting. The child factory inherits `sortSelectFields` from the
parent and nothing else - set its own condition, limit and ordering explicitly.

The deprecated `SObjectType` overloads resolve the relationship by scanning
`table.getDescribe().getChildRelationships()` for a matching child SObject **with a non-null
relationship name**, throwing `InvalidSubqueryRelationshipException` otherwise. Self-referencing
standard relationships frequently have a null relationship name, which is why the name-based
overload is preferred.

## 7. Output

| Method | Returns | Notes |
| --- | --- | --- |
| `toSOQL()` | `String` | see the assembly order below |
| `deepClone()` | `fflib_QueryFactory` | copies limit, offset, condition, FLS mode, orderings, fields and recursively clones subselects |
| `equals(Object obj)` | `Boolean` | same table, same field count, and identical `toSOQL()` |

`toSOQL()` assembly, in exact order:

1. `SELECT ` then either `Id` (when no field was selected - and under `LEGACY` it first calls
   `fflib_SecurityUtils.checkFieldIsReadable(table, 'Id')`) or the field list, alphabetically sorted
   when `sortSelectFields` is true.
2. Each subselect appended as `, (` + child `toSOQL()` + `) `.
3. ` FROM ` + the child relationship name for a subselect factory, otherwise the SObject API name.
4. ` WHERE ` + `conditionExpression` when set.
5. ` WITH USER_MODE` or ` WITH SYSTEM_MODE` - **only when `relationship == null`** (top-level query).
6. ` ORDER BY ` + each `Ordering.toSOQL()` joined with `, `, then the trailing two characters removed.
7. ` LIMIT n`, then ` OFFSET n`, then ` ALL ROWS`.

Because `Ordering.toSOQL()` ends with a space and the join then strips `', '`, the emitted string
contains a double space before `LIMIT`. It is valid SOQL; do not write tests that assert exact
whitespace.

`deepClone()` deliberately does not copy `sortSelectFields` or `allRows` - re-set them on the clone
if they matter.

## 8. Exceptions

| Exception | Thrown by | Message |
| --- | --- | --- |
| `InvalidFieldException(String fieldName, Schema.SObjectType objectType)` | `getFieldPath`, `getFieldTokenPath`, `selectSObjectFields` | `Invalid field '<f>' for object '<o>'` |
| `InvalidFieldSetException` | `selectFieldSet` | wrong SObject, or cross-object member with `allowCrossObject = false` |
| `NonReferenceFieldException` | `getFieldPath` | mid-path segment is not a lookup/master-detail |
| `InvalidSubqueryRelationshipException` | `subselectQuery`, `getChildRelationship` | unknown or unnameable child relationship |
| `fflib_SecurityUtils.CrudException` | `assertIsAccessible` | label-driven text, see `selector-security.md` |
| `fflib_SecurityUtils.FlsException` | `LEGACY` field checks | label-driven text |

## 9. Chaining examples with the SOQL each produces

All examples assume a selector whose `getSObjectFieldList()` is
`{Account.Id, Account.Name, Account.AccountNumber}` and whose `getOrderBy()` is the default `Name`.

### 9a. Base id query, `DataAccess.USER_MODE`

```apex
newQueryFactory().setCondition('id in :idSet').toSOQL()
```

```sql
SELECT accountnumber, id, name FROM Account WHERE id in :idSet
  WITH USER_MODE ORDER BY Name ASC NULLS FIRST
```

Field names are lower-case because `addField` lower-cases under `USER_MODE`; they are unsorted only
if `sortSelectFields` is false - the `(Boolean, DataAccess)` constructor sets it false, so with that
constructor the order is `Set<String>` iteration order.

### 9b. Legacy mode, sorted, extra field and a limit

```apex
newQueryFactory()
    .selectField(Account.Industry)
    .setCondition('Rating = :rating')
    .setLimit(50)
    .toSOQL()
```

```sql
SELECT AccountNumber, Id, Industry, Name FROM Account WHERE Rating = :rating
  ORDER BY Name ASC NULLS FIRST  LIMIT 50
```

### 9c. Parent traversal

```apex
newQueryFactory(false)
    .selectField(Opportunity.Id)
    .selectField('Account.Name')
    .selectField('Account.Owner.Name')
    .setCondition('id in :idSet')
    .toSOQL()
```

```sql
SELECT Account.Name, Account.Owner.Name, Id FROM Opportunity WHERE id in :idSet
  ORDER BY Name ASC NULLS FIRST
```

`newQueryFactory(false)` suppresses the selector's own field list so only the three fields appear.

### 9d. Child subselect

```apex
fflib_QueryFactory oppFactory = newQueryFactory();
new OpportunityLineItemsSelector()
    .addQueryFactorySubselect(oppFactory, 'OpportunityLineItems');
oppFactory.setCondition('id in :idSet').toSOQL();
```

```sql
SELECT Amount, CloseDate, Id, Name, StageName,
  (SELECT Id, PricebookEntryId, Quantity, UnitPrice FROM OpportunityLineItems)
  FROM Opportunity WHERE id in :idSet WITH USER_MODE ORDER BY Name ASC NULLS FIRST
```

The subselect carries no `WITH USER_MODE` of its own - only the outer query can specify a mode.

### 9e. Paging

```apex
newQueryFactory()
    .setCondition('Rating = :rating')
    .setOrdering(Account.Name, fflib_QueryFactory.SortOrder.ASCENDING, true)
    .setLimit(pageSize)
    .setOffset(pageSize * pageIndex)
    .toSOQL()
```

```sql
SELECT AccountNumber, Id, Name FROM Account WHERE Rating = :rating
  ORDER BY Name ASC NULLS LAST  LIMIT 25 OFFSET 50
```

`OFFSET` is capped at 2000 by the platform; for deeper paging keyset-paginate on a sortable
indexed field instead (skill `sf-soql-sosl-optimization`).

### 9f. Archived and deleted rows

```apex
newQueryFactory().setCondition('IsDeleted = true').setAllRows().toSOQL()
```

```sql
SELECT AccountNumber, Id, Name FROM Account WHERE IsDeleted = true
  ORDER BY Name ASC NULLS FIRST  ALL ROWS
```

### 9g. Reusing a factory for two shapes

```apex
fflib_QueryFactory base = newQueryFactory().setCondition('Rating = :rating');
fflib_QueryFactory topTen = base.deepClone()
    .setOrdering(Account.AnnualRevenue, fflib_QueryFactory.SortOrder.DESCENDING, true)
    .setLimit(10);
List<Account> all = (List<Account>) Database.query(base.toSOQL());
List<Account> top = (List<Account>) Database.query(topTen.toSOQL());
```

Two SOQL statements against the 100 limit - only do this when both result sets are genuinely needed.

## 10. Field-set support

```apex
Schema.FieldSet fs = SObjectType.Product2.FieldSets.OpportunityDiscount;
newQueryFactory()
    .selectFieldSet(fs)              // cross-object members allowed
    .selectFieldSet(fs, false)       // cross-object members rejected
    .toSOQL();
```

Selector integration: return the field sets from `getSObjectFieldSetList()` and construct the
selector with `includeFieldSetFields = true`; `fflib_SObjectSelector.configureQueryFactory` then
calls `selectFieldSet(fieldSet)` for each. A field set is admin-editable metadata, so a query built
from one has an unbounded field list by design - never use field sets in a query that runs over
large volumes or inside a trigger. Field-set members also defeat `USER_MODE` typo protection since
paths are taken verbatim.

## 11. What the factory cannot do

| Not supported | Workaround |
| --- | --- |
| `COUNT()`, `SUM()`, `GROUP BY`, `HAVING` | hand-written aggregate query inside the selector (see skill `sf-fflib-selector-layer` pattern 9) |
| `TYPEOF` polymorphic SELECT | hand-written query |
| `FOR UPDATE` | hand-written query, or `Database.query(qf.toSOQL() + ' FOR UPDATE')` `[unverified]` as an fflib-supported idiom |
| `WITH SECURITY_ENFORCED` | nothing to do - the clause is **not allowed in Apex SOQL at API version 67.0 and later**, and `toSOQL()` never emits it. Use `FLSEnforcement.USER_MODE` |
| Nested subselects (two levels) | not supported by SOQL either |
| `GROUP BY ROLLUP` / `CUBE` | hand-written query |
| Bind values | `Database.query` local scope, or `Database.queryWithBinds(sql, bindMap, AccessLevel.USER_MODE)` |
| SOSL | out of scope; see skill `sf-soql-sosl-optimization` |

## Related

- Skill `sf-fflib-selector-layer` - the selector patterns that drive this API
- [selector-recipes.md](selector-recipes.md) - complete classes using each method above
- [selector-security.md](selector-security.md) - `FLSEnforcement` in depth
- [selector-antipatterns.md](selector-antipatterns.md)
- Dynamic SOQL: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dynamic_soql.htm
- SOQL ORDER BY / LIMIT / OFFSET: https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql_select_orderby.htm
