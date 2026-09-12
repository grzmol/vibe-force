# Selector recipes

Twelve complete, compile-plausible selector classes. Base-class behaviour is grounded in
`fflib-apex-common` @ `master` commit `dab5977` (`fflib_SObjectSelector.cls`,
`fflib_QueryFactory.cls`); the class shapes follow `fflib-apex-common-samplecode` @ `master`
commit `4657d63` (`main/classes/selectors/*`).

Conventions used throughout:

- `inherited sharing` on the selector, so the caller's sharing declaration wins. The base class is
  `with sharing`, so `selectSObjectsById` and `queryLocatorById` always enforce sharing.
- `DataAccess.USER_MODE` unless the recipe says otherwise.
- `static newInstance()` resolving through `Application.Selector` so tests can inject mocks.
- Every custom method returns a concrete list and guards empty input.
- One interface per selector, extending `fflib_ISObjectSelector`.

## 1. Standard object, minimal

```apex
public interface IAccountsSelector extends fflib_ISObjectSelector {
    List<Account> selectById(Set<Id> idSet);
    List<Account> selectByOpportunity(List<Opportunity> opportunities);
}
```

```apex
public inherited sharing class AccountsSelector extends fflib_SObjectSelector
    implements IAccountsSelector
{
    public static IAccountsSelector newInstance() {
        return (IAccountsSelector) Application.Selector.newInstance(Account.SObjectType);
    }

    public AccountsSelector() {
        super(false, fflib_SObjectSelector.DataAccess.USER_MODE);
    }

    public Schema.SObjectType getSObjectType() {
        return Account.SObjectType;
    }

    public List<Schema.SObjectField> getSObjectFieldList() {
        return new List<Schema.SObjectField> {
            Account.Id,
            Account.Name,
            Account.AccountNumber,
            Account.Rating,
            Account.LastInvoiceDate__c
        };
    }

    public List<Account> selectById(Set<Id> idSet) {
        if (idSet == null || idSet.isEmpty()) { return new List<Account>(); }
        return (List<Account>) selectSObjectsById(idSet);
    }

    public List<Account> selectByOpportunity(List<Opportunity> opportunities) {
        Set<Id> accountIds = new Set<Id>();
        for (Opportunity opp : opportunities) {
            if (opp.AccountId != null) { accountIds.add(opp.AccountId); }
        }
        return selectById(accountIds);
    }
}
```

## 2. Custom object with field sets and a custom order by

```apex
public interface IInvoicesSelector extends fflib_ISObjectSelector {
    List<Invoice__c> selectById(Set<Id> idSet);
    List<Invoice__c> selectByAccountId(Set<Id> accountIds);
}
```

```apex
public inherited sharing class InvoicesSelector extends fflib_SObjectSelector
    implements IInvoicesSelector
{
    public static IInvoicesSelector newInstance() {
        return (IInvoicesSelector) Application.Selector.newInstance(Invoice__c.SObjectType);
    }

    /** Default: no field set fields - cheap queries for triggers and services. */
    public InvoicesSelector() {
        super(false, fflib_SObjectSelector.DataAccess.USER_MODE);
    }

    /** UI callers pass true to pick up the admin-maintained field set. */
    public InvoicesSelector(Boolean includeFieldSetFields) {
        super(includeFieldSetFields, fflib_SObjectSelector.DataAccess.USER_MODE);
    }

    public Schema.SObjectType getSObjectType() {
        return Invoice__c.SObjectType;
    }

    public List<Schema.SObjectField> getSObjectFieldList() {
        return new List<Schema.SObjectField> {
            Invoice__c.Id,
            Invoice__c.Name,
            Invoice__c.Account__c,
            Invoice__c.Opportunity__c,
            Invoice__c.InvoiceDate__c,
            Invoice__c.Status__c
        };
    }

    public override List<Schema.FieldSet> getSObjectFieldSetList() {
        return new List<Schema.FieldSet> { SObjectType.Invoice__c.FieldSets.InvoiceDetail };
    }

    /** Newest invoices first; NULLS LAST is detected by the base class parser. */
    public override String getOrderBy() {
        return 'InvoiceDate__c DESC NULLS LAST, Name ASC';
    }

    public List<Invoice__c> selectById(Set<Id> idSet) {
        if (idSet == null || idSet.isEmpty()) { return new List<Invoice__c>(); }
        return (List<Invoice__c>) selectSObjectsById(idSet);
    }

    public List<Invoice__c> selectByAccountId(Set<Id> accountIds) {
        if (accountIds == null || accountIds.isEmpty()) { return new List<Invoice__c>(); }
        return (List<Invoice__c>) Database.query(
            newQueryFactory().setCondition('Account__c IN :accountIds').toSOQL());
    }
}
```

