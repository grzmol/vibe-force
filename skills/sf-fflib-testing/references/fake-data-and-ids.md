# Fake data, fake ids and read-only fields

How to build SObject graphs that never touch the database. Source: `fflib_IDGenerator.cls` and
`fflib_ApexMocksUtils.cls` at `apex-enterprise-patterns/fflib-apex-mocks` `master` commit
`d81e9e1`.

Every mocked test needs records with ids, parents, children and sometimes formula values, without
paying for DML. Three techniques cover all of it: `fflib_IDGenerator`, `makeRelationship`, and
`setReadOnlyFields`.

## fflib_IDGenerator

```apex
public static Id generate(Schema.SObjectType sObjectType)
```

Implementation: caches `sObjectType.getDescribe().getKeyPrefix()` per type, increments a static
counter, and left-pads the counter into a 12-character body, producing `001` + `00000000000` +
`1` -> `001000000000001`.

| Property | Value |
| --- | --- |
| Uniqueness | Per transaction, across all SObject types (one shared counter) |
| Format | Valid 15-character id with the correct key prefix, so `Id` methods and `getSObjectType()` work |
| Describe cost | One describe per type, cached in a static map |
| Valid for DML/SOQL | No. `insert`/`update`/`SELECT ... WHERE Id = :fakeId` against the org will not find the record |
| Determinism | Sequential within a method; do not assert on the literal value |

```apex
Id accountId = fflib_IDGenerator.generate(Account.SObjectType);
Account acct = new Account(Id = accountId, Name = 'Acme');

// Set<Id> from a list of faked records - the standard way to build selector arguments
List<Account> accounts = new List<Account>{
    new Account(Id = fflib_IDGenerator.generate(Account.SObjectType), Name = 'A'),
    new Account(Id = fflib_IDGenerator.generate(Account.SObjectType), Name = 'B') };
Set<Id> accountIds = new Map<Id, SObject>(accounts).keySet();
```

`new Map<Id, SObject>(records).keySet()` is the idiomatic fflib way to derive ids; it fails fast
with a `System.NullPointerException` if any record has a null `Id`, which is usually the bug you
want surfaced.

### Why you cannot just assign an Id

`new Account(Id = '001000000000001')` compiles and works, but hard-coded ids collide across test
methods and break when the key prefix differs (custom objects, packaging namespaces). Always
generate.

## Parent-child graphs: makeRelationship

A SOQL subquery result (`account.Contacts`) cannot be constructed with `put()`. `makeRelationship`
builds one by serialising parents and children to JSON, splicing a
`{"totalSize":n,"done":true,"records":[...]}` block into each parent under the child relationship
name, and deserialising the result.

```apex
public static Object makeRelationship(
    Type parentsType,                 // e.g. List<Account>.class
    List<SObject> parents,
    SObjectField relationshipField,   // the lookup field ON THE CHILD, e.g. Contact.AccountId
    List<List<SObject>> children)     // one inner list per parent, in the same order
```

```apex
Account parent = new Account(Id = fflib_IDGenerator.generate(Account.SObjectType), Name = 'Acme');
Contact child = new Contact(
    Id = fflib_IDGenerator.generate(Contact.SObjectType),
    LastName = 'Smith',
    AccountId = parent.Id);

List<Account> accounts = (List<Account>) fflib_ApexMocksUtils.makeRelationship(
    List<Account>.class,
    new List<Account>{ parent },
    Contact.AccountId,
    new List<List<Contact>>{ new List<Contact>{ child } });

Assert.areEqual(1, accounts[0].Contacts.size(), 'Subquery result must be populated');
Assert.areEqual('Smith', accounts[0].Contacts[0].LastName);
```

Rules:

- `children` must have exactly one inner list per parent, in parent order. A shorter list throws a
  `List index out of bounds` from the internal `childListIdx`.
- The relationship field must be a real child relationship of the parent type; the code scans
  `parentDescribe.getChildRelationships()` for a matching field and uses its
  `getRelationshipName()`. If no relationship matches, the injected field name is `null` and the
  deserialisation fails.
- Use the child's lookup field token (`Contact.AccountId`), not the parent's.
- The return type is `Object`; always cast to the concrete list type you passed as `parentsType`.

String overload for loosely coupled or dynamically named objects:

```apex
public static Object makeRelationship(
    String parentTypeName, String childTypeName,
    List<SObject> parents, String relationshipFieldName, List<List<SObject>> children)
```

It resolves types via `Schema.getGlobalDescribe()` and throws
`ApexMocksException('SObject type not found: <name>')` or
`ApexMocksException('SObject field not found: <name>')`. Note this overload deserialises into
`List<SObject>.class`, so cast accordingly.

### Multi-level graphs

Build bottom-up, one level per call:

```apex
// Level 1: Contacts under each Account
List<Account> accountsWithContacts = (List<Account>) fflib_ApexMocksUtils.makeRelationship(
    List<Account>.class, accounts, Contact.AccountId, contactsPerAccount);

// Level 2: Opportunities under the same Accounts - feed the previous result back in
List<Account> full = (List<Account>) fflib_ApexMocksUtils.makeRelationship(
    List<Account>.class, accountsWithContacts, Opportunity.AccountId, oppsPerAccount);
```

Each call re-serialises, so the previously injected relationship survives. Keep graphs shallow:
two levels is usually enough, and the JSON streaming cost is real CPU time.

## Read-only fields: setReadOnlyFields

