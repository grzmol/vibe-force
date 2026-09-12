# Invocable Apex: `@InvocableMethod` and `@InvocableVariable`

Source: Apex Developer Guide, "InvocableMethod Annotation", "InvocableVariable Annotation",
"Passing Data to a Flow Using the Process.Plugin Interface", Summer '26 / API version 67.0.

An invocable method exposes Apex as an action that Flow, Process Builder and the Custom Invocable
Actions REST API endpoint can call. It is the supported bridge from declarative automation into
code.

## Hard rules

Implementation:

- The method must be **`static`** and **`public` or `global`**, and its class must be an **outer
  class**. No inner classes, no instance methods.
- **Only one method in a class** can carry `@InvocableMethod`.
- The only annotation that can be combined with `@InvocableMethod` is `@Deprecated`.

Inputs:

- **At most one input parameter.** Its type must be one of:
  - a list of a primitive type, or a list of lists of a primitive type - the generic `Object` type
    is **not** supported
  - a list of an sObject type, or a list of lists of an sObject type
  - `List<sObject>` or `List<List<sObject>>`
  - a list of a user-defined type whose members carry `@InvocableVariable`. The class must be
    `global` or `public` and must contain at least one member variable with the annotation

Outputs:

- If the return type is not null it must satisfy the same list rules as the input.

Gotcha from the guide: `@InvocableVariable` fields of type `List<List<sObject>>` are **not
supported** inside user-defined Apex classes and cause a **runtime error**. Use `List<List<sObject>>`
only as a direct `@InvocableMethod` return type.

## Supported modifiers

All optional.

| Modifier | Effect |
| --- | --- |
| `label` | The action name in Flow Builder. Defaults to the method name; the guide recommends always setting it |
| `description` | The action description in Flow Builder. Default null |
| `callout` | `callout=true` declares that the method calls an external system. Default `false` |
| `category` | The action category in Flow Builder. Without it, actions appear under `Uncategorized` |
| `configurationEditor` | A custom property editor registered with the method. Without it, Flow Builder uses the standard editor |
| `iconName` | Custom icon on the Flow Builder canvas: an SVG uploaded as a static resource, or a Salesforce Lightning Design System standard icon |
| `capabilityType` | The capability the method integrates with. Format `Name://Name`, for example `PromptTemplateType://SalesEmail` |

Flow Builder presentation can be customised further with the `InvocableActionExtension` metadata
file: parameter order, picklists, custom headers, partial custom property editors.

## The bulk contract

The platform passes a **list** and expects a **list** back because a flow can process many records
in one transaction. The list is the bulkification mechanism. Two obligations follow:

1. Do all database work once, outside any loop over the request list.
2. Return a list **the same size and in the same order** as the input when you return results, so
   the platform can match each result to its request.

### Correct

```apex
public with sharing class AssignTerritoryAction {

    public class Request {
        @InvocableVariable(required=true label='Account Id' description='Account to assign')
        public Id accountId;

        @InvocableVariable(label='Override territory')
        public String territory;
    }

    public class Result {
        @InvocableVariable(label='Assigned territory')
        public String territory;

        @InvocableVariable(label='Changed')
        public Boolean changed;
    }

    @InvocableMethod(
        label='Assign Territory'
        description='Resolves and stores the territory for each account'
        category='Sales Ops'
    )
    public static List<Result> run(List<Request> requests) {
        Set<Id> accountIds = new Set<Id>();
        for (Request r : requests) {
            accountIds.add(r.accountId);
        }

        Map<Id, Account> accounts = new Map<Id, Account>([
            SELECT Id, BillingCountry, Territory__c
            FROM Account
            WHERE Id IN :accountIds
            WITH USER_MODE
        ]);

        Map<String, String> byCountry = TerritoryRules.countryToTerritory();

        List<Account> toUpdate = new List<Account>();
        List<Result> results = new List<Result>();

        for (Request r : requests) {
            Result res = new Result();
            Account a = accounts.get(r.accountId);
            if (a == null) {
                res.changed = false;
                results.add(res);
                continue;
            }
            String resolved = String.isNotBlank(r.territory)
                ? r.territory
                : byCountry.get(a.BillingCountry);

            res.territory = resolved;
            res.changed = resolved != a.Territory__c;
            if (res.changed) {
                a.Territory__c = resolved;
                toUpdate.add(a);
            }
            results.add(res);
        }

        if (!toUpdate.isEmpty()) {
            update as user toUpdate;
        }
        return results;
    }
}
```

One query, one DML, one result per request, in order.

### Wrong