## 3. Parent plus child subselect, composed from four selectors

```apex
public interface IOpportunitiesSelector extends fflib_ISObjectSelector {
    List<Opportunity> selectById(Set<Id> idSet);
    List<Opportunity> selectByIdWithProducts(Set<Id> idSet);
}
```

```apex
public inherited sharing class OpportunitiesSelector extends fflib_SObjectSelector
    implements IOpportunitiesSelector
{
    public static IOpportunitiesSelector newInstance() {
        return (IOpportunitiesSelector) Application.Selector.newInstance(Opportunity.SObjectType);
    }

    public OpportunitiesSelector() {
        super(false, fflib_SObjectSelector.DataAccess.USER_MODE);
    }

    public Schema.SObjectType getSObjectType() { return Opportunity.SObjectType; }

    public List<Schema.SObjectField> getSObjectFieldList() {
        return new List<Schema.SObjectField> {
            Opportunity.Id,
            Opportunity.AccountId,
            Opportunity.Amount,
            Opportunity.CloseDate,
            Opportunity.Name,
            Opportunity.Pricebook2Id,
            Opportunity.StageName
        };
    }

    public List<Opportunity> selectById(Set<Id> idSet) {
        if (idSet == null || idSet.isEmpty()) { return new List<Opportunity>(); }
        return (List<Opportunity>) selectSObjectsById(idSet);
    }

    public List<Opportunity> selectByIdWithProducts(Set<Id> idSet) {
        if (idSet == null || idSet.isEmpty()) { return new List<Opportunity>(); }

        fflib_QueryFactory oppFactory = newQueryFactory();

        // Child subselect by relationship name (the SObjectType overload is deprecated).
        fflib_QueryFactory lineFactory = new OpportunityLineItemsSelector()
            .addQueryFactorySubselect(oppFactory, 'OpportunityLineItems');

        // Parent fields on the child row, each contributed by the owning selector.
        new PricebookEntriesSelector()
            .configureQueryFactoryFields(lineFactory, 'PricebookEntry');
        new ProductsSelector()
            .configureQueryFactoryFields(lineFactory, 'PricebookEntry.Product2');
        new PricebooksSelector()
            .configureQueryFactoryFields(lineFactory, 'PricebookEntry.Pricebook2');

        return (List<Opportunity>) Database.query(
            oppFactory.setCondition('id in :idSet').toSOQL());
    }
}
```

Note `new OpportunityLineItemsSelector()` rather than `newInstance()`: these are field-list
contributors, not query executors, and constructing them directly avoids a pointless factory
round-trip. The query itself still belongs to the registered `OpportunitiesSelector`.

## 4. Narrow projection into a typed wrapper

```apex
public class OpportunityInfo {
    public Id id { get; private set; }
    public String accountName { get; private set; }
    public String accountNumber { get; private set; }
    public String ownerName { get; private set; }
    public Decimal amount { get; private set; }

    public OpportunityInfo(Opportunity opp) {
        this.id = opp.Id;
        this.amount = opp.Amount;
        this.accountName = opp.Account != null ? opp.Account.Name : null;
        this.accountNumber = opp.Account != null ? opp.Account.AccountNumber : null;
        this.ownerName = (opp.Account != null && opp.Account.Owner != null)
            ? opp.Account.Owner.Name : null;
    }
}
```

