# Selector anti-patterns

Each entry: the failing code, why it fails, the fix. Library behaviour is grounded in
`fflib-apex-common` @ `master` commit `dab5977` (`fflib_SObjectSelector.cls`,
`fflib_QueryFactory.cls`, `fflib_Application.cls`). Use this file as a review checklist for any
class extending `fflib_SObjectSelector`.

## Index

| # | Anti-pattern | Failure mode |
| --- | --- | --- |
| 1 | selector calls a service or domain | layering cycle, unmockable |
| 2 | raw `new fflib_QueryFactory(...)` | loses field list, order by, security mode |
| 3 | `getSObjectFieldList()` returns everything | heap and CPU |
| 4 | one selector class per query | only one can be registered per SObjectType |
| 5 | returning `List<SObject>` | casts leak to every caller |
| 6 | SOQL inside a loop in a selector | 100 SOQL limit |
| 7 | string-concatenated filter values | SOQL injection |
| 8 | no `LIMIT` on an unbounded read | `QUERY_TIMEOUT`, heap |
| 9 | deprecated `enforceCRUD`/`enforceFLS` constructor | slow, wrong exception types |
| 10 | `static` record cache in the selector | stale data across a transaction |
| 11 | reusing `buildQuerySObjectById()` with the wrong local name | unbound bind variable |
| 12 | mutable selector state reused across calls | leaked flags between queries |
| 13 | `new XSelector()` in product code | mock injection bypassed |
| 14 | field sets in a bulk/trigger query | unbounded admin-controlled field list |
| 15 | `getOrderBy()` on a non-indexed or formula field | non-selective sort |
| 16 | asserting exact SOQL strings in tests | brittle, breaks on constructor change |
| 17 | aggregate query returning `AggregateResult` | unmockable, untyped |
| 18 | DML in a selector | layering violation |
| 19 | `selectSObjectsById` overridden to add a filter | silently changes the interface contract |
| 20 | empty-input queries | wasted SOQL statements |

---

## 1. Selector calls a service or domain

```apex
// WRONG
public List<Account> selectActiveWithRefresh(Set<Id> idSet) {
    AccountsService.recalculateRatings(idSet);          // service call from the query layer
    return (List<Account>) selectSObjectsById(idSet);
}
```

The selector now has a side effect, cannot be mocked meaningfully (the mock would have to fake the
recalculation too), and creates a Service -> Selector -> Service cycle.

```apex
// RIGHT - the service orchestrates
public void refreshAndLoad(Set<Id> accountIds) {
    AccountsService.recalculateRatings(accountIds);
    List<Account> accounts = AccountsSelector.newInstance().selectById(accountIds);
}
```

## 2. Raw `new fflib_QueryFactory(...)` inside a selector

```apex
// WRONG
public List<Account> selectByRating(String rating) {
    return (List<Account>) Database.query(
        new fflib_QueryFactory(Account.SObjectType)
            .selectField(Account.Name)
            .setCondition('Rating = :rating')
            .toSOQL());
}
```

The factory constructor sets `mFlsEnforcement = NONE`, so no `WITH USER_MODE` is emitted, the
selector's `getSObjectFieldList()` is ignored, `getOrderBy()` is ignored, and field sets are ignored.
The query silently runs with a different security posture from every other method on the class.

```apex
// RIGHT
public List<Account> selectByRating(String rating) {
    return (List<Account>) Database.query(
        newQueryFactory().setCondition('Rating = :rating').toSOQL());
}
```

`newQueryFactory(false)` is the legitimate way to skip only the field list.

## 3. `getSObjectFieldList()` returns every field

```apex
// WRONG
public List<Schema.SObjectField> getSObjectFieldList() {
    List<Schema.SObjectField> fields = new List<Schema.SObjectField>();
    fields.addAll(fflib_SObjectDescribe.getDescribe(Account.SObjectType).getFields().values());
    return fields;
}
```