```apex
@InvocableMethod(label='Assign Territory')
public static void run(List<Request> requests) {
    for (Request r : requests) {
        Account a = [SELECT Id, BillingCountry FROM Account WHERE Id = :r.accountId];  // query in loop
        a.Territory__c = TerritoryRules.forCountry(a.BillingCountry);
        update a;                                                                       // DML in loop
    }
}
```

100 requests means 100 queries and 100 DML statements. Code Analyzer flags both; `vf-check analyzer`
fails the gate. See skill `sf-governor-limits`.

## Callouts from an invocable method

```apex
@InvocableMethod(label='Sync To ERP' callout=true category='Integration')
public static List<Result> run(List<Request> requests) { ... }
```

`callout=true` is a declaration, not a permission. The flow must still reach this action on a path
where a callout is legal: after-commit async paths are the safe home for one, because a callout is
not allowed after uncommitted DML in the same transaction. Retry, timeout and Named Credential
handling belong to skill `sf-integration-patterns`.

## Sharing and access mode

An invocable method is an entry point. Declare the class's sharing explicitly and set an explicit
access mode on every database operation - do not rely on the API 67.0 defaults to read the same way
on a class someone later downgrades. `with sharing` plus `WITH USER_MODE` and `as user` is the
default choice. Full rules: skill `sf-security-model`.

## Testing

A `FlowTest` covers the flow. It does not cover the Apex. Test the invocable method directly, as a
list, with more than one element:

```apex
@IsTest
private class AssignTerritoryActionTest {

    @IsTest
    static void assignsTerritoryForEveryRequest() {
        List<Account> accounts = new List<Account>{
            new Account(Name = 'A', BillingCountry = 'Poland'),
            new Account(Name = 'B', BillingCountry = 'Germany')
        };
        insert accounts;

        List<AssignTerritoryAction.Request> requests = new List<AssignTerritoryAction.Request>();
        for (Account a : accounts) {
            AssignTerritoryAction.Request r = new AssignTerritoryAction.Request();
            r.accountId = a.Id;
            requests.add(r);
        }

        Test.startTest();
        Integer queriesBefore = Limits.getQueries();
        List<AssignTerritoryAction.Result> results = AssignTerritoryAction.run(requests);
        Integer used = Limits.getQueries() - queriesBefore;
        Test.stopTest();

        Assert.areEqual(requests.size(), results.size(), 'one result per request, in order');
        Assert.isTrue(used <= 2, 'query count must not scale with request count, used ' + used);
    }

    @IsTest
    static void toleratesAMissingRecord() {
        AssignTerritoryAction.Request r = new AssignTerritoryAction.Request();
        r.accountId = '001000000000000AAA';

        List<AssignTerritoryAction.Result> results =
            AssignTerritoryAction.run(new List<AssignTerritoryAction.Request>{ r });

        Assert.areEqual(1, results.size());
        Assert.isFalse(results[0].changed, 'a missing record must not throw');
    }
}
```

A single-element test proves nothing about bulk behaviour. Test with at least two, and assert that
the query and DML counts stay constant.

## `Process.Plugin` - do not use in new code

The guide recommends `@InvocableMethod` instead, for these reasons:

| | `Process.Plugin` | `@InvocableMethod` |
| --- | --- | --- |
| Data types | No `Blob`, no collections, no sObject | All data types |
| Bulk operations | Not supported | Supported |
| Callable from | Flows only | Flows, processes, and the Custom Invocable Actions REST API endpoint |
| Flow Builder auto-layout | Not supported; free-form only. Existing actions can be edited in both modes | Supported |
| Presentation control | None | `InvocableActionExtension` metadata |

`Process.Plugin` classes appear in Flow Builder as **legacy Apex actions**. The interface requires
`describe()` returning `Process.PluginDescribeResult` and `invoke(Process.PluginRequest)` returning
`Process.PluginResult`. If you inherit one, the migration is: extract the body into a static method,
wrap the inputs in a class with `@InvocableVariable` members, annotate, repoint the flow, delete the
old class.

## Checklist before you ship an invocable action

- [ ] `static`, `public` or `global`, outer class, one annotated method
- [ ] Input is a `List` of a supported type; output is a `List` of the same cardinality and order
- [ ] No `List<List<sObject>>` inside an `@InvocableVariable`
- [ ] `label`, `description` and `category` set - an uncategorised action is unfindable
- [ ] `callout=true` if it calls out, and the flow calls it on an after-commit path
- [ ] Explicit sharing keyword and explicit access mode on every database operation
- [ ] Zero queries and zero DML inside the loop over the request list
- [ ] An Apex test with at least two requests asserting constant query and DML counts
- [ ] `vf-check analyzer` and `vf-check apex` green