```apex
// method on OpportunitiesSelector
public List<OpportunityInfo> selectOpportunityInfo(Set<Id> idSet) {
    List<OpportunityInfo> infos = new List<OpportunityInfo>();
    if (idSet == null || idSet.isEmpty()) { return infos; }

    for (Opportunity opp : Database.query(
            newQueryFactory(false)                     // skip the selector's field list
                .selectField(Opportunity.Id)
                .selectField(Opportunity.Amount)
                .selectField('Account.Name')
                .selectField('Account.AccountNumber')
                .selectField('Account.Owner.Name')
                .setCondition('id in :idSet')
                .toSOQL())) {
        infos.add(new OpportunityInfo(opp));
    }
    return infos;
}
```

Use this whenever a UI needs five columns from a twenty-field selector: the heap cost of the wide
field list is the reason to bypass it.

## 5. QueryLocator selectors for Batch Apex

```apex
// methods on OpportunitiesSelector
public Database.QueryLocator queryLocatorReadyToInvoice() {
    return Database.getQueryLocator(
        newQueryFactory()
            .setCondition(Opportunity.InvoicedStatus__c + ' = \'Ready\'')
            .toSOQL());
}

public Database.QueryLocator queryLocatorClosedSince(Date since) {
    return Database.getQueryLocator(
        newQueryFactory()
            .setCondition('IsClosed = true AND CloseDate >= :since')
            .toSOQL());
}
```

```apex
public with sharing class CreateInvoicesJob implements Database.Batchable<SObject> {
    public Database.QueryLocator start(Database.BatchableContext ctx) {
        return OpportunitiesSelector.newInstance().queryLocatorReadyToInvoice();
    }
    public void execute(Database.BatchableContext ctx, List<SObject> scope) {
        InvoicingService.createInvoices(new Map<Id, SObject>(scope).keySet());
    }
    public void finish(Database.BatchableContext ctx) { }
}
```

`queryLocatorById(Set<Id>)` is already on the base class for the id-filtered case. A locator cannot
carry a mode clause difference from the rest of the selector - the mode comes from the same
`newQueryFactory()`. Re-querying the scope inside `execute()` must also go through a selector.
Batch specifics: skills `sf-async-apex-patterns` and `sf-fflib-operations`.

## 6. Aggregate wrapper (outside the standard contract)

```apex
public class PipelineByStage {
    public String stageName;
    public Decimal totalAmount;
    public Integer recordCount;
}
```

```apex
// method on OpportunitiesSelector
public List<PipelineByStage> selectOpenPipelineByStage(Set<Id> ownerIds) {
    List<PipelineByStage> rows = new List<PipelineByStage>();
    if (ownerIds == null || ownerIds.isEmpty()) { return rows; }

    for (AggregateResult ar : [
            SELECT StageName stage, SUM(Amount) total, COUNT(Id) cnt
              FROM Opportunity
             WHERE OwnerId IN :ownerIds AND IsClosed = false
             GROUP BY StageName
             ORDER BY StageName
              WITH USER_MODE]) {
        PipelineByStage row = new PipelineByStage();
        row.stageName = (String) ar.get('stage');
        row.totalAmount = (Decimal) ar.get('total');
        row.recordCount = (Integer) ar.get('cnt');
        rows.add(row);
    }
    return rows;
}
```

`fflib_QueryFactory.toSOQL()` always emits `SELECT <fields>` - there is no aggregate support - so
this is inline SOQL with `WITH USER_MODE` added by hand. Returning the wrapper rather than
`AggregateResult` keeps the mock stubbable and the caller readable.

A `COUNT()` variant:

```apex
public Integer countOpenByAccount(Id accountId) {
    return [SELECT COUNT() FROM Opportunity
             WHERE AccountId = :accountId AND IsClosed = false WITH USER_MODE];
}
```

## 7. Dynamic optional filters with bind maps

```apex
public class AccountSearchCriteria {
    public String nameFragment;
    public Set<String> ratings;
    public Date createdSince;
    public Integer maxRows;
}
```