Every query on the object now selects several hundred fields, including long text areas, for every
row. At 200 rows this is a heap problem, and the alphabetical `sortSelectFields` pass runs over the
whole list on each `toSOQL()`.

```apex
// RIGHT - list what the layer above consumes
public List<Schema.SObjectField> getSObjectFieldList() {
    return new List<Schema.SObjectField> {
        Account.Id, Account.Name, Account.AccountNumber, Account.Rating };
}
```

For an occasional wide read, add a dedicated method using `newQueryFactory(false)` plus an explicit
field list, and document why it is wide.

## 4. One selector class per query

```apex
// WRONG
public class AccountByNameSelector extends fflib_SObjectSelector { ... }
public class AccountByRatingSelector extends fflib_SObjectSelector { ... }
```

`fflib_Application.SelectorFactory` is a `Map<SObjectType, Type>`. Only one class can be registered
for `Account.SObjectType`, so the others are unreachable through `Application.Selector` and
unmockable. Tests that `setMock` one of them do nothing for callers of the other.

```apex
// RIGHT - one class, many methods
public inherited sharing class AccountsSelector extends fflib_SObjectSelector
    implements IAccountsSelector {
    public List<Account> selectById(Set<Id> idSet) { ... }
    public List<Account> selectByName(Set<String> names) { ... }
    public List<Account> selectByRating(String rating) { ... }
}
```

## 5. Returning `List<SObject>`

```apex
// WRONG
public List<SObject> selectByRating(String rating) { ... }
// caller
List<Account> accounts = (List<Account>) AccountsSelector.newInstance().selectByRating('Hot');
```

The cast moves to every call site and the compiler cannot catch a wrong SObject.

```apex
// RIGHT
public List<Account> selectByRating(String rating) {
    return (List<Account>) Database.query(
        newQueryFactory().setCondition('Rating = :rating').toSOQL());
}
```

`selectSObjectsById` returns `List<SObject>` because it is the base-class contract - wrap it in a
typed `selectById`.

## 6. SOQL inside a loop

```apex
// WRONG
public List<Contact> selectByAccounts(List<Account> accounts) {
    List<Contact> results = new List<Contact>();
    for (Account acc : accounts) {
        results.addAll((List<Contact>) Database.query(
            newQueryFactory().setCondition('AccountId = :acc.Id').toSOQL()));
    }
    return results;
}
```

One SOQL per account, so 101 accounts throws `System.LimitException: Too many SOQL queries: 101`.
The `:acc.Id` dotted bind expression is also invalid in dynamic SOQL.

```apex
// RIGHT
public List<Contact> selectByAccountIds(Set<Id> accountIds) {
    if (accountIds == null || accountIds.isEmpty()) { return new List<Contact>(); }
    return (List<Contact>) Database.query(
        newQueryFactory().setCondition('AccountId IN :accountIds').toSOQL());
}
```

Skill `sf-governor-limits`.

## 7. String-concatenated filter values

```apex
// WRONG
public List<Account> search(String nameFragment) {
    return (List<Account>) Database.query(
        newQueryFactory()
            .setCondition('Name LIKE \'%' + nameFragment + '%\'')
            .toSOQL());
}
```

`nameFragment = "x%' OR Name != '"` rewrites the WHERE clause. `String.escapeSingleQuotes` alone is
not a complete defence for every data type and is easy to forget on the next edit.

```apex
// RIGHT
public List<Account> search(String nameFragment) {
    Map<String, Object> binds = new Map<String, Object>{
        'nameLike' => '%' + String.escapeSingleQuotes(nameFragment) + '%' };
    String soql = newQueryFactory()
        .setCondition('Name LIKE :nameLike')
        .setLimit(200)
        .toSOQL();
    return (List<Account>) Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE);
}
```

Caller-supplied *field or object names* must be validated against the describe before reaching
`selectField` - see [selector-recipes.md](selector-recipes.md) recipe 7.

## 8. No `LIMIT` on an unbounded read

