# Migrating legacy DML-heavy tests to the fflib pyramid

A typical pre-fflib org has one test class per production class, each inserting a graph of records
and asserting on re-queried data. Coverage is high, feedback is slow, and a single validation-rule
change breaks fifty tests. This is how to convert incrementally without dropping below the
`apexOrgCoverageMin` 85 / `apexClassCoverageMin` 75 gates at any point.

Never delete a legacy test before its replacement exists and passes. Coverage must stay monotonic.

## The starting shape

```apex
@IsTest
private class OpportunityHelperTest {
    @IsTest
    static void testApplyDiscount() {
        Account a = new Account(Name = 'Test');
        insert a;
        Opportunity o = new Opportunity(Name = 'Test', StageName = 'Open',
            CloseDate = System.today(), Amount = 1000, AccountId = a.Id);
        insert o;
        Product2 p = new Product2(Name = 'Widget');
        insert p;
        // ... 40 more lines of setup ...

        OpportunityHelper.applyDiscount(new List<Id>{ o.Id }, 10);

        System.assertEquals(900, [SELECT Amount FROM Opportunity WHERE Id = :o.Id].Amount);
    }
}
```

Problems: 50 lines of setup for one assertion; every unrelated schema change breaks it; the
assertion cannot distinguish "the discount maths is wrong" from "a validation rule rejected the
save"; and it runs for seconds.

## Migration ladder

Run the rungs in order. Each rung leaves the suite green and coverage unchanged or higher.

| Rung | Action | Coverage effect | Risk |
| --- | --- | --- | --- |
| 0 | Baseline: record current org and per-class coverage | none | none |
| 1 | Extract record setup into an `@IsTest` builder used by the legacy test unchanged | none | very low |
| 2 | Introduce the selector and its real-data test (recipe 4) | selector class covered | low |
| 3 | Move logic from the helper into a domain class; add a no-DML domain test (recipe 2) | domain class covered | medium |
| 4 | Introduce the service `Impl` + interface; add a mocked service test (recipe 1) | service class covered | medium |
| 5 | Reduce the legacy test to one integration test (recipe 5) and delete the rest | net neutral if rungs 2-4 landed | medium |
| 6 | Delete dead helper code and its tests | coverage percentage usually rises | low |

### Rung 0: baseline

```bash
sf apex run test --target-org vf-dev --test-level RunLocalTests \
  --code-coverage --result-format json --wait 60 > baseline-coverage.json

node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-dev
```

Keep `baseline-coverage.json`. After every rung, re-run and diff per-class coverage. A class that
drops below 75% blocks the gate even when org coverage is fine.

### Rung 1: extract builders

Replace inline setup with a builder that can emit fake or real records
(`fake-data-and-ids.md`). Change nothing else - the legacy test still does DML and still passes.

```apex
@IsTest
static void testApplyDiscount() {
    Account a = new AccountBuilder().named('Test').insertReal();
    Opportunity o = new OpportunityBuilder().named('Test').amount(1000).forAccount(a.Id).insertReal();

    OpportunityHelper.applyDiscount(new List<Id>{ o.Id }, 10);

    Assert.areEqual(900, [SELECT Amount FROM Opportunity WHERE Id = :o.Id].Amount,
        'A 10% discount on 1000 leaves 900');
}
```

This rung alone often halves the line count of a legacy suite and is a safe, mechanical change.
Upgrade `System.assertEquals` to `Assert.areEqual` with a message while you are in the file.

### Rung 2: selectors first

Selectors are the safest thing to extract because their test needs real data anyway - the legacy
setup transfers directly.

1. Create `IOpportunitiesSelector` / `OpportunitiesSelector`, moving one inline SOQL query into it.
2. Register it in `Application.Selector`.
3. Write the selector test (recipe 4) using the builder from rung 1.
4. Point the legacy helper at `Application.Selector.newInstance(Opportunity.SObjectType)`.

The legacy test still passes because behaviour is unchanged. Selector coverage is now real rather
than incidental - which matters, because once services start mocking selectors, nothing else covers
their SOQL.

### Rung 3: domain

Move record-level logic out of the helper into a domain class. The domain test needs no DML at
all.

```apex
// Before: static helper doing maths and DML
public static void applyDiscount(List<Id> ids, Decimal percent) { ... }

// After: domain method mutating records and registering intent
public void applyDiscount(Decimal percent, fflib_ISObjectUnitOfWork uow) {
    for (Opportunity opp : (List<Opportunity>) Records) {
        opp.Amount = opp.Amount * (1 - percent / 100);
        uow.registerDirty(opp);
    }
}
```