```apex
// method on AccountsSelector
public List<Account> search(AccountSearchCriteria criteria) {
    fflib_QueryFactory qf = newQueryFactory();

    List<String> clauses = new List<String>();
    Map<String, Object> binds = new Map<String, Object>();

    if (String.isNotBlank(criteria.nameFragment)) {
        clauses.add('Name LIKE :nameLike');
        binds.put('nameLike', '%' + String.escapeSingleQuotes(criteria.nameFragment) + '%');
    }
    if (criteria.ratings != null && !criteria.ratings.isEmpty()) {
        clauses.add('Rating IN :ratings');
        binds.put('ratings', criteria.ratings);
    }
    if (criteria.createdSince != null) {
        clauses.add('CreatedDate >= :createdSince');
        binds.put('createdSince', criteria.createdSince);
    }
    if (!clauses.isEmpty()) {
        qf.setCondition(String.join(clauses, ' AND '));
    }
    qf.setLimit(criteria.maxRows == null ? 200 : Math.min(criteria.maxRows, 2000));

    return (List<Account>) Database.queryWithBinds(
        qf.toSOQL(), binds, AccessLevel.USER_MODE);
}
```

Three non-negotiables: values only ever travel through `binds`; the field and object names are
compile-time constants; a `LIMIT` is always present. If a caller genuinely needs to choose a *field*
to filter on, validate it first:

```apex
private String requireQueryableField(String apiName) {
    Schema.SObjectField token =
        fflib_SObjectDescribe.getDescribe(getSObjectType()).getField(apiName.toLowerCase());
    if (token == null) {
        throw new fflib_QueryFactory.InvalidFieldException(apiName, getSObjectType());
    }
    return token.getDescribe().getName();
}
```

## 8. Optional child subselects behind flags

```apex
public inherited sharing class AccountsWithChildrenSelector extends fflib_SObjectSelector
    implements IAccountsWithChildrenSelector
{
    private Boolean withContacts = false;
    private Boolean withChildAccounts = false;

    public static IAccountsWithChildrenSelector newInstance() {
        return (IAccountsWithChildrenSelector)
            Application.Selector.newInstance(Account.SObjectType);
    }

    public AccountsWithChildrenSelector() {
        super(false, fflib_SObjectSelector.DataAccess.USER_MODE);
    }

    public Schema.SObjectType getSObjectType() { return Account.SObjectType; }

    public List<Schema.SObjectField> getSObjectFieldList() {
        return new List<Schema.SObjectField> {
            Account.Id, Account.Name, Account.ParentId };
    }

    public IAccountsWithChildrenSelector withContacts() {
        this.withContacts = true;
        return this;
    }

    public IAccountsWithChildrenSelector withChildAccounts() {
        this.withChildAccounts = true;
        return this;
    }

    public List<Account> selectById(Set<Id> idSet) {
        if (idSet == null || idSet.isEmpty()) { return new List<Account>(); }
        fflib_QueryFactory qf = newQueryFactory().setCondition('id in :idSet');
        applySubselects(qf);
        return (List<Account>) Database.query(qf.toSOQL());
    }

    /** Call from every select* method so any query can opt into children. */
    private void applySubselects(fflib_QueryFactory qf) {
        if (withChildAccounts) {
            new AccountsSelector().addQueryFactorySubselect(qf, 'ChildAccounts');
        }
        if (withContacts) {
            new ContactsSelector()
                .addQueryFactorySubselect(qf, 'Contacts', false)  // no selector field list
                .selectFields(new List<String>{ 'Id', 'LastName', 'AccountId' });
        }
    }
}
```

Caller:

```apex
List<Account> accounts = ((IAccountsWithChildrenSelector) AccountsWithChildrenSelector.newInstance())
    .withContacts()
    .selectById(accountIds);
```

Flag-based subselects keep the query cost opt-in. Mutable selector state means the instance is not
reusable across calls - get a new one from the factory each time.

## 9. Cross-object field contribution without a subselect

```apex
// method on OpportunityLineItemsSelector: flatten parent data onto the child rows
public List<OpportunityLineItem> selectByOpportunityIdWithProduct(Set<Id> opportunityIds) {
    if (opportunityIds == null || opportunityIds.isEmpty()) {
        return new List<OpportunityLineItem>();
    }
    fflib_QueryFactory qf = newQueryFactory();
    new PricebookEntriesSelector().configureQueryFactoryFields(qf, 'PricebookEntry');
    new ProductsSelector().configureQueryFactoryFields(qf, 'PricebookEntry.Product2');

    return (List<OpportunityLineItem>) Database.query(
        qf.setCondition('OpportunityId IN :opportunityIds').toSOQL());
}
```