```apex
// WRONG
public List<AuditEntry__c> selectAll() {
    return (List<AuditEntry__c>) Database.query(newQueryFactory().toSOQL());
}
```

On a large object this returns `Too many query rows: 50001` or a `QUERY_TIMEOUT`, and the method name
promises something the platform cannot deliver.

```apex
// RIGHT - bound it, or return a locator for batch consumption
public List<AuditEntry__c> selectRecent(Integer maxRows) {
    return (List<AuditEntry__c>) Database.query(
        newQueryFactory()
            .setCondition('EntryDate__c = LAST_N_DAYS:30')
            .setLimit(maxRows == null ? 500 : Math.min(maxRows, 2000))
            .toSOQL());
}

public Database.QueryLocator queryLocatorAll() {
    return Database.getQueryLocator(newQueryFactory().toSOQL());
}
```

## 9. Deprecated `enforceCRUD` / `enforceFLS` constructor in new code

```apex
// WRONG for new code
public ContactsSelector() { super(false, true, true); }
```

The legacy path resolves every field and every path segment through `DescribeFieldResult` on each
`selectField` call - the source comment calls it "computationally expensive" - and fails with
`fflib_SecurityUtils.FlsException` or a `DomainException` instead of the platform's
`System.QueryException`.

```apex
// RIGHT
public ContactsSelector() {
    super(false, fflib_SObjectSelector.DataAccess.USER_MODE);
}
```

Migration checklist: [selector-security.md](selector-security.md) section 3.

## 10. `static` record cache inside the selector

```apex
// WRONG
private static Map<Id, Account> cache = new Map<Id, Account>();

public List<Account> selectById(Set<Id> idSet) {
    Set<Id> missing = new Set<Id>();
    for (Id recordId : idSet) {
        if (!cache.containsKey(recordId)) { missing.add(recordId); }
    }
    if (!missing.isEmpty()) {
        cache.putAll(new Map<Id, Account>((List<Account>) selectSObjectsById(missing)));
    }
    // ... returns stale records after any DML elsewhere in the transaction
}
```

The static survives `Test.startTest()`/`stopTest()` and every subsequent call in the transaction, so
a service that updates an Account then re-reads it gets the pre-update copy. It also makes the
selector's behaviour depend on call order, which breaks mocking assumptions.

```apex
// RIGHT - cache in the service, for the scope of one use case
public void process(Set<Id> accountIds) {
    Map<Id, Account> accountsById =
        new Map<Id, Account>(AccountsSelector.newInstance().selectById(accountIds));
    // ... pass accountsById down; re-query only after commitWork()
}
```

Cross-transaction caching belongs in Platform Cache with an explicit invalidation story.

## 11. Reusing `buildQuerySObjectById()` with the wrong local name

```apex
// WRONG
public List<Account> selectByIds(Set<Id> accountIds) {
    return (List<Account>) Database.query(buildQuerySObjectById());
}
```

`buildQuerySObjectById()` returns `... WHERE id in :idSet`. Dynamic SOQL binds resolve against the
local scope of the method calling `Database.query`, and there is no `idSet` here - the query throws
a `System.QueryException` about the unbound variable.

```apex
// RIGHT - name the parameter idSet, or build the condition yourself
public List<Account> selectByIds(Set<Id> idSet) {
    return (List<Account>) selectSObjectsById(idSet);
}
```

## 12. Mutable selector state reused across calls

```apex
// WRONG
public class AccountsSelector extends fflib_SObjectSelector {
    private Boolean withContacts = false;
    public AccountsSelector withContacts() { this.withContacts = true; return this; }
    // ... and the instance is held in a static
    private static AccountsSelector instance = new AccountsSelector();
    public static AccountsSelector newInstance() { return instance; }
}
```

The flag leaks: once any caller sets `withContacts()`, every later query on that instance carries the
subselect.

```apex
// RIGHT - a fresh instance per call, through the factory
public static IAccountsSelector newInstance() {
    return (IAccountsSelector) Application.Selector.newInstance(Account.SObjectType);
}
```