The domain test (recipe 2) asserts both the mutated record *and* the `registerDirty` interaction.
At this point the legacy test still exercises the whole path, so coverage does not move - you have
simply added a fast test on top.

### Rung 4: service

Introduce `IOpportunitiesService`, `OpportunitiesServiceImpl` and the static facade, registered in
`Application.Service`. The helper becomes a delegating shim:

```apex
public with sharing class OpportunityHelper {
    // Deprecated shim - callers are being migrated to OpportunitiesService.
    public static void applyDiscount(List<Id> ids, Decimal percent) {
        Map<Id, Decimal> byId = new Map<Id, Decimal>();
        for (Id oppId : ids) {
            byId.put(oppId, percent);
        }
        OpportunitiesService.applyDiscounts(byId);
    }
}
```

Write the mocked service test (recipe 1). Then migrate callers - triggers, controllers, batch
classes - to `OpportunitiesService` one at a time, and delete the shim when the last caller moves.
A shim that survives the migration is a failure of the migration, not a feature.

### Rung 5: collapse the legacy tests

Only now delete. For each legacy test method, ask which replacement covers it:

| Legacy assertion | Replacement |
| --- | --- |
| Field maths on saved records | Domain test (recipe 2) |
| "the right records were queried" | Selector test (recipe 4) + mocked service verification (recipe 1) |
| "a validation error was raised" | Domain trigger test (recipe 3) for registration + one DML test (recipe 6) for the `DmlException` |
| "the whole flow works" | Keep exactly one integration test (recipe 5) |
| "the user without permission is blocked" | FLS test (recipe 13) |
| Nothing identifiable - no assertion, or asserts a constant | Delete outright |

Keep one integration test per user-visible flow, not per method. Ten integration tests over a
service is a smell; one, plus a full set of mocked tests, is the target.

### Rung 6: delete dead code

Once callers are migrated, delete the helper and its remaining tests. Deleting an uncovered or
poorly covered class usually *raises* org coverage, so do this before re-checking the gate.

## Keeping the gate green throughout

| Situation | What happens | Response |
| --- | --- | --- |
| Rung 4 lands, legacy test deleted too early | The service `Impl` is covered but the selector drops below 75% | Restore the legacy test until rung 2 is done for that selector |
| Domain extracted, trigger handler now thin | Handler class coverage may fall below 75% | The recipe 3 test covers the handler; add it in the same change |
| Shim class left behind | Shim has no test of its own | Cover it from the one integration test, or delete it |
| Org coverage dips after deleting a big DML test | Many classes lost incidental coverage | Delete in smaller batches, one class at a time, re-running `vf-check apex` between |

```bash
# After each rung
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-dev

# Targeted while iterating
sf apex run test --target-org vf-dev --class-names OpportunitiesServiceTest,OpportunitiesSelectorTest \
  --synchronous --code-coverage --result-format human --wait 30
```

## Things not to do during a migration

| Anti-pattern | Why it hurts |
| --- | --- |
| Converting a DML test to a mocked test by mocking the selector *and* keeping the same assertions | The assertions now prove nothing: the mock returns the data the test supplied |
| Adding `@IsTest(SeeAllData=true)` to make a legacy test pass after refactoring | Hides a real data dependency and breaks in fresh scratch orgs |
| Deleting a legacy test "because the new one covers it" without checking per-class coverage | The gate fails on a class you did not think about |
| Writing a mocked test that asserts `Assert.isNotNull(result)` to restore a coverage number | Coverage padding; delete it and write a real assertion instead |
| Leaving both the legacy test and its replacement | Doubles suite time and guarantees they diverge |
| Migrating a trigger to a domain without adding the recipe 3 test | Validation logic ends up with only slow DML coverage |
| Moving logic into a service but calling it from the trigger without `Application.Service` | The service can never be mocked by the trigger's test |

## Order of attack across a whole org

1. The layer with the most duplicated setup code - usually selectors. Biggest suite-time win per
   hour spent.
2. The domain classes behind the noisiest triggers. Biggest reduction in flaky failures.
3. The services with the most branches. Biggest gain in assertion quality.
4. Controllers and invocables last: they are thin, and their tests get fast for free once the
   services beneath them are mockable.

See `sf-fflib-foundations` for introducing the `Application` class into an org that does not have
one, `sf-fflib-selector-layer` and `sf-fflib-domain-service-uow` for the production-side
extractions, `sf-apex-testing` for the general coverage strategy, and `sf-workflow-orchestration`
for running the migration as a multi-wave change.