`configureQueryFactoryFields(qf, path)` prefixes every field from that selector's
`getSObjectFieldList()` with `path + '.'`, and adds `path + '.CurrencyIsoCode'` in a multi-currency
org. It does not add field-set fields and does not apply the other selector's ordering - the source
carries a TODO noting the inconsistency with `configureQueryFactory`.

## 10. No custom method at all: the factory helpers

```apex
// Anywhere in a service, when the registered selector's default field list is enough:
List<Account> parents =
    (List<Account>) Application.Selector.selectByRelationship(opportunities, Opportunity.AccountId);

List<Opportunity> opps =
    (List<Opportunity>) Application.Selector.selectById(opportunityIds);
```

`SelectorFactory.selectById` derives the SObjectType from the first Id and throws
`fflib_Application.DeveloperException` if the set is empty or mixes types.
`selectByRelationship` builds the parent Id set, skipping nulls, then delegates. Both go through the
registered selector, so mocks still apply. Use them for plain "get the parents" reads and write a
named selector method as soon as a filter or a field-list difference is involved.

## 11. Large-volume selective selector

```apex
public interface IAuditEntriesSelector extends fflib_ISObjectSelector {
    List<AuditEntry__c> selectRecentByAccount(Set<Id> accountIds, Integer maxRows);
    Database.QueryLocator queryLocatorOlderThan(Date cutoff);
}
```

```apex
public inherited sharing class AuditEntriesSelector extends fflib_SObjectSelector
    implements IAuditEntriesSelector
{
    private static final Integer DEFAULT_MAX_ROWS = 500;

    public static IAuditEntriesSelector newInstance() {
        return (IAuditEntriesSelector) Application.Selector.newInstance(AuditEntry__c.SObjectType);
    }

    public AuditEntriesSelector() {
        super(false, fflib_SObjectSelector.DataAccess.USER_MODE);
    }

    public Schema.SObjectType getSObjectType() { return AuditEntry__c.SObjectType; }

    /** Deliberately narrow: this object holds millions of rows. */
    public List<Schema.SObjectField> getSObjectFieldList() {
        return new List<Schema.SObjectField> {
            AuditEntry__c.Id,
            AuditEntry__c.Account__c,      // indexed lookup
            AuditEntry__c.EntryDate__c,    // external-id / indexed
            AuditEntry__c.Action__c
        };
    }

    /** Order by the indexed date, never by a formula or text field. */
    public override String getOrderBy() {
        return 'EntryDate__c DESC NULLS LAST';
    }

    public List<AuditEntry__c> selectRecentByAccount(Set<Id> accountIds, Integer maxRows) {
        if (accountIds == null || accountIds.isEmpty()) { return new List<AuditEntry__c>(); }
        return (List<AuditEntry__c>) Database.query(
            newQueryFactory()
                .setCondition('Account__c IN :accountIds AND EntryDate__c = LAST_N_DAYS:90')
                .setLimit(maxRows == null ? DEFAULT_MAX_ROWS : Math.min(maxRows, 2000))
                .toSOQL());
    }

    public Database.QueryLocator queryLocatorOlderThan(Date cutoff) {
        return Database.getQueryLocator(
            newQueryFactory().setCondition('EntryDate__c < :cutoff').toSOQL());
    }
}
```

Two selectivity rules applied here: the filter leads with an indexed lookup plus a bounded date
range, and `getSObjectFieldList()` stays at four fields. Skill `sf-soql-sosl-optimization` covers
index selectivity thresholds.

## 12. Legacy-enforcement selector (only for pre-user-mode code)

```apex
public inherited sharing class LegacyContactsSelector extends fflib_SObjectSelector
    implements ILegacyContactsSelector
{
    /** enforceCRUD = true, enforceFLS = true -> fflib_SecurityUtils describe checks per field. */
    public LegacyContactsSelector() {
        super(false, true, true);
    }

    public Schema.SObjectType getSObjectType() { return Contact.SObjectType; }

    public List<Schema.SObjectField> getSObjectFieldList() {
        return new List<Schema.SObjectField> {
            Contact.Id, Contact.LastName, Contact.Email };
    }

    public List<Contact> selectById(Set<Id> idSet) {
        if (idSet == null || idSet.isEmpty()) { return new List<Contact>(); }
        return (List<Contact>) selectSObjectsById(idSet);
    }
}
```