Formula fields, roll-up summaries, `CreatedDate`, `LastModifiedDate`, `SystemModstamp`,
`CreatedById` and autonumbers all reject `SObject.put()` with
`System.SObjectException: Field is not writeable`. `setReadOnlyFields` writes them through JSON.

```apex
public static Object setReadOnlyFields(SObject objInstance, Type deserializeType, Map<SObjectField, Object> properties)
public static Object setReadOnlyFields(SObject objInstance, Type deserializeType, Map<String, Object> properties)
```

```apex
Account acct = new Account(Id = fflib_IDGenerator.generate(Account.SObjectType), Name = 'Acme');

acct = (Account) fflib_ApexMocksUtils.setReadOnlyFields(
    acct,
    Account.class,
    new Map<SObjectField, Object>{
        Account.LastActivityDate => Date.today().addDays(-7),
        Account.CreatedDate => DateTime.now().addDays(-30) });

Assert.areEqual(Date.today().addDays(-7), acct.LastActivityDate);
```

| Aspect | Behaviour |
| --- | --- |
| `deserializeType` | The concrete type to deserialise into: `Account.class` for a single record, `List<Account>.class` if you serialise a list |
| Null values | Written as an explicit JSON null (`writeNullField`), because `JSONGenerator.writeObjectField` throws on null |
| Return value | A **new** instance - reassign; the original is unchanged |
| Field tokens | The `SObjectField` overload resolves names via `field.getDescribe().getName()`, so it is namespace-safe |
| Unknown field names | The `String` overload injects them blindly; deserialisation then throws a JSON exception naming the field |

### The raw JSON fallback

For cases `setReadOnlyFields` cannot express - aggregate subquery counts, polymorphic `Owner`
fields, or `__r` parent references - hand-build the JSON:

```apex
Opportunity opp = (Opportunity) JSON.deserialize(
    '{"attributes":{"type":"Opportunity"},' +
    '"Id":"' + fflib_IDGenerator.generate(Opportunity.SObjectType) + '",' +
    '"Name":"Faked",' +
    '"Account":{"attributes":{"type":"Account"},"Name":"Parent Acme"}}',
    Opportunity.class);

Assert.areEqual('Parent Acme', opp.Account.Name, 'Parent relationship set without DML');
```

Constraints on this technique:

- The `attributes.type` member is mandatory for every nested object; without it the deserialiser
  cannot pick an SObject type.
- Field API names are case-insensitive but must exist, otherwise
  `System.JSONException: No such column '<name>' on sobject of type <Type>`.
- Reading a field you did **not** include behaves like a fully queried record returning `null`, not
  like a SOQL-restricted record. That is a meaningful difference: a fake record will never throw
  `SObject row was retrieved via SOQL without querying the requested field`, so a mocked test
  cannot catch a missing field in the selector's field list. Only recipe 4 in
  `test-variants-cookbook.md` catches that.

## Builders that work in both modes

Write one builder per object that can emit either an in-memory record (with a fake id) or a real
inserted record. This is what keeps mocked and DML tests sharing fixtures without sharing cost.

```apex
@IsTest
public class OpportunityBuilder {
    private Opportunity record = new Opportunity(
        Name = 'Test Opportunity',
        StageName = 'Prospecting',
        CloseDate = System.today().addDays(30),
        Amount = 1000);

    public OpportunityBuilder named(String name) {
        record.Name = name;
        return this;
    }

    public OpportunityBuilder amount(Decimal amount) {
        record.Amount = amount;
        return this;
    }

    public OpportunityBuilder forAccount(Id accountId) {
        record.AccountId = accountId;
        return this;
    }

    /** In-memory record with a generated id - for mocked tests. No DML. */
    public Opportunity buildFake() {
        record.Id = fflib_IDGenerator.generate(Opportunity.SObjectType);
        return record;
    }

    /** Persisted record - for selector, trigger and integration tests. Costs one DML row. */
    public Opportunity insertReal() {
        record.Id = null;
        insert record;
        return record;
    }

    public static List<Opportunity> fakeMany(Integer count, Id accountId) {
        List<Opportunity> results = new List<Opportunity>();
        for (Integer i = 0; i < count; i++) {
            results.add(new OpportunityBuilder().named('Opp ' + i).forAccount(accountId).buildFake());
        }
        return results;
    }
}
```

Design rules for these builders:

- Mark the class `@IsTest` so it does not consume production coverage or ship in a package.
- Never call `insert` from `buildFake()`. A builder that sometimes does DML makes mocked tests
  unpredictably slow and consumes limits you were trying to avoid.
- `insertReal()` clears `Id` first, so a builder instance is safe to reuse after `buildFake()`.
- Required-field defaults belong in the builder, not in every test. When a new required field is
  added to the object, one edit fixes every test.
- Expose a bulk helper (`fakeMany`) - bulk assertions are where domain bugs actually live.

## Choosing a technique

| You need | Use |
| --- | --- |
| An id on an in-memory record | `fflib_IDGenerator.generate(Type.SObjectType)` |
| `parent.Children__r` populated | `fflib_ApexMocksUtils.makeRelationship` |
| A formula, roll-up or audit field value | `fflib_ApexMocksUtils.setReadOnlyFields` |
| `child.Parent__r.Field__c` populated | Raw `JSON.deserialize` with nested `attributes.type` |
| Records that triggers, validation or FLS will see | Real DML - none of the above |
| Field-list coverage of a selector | Real DML (recipe 4) |

See `test-variants-cookbook.md` for these fixtures inside complete tests,
`matchers-and-captors.md` for asserting on the resulting records, and `sf-governor-limits` for the
DML and CPU budgets that make fakes worth the effort.