`fflib_Application.SelectorFactory.newInstance` calls `selectorClass.newInstance()` every time
unless a mock is registered, so each caller gets clean state. Flag-based selectors are fine; caching
the instance is not.

## 13. `new XSelector()` in product code

```apex
// WRONG
public void process(Set<Id> ids) {
    List<Account> accounts = new AccountsSelector().selectById(ids);
}
```

`Application.Selector.setMock` cannot intervene, so every test of `process` needs real records.

```apex
// RIGHT
List<Account> accounts = AccountsSelector.newInstance().selectById(ids);
```

The one legitimate direct construction is a selector used purely as a field-list contributor:
`new ProductsSelector().configureQueryFactoryFields(qf, 'PricebookEntry.Product2')`.

## 14. Field sets in a bulk or trigger query

```apex
// WRONG
public OpportunitiesSelector() {
    super(true, fflib_SObjectSelector.DataAccess.USER_MODE);  // always include field sets
}
```

A field set is admin-editable metadata. Turning it on by default means an admin can add fields to
every trigger-path query, including long text areas, without a code change - and under `USER_MODE`
the paths are taken verbatim, so a broken field-set member is only discovered at query time.

```apex
// RIGHT - default off, opt in from the UI layer
public OpportunitiesSelector() {
    super(false, fflib_SObjectSelector.DataAccess.USER_MODE);
}
public OpportunitiesSelector(Boolean includeFieldSetFields) {
    super(includeFieldSetFields, fflib_SObjectSelector.DataAccess.USER_MODE);
}
```

## 15. `getOrderBy()` on a formula or non-indexed field

```apex
// WRONG
public override String getOrderBy() {
    return 'TotalOpenAmount__c DESC';   // roll-up summary or formula
}
```

Every query on the selector now sorts on an unindexable field. On a large object this turns an
otherwise selective query into a full sort.

```apex
// RIGHT
public override String getOrderBy() {
    return 'CreatedDate DESC NULLS LAST';   // or an indexed custom field
}
```

Skill `sf-soql-sosl-optimization` for index selectivity. Note the base-class default already picks
the Name field, or `CreatedDate`, or `Id`.

## 16. Asserting exact SOQL strings in tests

```apex
// WRONG
System.assertEquals(
    'SELECT AccountNumber, Id, Name FROM Account WHERE id in :idSet ORDER BY Name ASC NULLS FIRST',
    new AccountsSelector().newQueryFactory().setCondition('id in :idSet').toSOQL());
```

Three implementation details will break this: field case is lower-cased under `USER_MODE`, field
order depends on `sortSelectFields` (which the `(Boolean, DataAccess)` constructor sets to `false`),
and `toSOQL()` emits a double space before `LIMIT`. Such a test pins the library, not your contract -
delete it rather than re-pinning it after each fflib upgrade.

```apex
// RIGHT - assert the contract
String soql = new AccountsSelector().newQueryFactory().toSOQL();
System.assert(soql.contains('WITH USER_MODE'), 'Selector must run in user mode: ' + soql);
System.assert(soql.containsIgnoreCase('accountnumber'), 'AccountNumber must be selected: ' + soql);
```

## 17. Aggregate query returning `AggregateResult`

```apex
// WRONG
public List<AggregateResult> selectPipelineByStage(Set<Id> ownerIds) {
    return [SELECT StageName, SUM(Amount) FROM Opportunity
             WHERE OwnerId IN :ownerIds GROUP BY StageName WITH USER_MODE];
}
```

Callers index untyped aliases (`ar.get('expr0')`), and stubbing `AggregateResult` in a test is
impractical.

```apex
// RIGHT - map to a wrapper inside the selector
public List<PipelineByStage> selectPipelineByStage(Set<Id> ownerIds) { ... }
```

Full example: [selector-recipes.md](selector-recipes.md) recipe 6.

## 18. DML in a selector