Behaviour difference to understand before choosing this: a field the running user cannot read raises
`fflib_SecurityUtils.FlsException` at *query build* time rather than letting the platform reject the
query, and every field path is resolved through `DescribeFieldResult` - the source itself calls that
"computationally expensive". Migration path: swap the constructor to
`super(false, fflib_SObjectSelector.DataAccess.USER_MODE)` and re-run the selector tests; the
exception type your callers must handle changes from `FlsException` to `System.QueryException`.
See [selector-security.md](selector-security.md).

## 13. Test skeleton for a selector

Selectors execute SOQL, so their own tests need data. Mocking belongs to the callers' tests.

```apex
@IsTest
private class AccountsSelectorTest {
    @TestSetup
    static void setup() {
        insert new Account(Name = 'Recipe Co', AccountNumber = 'AC-1', Rating = 'Hot');
    }

    @IsTest
    static void itShouldSelectByIdWithTheConfiguredFieldList() {
        Account acc = [SELECT Id FROM Account LIMIT 1];

        System.Test.startTest();
        List<Account> results = AccountsSelector.newInstance().selectById(new Set<Id>{ acc.Id });
        System.Test.stopTest();

        System.assertEquals(1, results.size(), 'Expected the inserted Account');
        System.assertEquals('AC-1', results[0].AccountNumber, 'AccountNumber must be selected');
    }

    @IsTest
    static void itShouldReturnEmptyForEmptyInput() {
        System.assertEquals(
            0,
            AccountsSelector.newInstance().selectById(new Set<Id>()).size(),
            'Empty input must not consume a SOQL statement');
    }

    @IsTest
    static void itShouldEmitUserModeInTheGeneratedSoql() {
        String soql = new AccountsSelector().newQueryFactory().toSOQL();
        System.assert(soql.contains('WITH USER_MODE'), 'Selector must run in user mode: ' + soql);
    }
}
```

The third test is the one worth keeping long term: it pins the security posture, which is a real
contract, rather than the SOQL text. Run a permission-restricted variant with `System.runAs` when
FLS behaviour itself is the requirement - see [selector-security.md](selector-security.md) and skill
`sf-apex-testing`.

## Recipe index

| # | Recipe | Key API |
| --- | --- | --- |
| 1 | standard object, minimal | `selectSObjectsById` |
| 2 | custom object, field sets, custom order | `getSObjectFieldSetList`, `getOrderBy` |
| 3 | parent + child subselect | `addQueryFactorySubselect`, `configureQueryFactoryFields` |
| 4 | narrow projection wrapper | `newQueryFactory(false)`, `selectField('Account.Owner.Name')` |
| 5 | batch query locators | `Database.getQueryLocator`, `queryLocatorById` |
| 6 | aggregate wrapper | inline SOQL + `WITH USER_MODE` |
| 7 | dynamic filters | `Database.queryWithBinds`, `AccessLevel.USER_MODE` |
| 8 | optional subselects | flags + `addQueryFactorySubselect(qf, name, false)` |
| 9 | flattened parent fields | `configureQueryFactoryFields` |
| 10 | factory helpers | `Application.Selector.selectById`/`selectByRelationship` |
| 11 | large volume, selective | narrow field list, indexed filter, `setLimit` |
| 12 | legacy CRUD/FLS | `super(false, true, true)` |
| 13 | selector test skeleton | `newQueryFactory().toSOQL()` assertion |

## Related

- Skill `sf-fflib-selector-layer` - the patterns these recipes implement
- [query-factory-api.md](query-factory-api.md), [selector-security.md](selector-security.md), [selector-antipatterns.md](selector-antipatterns.md)
- Skill `sf-fflib-foundations` - registering each selector in `Application.cls`
- Skill `sf-fflib-testing` - mocking these selectors from service tests
- Skill `sf-async-apex-patterns` - batch jobs consuming recipe 5