```apex
// WRONG
public List<Account> selectAndStamp(Set<Id> idSet) {
    List<Account> accounts = (List<Account>) selectSObjectsById(idSet);
    for (Account acc : accounts) { acc.LastViewed__c = System.now(); }
    update as user accounts;                 // DML from the query layer
    return accounts;
}
```

The selector is now a write path with no Unit of Work, no ordering guarantee, and no transaction
boundary. It will also trip `ApexSharingViolations` and `ApexCRUDViolation`.

```apex
// RIGHT - register the change in the service's Unit of Work
fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();
for (Account acc : AccountsSelector.newInstance().selectById(idSet)) {
    uow.registerDirty(new Account(Id = acc.Id, LastViewed__c = System.now()));
}
uow.commitWork();
```

## 19. Overriding `selectSObjectsById` to add a filter

```apex
// WRONG
public override List<SObject> selectSObjectsById(Set<Id> idSet) {
    return (List<Account>) Database.query(
        newQueryFactory().setCondition('id in :idSet AND IsActive__c = true').toSOQL());
}
```

`fflib_ISObjectSelector.selectSObjectsById` means "these records by Id". `Application.Selector.selectById`
and `DomainFactory.newInstance(Set<Id>)` both call it, so a hidden filter makes the domain factory
silently drop records and throws off `Unable to determine SObjectType` style failures downstream.

```apex
// RIGHT - a named method for the filtered variant
public List<Account> selectActiveById(Set<Id> idSet) {
    if (idSet == null || idSet.isEmpty()) { return new List<Account>(); }
    return (List<Account>) Database.query(
        newQueryFactory().setCondition('id in :idSet AND IsActive__c = true').toSOQL());
}
```

Overriding `selectSObjectsById` purely to widen the field list or add ordering is acceptable;
changing which records come back is not.

## 20. Querying for empty input

```apex
// WRONG
public List<Account> selectById(Set<Id> idSet) {
    return (List<Account>) selectSObjectsById(idSet);   // burns a SOQL statement on an empty set
}
```

A trigger that filters down to zero records still consumes one of the 100 SOQL statements per
transaction, and `Application.Selector.selectById` throws
`fflib_Application.DeveloperException('Invalid record Id\'s set')` for an empty set anyway.

```apex
// RIGHT
public List<Account> selectById(Set<Id> idSet) {
    if (idSet == null || idSet.isEmpty()) { return new List<Account>(); }
    return (List<Account>) selectSObjectsById(idSet);
}
```

---

## Review checklist

- [ ] One selector class per SObjectType, registered in `Application.cls`.
- [ ] `inherited sharing` (or an explicitly justified alternative) on the class.
- [ ] Constructor passes `fflib_SObjectSelector.DataAccess.USER_MODE`; no deprecated `enforceCRUD`/`enforceFLS` flags.
- [ ] `getSObjectFieldList()` lists only fields consumed by callers.
- [ ] Field sets default to off.
- [ ] Every custom method: guards empty input, returns a concrete list, starts from `newQueryFactory()`, has a `LIMIT` unless it returns a `QueryLocator`.
- [ ] No SOQL in a loop, no DML, no service/domain calls, no statics holding records.
- [ ] Caller-supplied values travel through `Database.queryWithBinds`; caller-supplied field names are validated against the describe.
- [ ] Subselects use the relationship-name overload, not the deprecated `SObjectType` one.
- [ ] `selectSObjectsById` not overridden to change which records are returned.
- [ ] Tests assert behaviour or the `WITH USER_MODE` clause, never an exact SOQL string.
- [ ] `vf-check analyzer` clean or with documented, rule-scoped exceptions.

## Related

- Skill `sf-fflib-selector-layer` - the patterns these violate
- [selector-recipes.md](selector-recipes.md) - the correct shapes in full
- [selector-security.md](selector-security.md) - enforcement matrix and migration
- [query-factory-api.md](query-factory-api.md) - method-level behaviour
- Skills `sf-soql-sosl-optimization`, `sf-governor-limits`, `sf-code-analyzer-quality`, `sf-apex-development`
