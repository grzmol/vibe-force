# Matchers, captors and custom matching

Source: `fflib_Match.cls`, `fflib_MatcherDefinitions.cls`, `fflib_ArgumentCaptor.cls`,
`fflib_IMatcher.cls`, `fflib_System.cls` at `apex-enterprise-patterns/fflib-apex-mocks` `master`
commit `d81e9e1`. The `Failure text` column is each matcher's `toString()`, which is exactly what
`fflib_MethodVerifier` prints under `EXPECTED ARGS`.

## The two rules that cause 90% of matcher failures

1. **All or nothing.** If any argument of a stubbed or verified call uses a matcher, every
   argument must. `fflib_Match.getAndClearMatchers(expectedSize)` compares the registered matcher
   count to the method's arity and throws:

   ```text
   The number of matchers defined (1). does not match the number expected (2)
   If you are using matchers all arguments must be passed in as matchers.
   For example myList.add(fflib_Match.anyInteger(), 'String') should be defined as
   myList.add(fflib_Match.anyInteger(), fflib_Match.eq('String')).
   ```

2. **Matchers live for exactly one call.** `fflib_Match.matches(...)` pushes onto a static list
   that `getAndClearMatchers` drains. A matcher created but never consumed (for example built in a
   local variable and not passed as an argument) leaks into the *next* verification and breaks it.

## Registration mechanics

```apex
public static Object matches(fflib_IMatcher matcher)  // sets Matching = true, records, returns null
```

Every `fflib_Match.anyX()` / `eqX()` helper calls `matches(...)` and casts the `null` result to the
right static type so Apex overload resolution picks the correct method on the mock. That is why
`fflib_Match.anyId()` is typed `Id` and `fflib_Match.anyList()` is typed `List<Object>`: the value
is always `null`; only the compile-time type matters.

Validation errors from `fflib_Match.matchesAllArgs`:

| Condition | Message |
| --- | --- |
| `methodArg == null` | `MethodArgs cannot be null` |
| `methodArg.argValues == null` | `MethodArgs.argValues cannot be null` |
| `targetMatchers == null` | `Matchers cannot be null` |
| arity mismatch | `MethodArgs and matchers must have the same count, MethodArgs: (n) [...], Matchers: (m) [...]` |

## Equality and reference matchers

| `fflib_Match` factory | Return type | Matches when | Failure text |
| --- | --- | --- | --- |
| `eq(Object toMatch)` | `Object` | `arg == toMatch` | `[equals <json>]` |
| `eqBoolean(Boolean)` | `Boolean` | value equality | `[equals <json>]` |
| `eqDate(Date)` | `Date` | value equality | `[equals <json>]` |
| `eqDatetime(Datetime)` | `Datetime` | value equality | `[equals <json>]` |
| `eqDecimal(Decimal)` | `Decimal` | value equality | `[equals <json>]` |
| `eqDouble(Double)` | `Double` | value equality | `[equals <json>]` |
| `eqId(Id)` | `Id` | value equality | `[equals <json>]` |
| `eqInteger(Integer)` | `Integer` | value equality | `[equals <json>]` |
| `eqList(List<Object>)` | `List<Object>` | value equality | `[equals <json>]` |
| `eqLong(Long)` | `Long` | value equality | `[equals <json>]` |
| `eqSObjectField(SObjectField)` | `SObjectField` | value equality | `[equals <json>]` |
| `eqSObjectType(SObjectType)` | `SObjectType` | value equality | `[equals <json>]` |
| `eqString(String)` | `String` | value equality | `[equals <json>]` |
| `refEq(Object)` | `Object` | `arg === toMatch` (same instance) | `[reference equals <json>]` |

Typed `eqX` helpers exist so the mock's overload resolution is unambiguous. If a mocked interface
has `save(String)` and `save(Id)`, `fflib_Match.eq('x')` is ambiguous; `fflib_Match.eqString('x')`
is not.

## "Any" matchers

| Factory | Return type | Failure text |
| --- | --- | --- |
| `anyBoolean()` | `Boolean` | `[any Boolean]` |
| `anyDate()` | `Date` | `[any Date]` |
| `anyDatetime()` | `Datetime` | `[any DateTime]` |
| `anyDecimal()` | `Decimal` | `[any Decimal]` |
| `anyDouble()` | `Double` | `[any Double]` |
| `anyFieldSet()` | `Schema.FieldSet` | `[any FieldSet]` |
| `anyId()` | `Id` | `[any Id]` |
| `anyInteger()` | `Integer` | `[any Integer]` |
| `anyList()` | `List<Object>` | `[any list]` |
| `anyLong()` | `Long` | `[any Long]` |
| `anyObject()` | `Object` | `[any Object]` |
| `anyString()` | `String` | `[any String]` |
| `anySObject()` | `SObject` | `[any SObject]` |
| `anySObjectField()` | `SObjectField` | `[any SObjectField]` |
| `anySObjectType()` | `SObjectType` | `[any SObjectType]` |

## Null and collection matchers

| Factory | Matches | Failure text |
| --- | --- | --- |
| `isNull()` | `arg == null` | `[is null]` |
| `isNotNull()` | `arg != null` | `[is not null]` |
| `listContains(Object toMatch)` | a `List` containing `toMatch` | `[list containing <json>]` |
| `listIsEmpty()` | an empty `List` | `[empty list]` |

## String matchers

| Factory | Matches | Failure text |
| --- | --- | --- |
| `stringContains(String)` | `contains` | `[contains "x"]` |
| `stringStartsWith(String)` | `startsWith` | `[starts with "x"]` |
| `stringEndsWith(String)` | `endsWith` | `[ends with "x"]` |
| `stringMatches(String regEx)` | regex match | `[matches regex "x"]` |
| `stringIsBlank()` | `String.isBlank` | `[blank String]` |
| `stringIsNotBlank()` | `String.isNotBlank` | `[non-blank String]` |

All `String*` matchers with a required argument run `validateNotNull`, throwing
`ApexMocksException('Arg cannot be null: null')` on a null argument.

## Numeric and temporal range matchers

| Factory | Overloads | Failure text |
| --- | --- | --- |
| `dateAfter(Date[, Boolean inclusive])` | inclusive defaults to exclusive | `[after <json>]` / `[on or after <json>]` |
| `dateBefore(Date[, Boolean])` | | `[before <json>]` / `[on or before <json>]` |
| `dateBetween(Date, Date)` / `dateBetween(Date, Boolean, Date, Boolean)` | | `[<after|on or after> <json> and <before|on or before> <json>]` |
| `datetimeAfter(Datetime[, Boolean])` | | as above |
| `datetimeBefore(Datetime[, Boolean])` | | as above |
| `datetimeBetween(Datetime, Datetime)` / 4-arg | | as above |
| `decimalLessThan(Decimal[, Boolean])` | | `[less than <n>]` / `[less than or equal to <n>]` |
| `decimalMoreThan(Decimal[, Boolean])` | | `[greater than <n>]` / `[greater than or equal to <n>]` |
| `decimalBetween(Decimal, Decimal)` / 4-arg | | `greater than[ or equal to] <lo> and less than[ or equal to] <hi>` |
| `doubleLessThan` / `doubleMoreThan` / `doubleBetween` | same shapes | same shapes |
| `integerLessThan` / `integerMoreThan` / `integerBetween` | same shapes | same shapes |
| `longLessThan` / `longMoreThan` / `longBetween` | same shapes | same shapes |

Date and Datetime matchers share the `Datetime*` implementations
(`fflib_MatcherDefinitions.DatetimeAfter`, `DatetimeBefore`, `DatetimeBetween`); the `date*`
factories convert. Decimal, Double, Integer and Long range factories all delegate to the
`Decimal*` implementations.

## SObject matchers - the ones that matter for Unit of Work verification

| Factory | Matches | Failure text |
| --- | --- | --- |
| `sObjectOfType(Schema.SObjectType)` | `arg` is an `SObject` of that type | `[SObject of type Account]` |
| `sObjectWith(Map<SObjectField, Object>)` | each listed field on the single `SObject` equals the listed value | `[SObject with fields {...}]` |
| `sObjectsWith(List<Map<SObjectField, Object>>)` | ordered element-wise match over a `List<SObject>` | `[ordered SObjects with [...]]` |
| `sObjectsWith(List<Map<SObjectField, Object>>, Boolean matchInOrder)` | `false` = each argument element must match exactly one matcher element and vice versa | `[unordered SObjects with [...]]` |
| `sObjectWithId(Id)` | `arg.Id == toMatch` | `[SObject with Id "001..."]` |
| `sObjectWithName(String)` | `arg.Name == toMatch` | `[SObject with Name "Acme"]` |

```apex
((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).registerDirty(
    fflib_Match.sObjectWith(new Map<SObjectField, Object>{
        Opportunity.Id => opp.Id,
        Opportunity.Amount => 900 }));

((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).registerNew(
    fflib_Match.sObjectsWith(new List<Map<SObjectField, Object>>{
        new Map<SObjectField, Object>{ InvoiceLine__c.Description__c => 'First' },
        new Map<SObjectField, Object>{ InvoiceLine__c.Description__c => 'Second' } }));
```

Constructor validation: `sObjectWith` and `sObjectsWith` reject null/empty maps -
`Arg cannot be null/empty: {}` and
`Arg cannot be null/empty/other than list of map<Schema.SobjectField,Object>: ()` respectively.

**Silent-failure trap documented in the source:** `SObjectsWith` catches exceptions while reading
field values from the argument records. If the records came from a SOQL query that did not select
one of the fields you are matching on, the `SObject row was retrieved via SOQL without querying the
requested field` exception is swallowed and the match simply returns `false`. When an
`sObjectsWith` verification fails inexplicably, check the selector's field list first.

## Combining matchers

| Factory | Overloads | Failure text |
| --- | --- | --- |
| `allOf(o1, o2[, o3[, o4]])` / `allOf(List<Object>)` | up to 4 fluent, list for more | `[all of: <m1>, <m2>]` |
| `anyOf(o1, o2[, o3[, o4]])` / `anyOf(List<Object>)` | | `[any of: <m1>, <m2>]` |
| `noneOf(o1, o2[, o3[, o4]])` / `noneOf(List<Object>)` | | `[none of: <m1>, <m2>]` |
| `isNot(o1)` | negation of a single matcher | `[none of: <m1>]` |

The arguments to these are the `null` sentinels returned by other `fflib_Match` calls, so they
nest naturally:

```apex
((IEmailService) mocks.verify(emailMock)).sendTo(
    (String) fflib_Match.allOf(
        fflib_Match.stringContains('@example.com'),
        fflib_Match.isNot(fflib_Match.stringStartsWith('no-reply'))));
```

`Combined` rejects a null connective (`Invalid connective expression: null`) and a null/empty inner
matcher list (`Invalid inner matchers: ()`).

## fflib_ArgumentCaptor

Use a captor when the argument is too complex for a matcher, or when you want to assert several
properties of it with normal `Assert` calls.

```apex
@IsTest
static void invoiceServiceRegistersOneLinePerProduct() {
    fflib_ApexMocks mocks = new fflib_ApexMocks();
    fflib_ISObjectUnitOfWork uowMock = (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);
    Application.UnitOfWork.setMock(uowMock);

    System.Test.startTest();
    new InvoicingServiceImpl().createInvoice(buildOrderWithTwoLines());
    System.Test.stopTest();

    fflib_ArgumentCaptor lineCaptor = fflib_ArgumentCaptor.forClass(List<InvoiceLine__c>.class);
    ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).registerNew((List<SObject>) lineCaptor.capture());

    List<InvoiceLine__c> lines = (List<InvoiceLine__c>) lineCaptor.getValue();
    Assert.areEqual(2, lines.size(), 'One invoice line per order line');
    Assert.areEqual(150, lines[0].Amount__c + lines[1].Amount__c, 'Total should be the order total');
}
```

| Method | Behaviour |
| --- | --- |
| `forClass(Type)` | The `Type` argument is ignored at runtime - the source says so explicitly. Still pass the correct one; type checking may be added |
| `capture()` | Registers an `AnyObject` matcher that always matches and remembers the value. Counts as a matcher, so the all-or-nothing rule applies |
| `getValue()` | Last captured value; `null` when nothing was captured |
| `getAllValues()` | Every captured value, merged across multiple arguments and multiple matching invocations |

Capturing only happens during verification: `fflib_MethodVerifier.capture(matchers)` runs from
`fflib_AnyOrder.getMethodCount` for each invocation that matched **all** matchers. Consequences:

- A captor inside `startStubbing()` captures nothing.
- `verify(mock, fflib_ApexMocks.NEVER)` with a captor captures nothing (no invocation matched).
- `verify(mock, 3)` with a captor gives three entries in `getAllValues()`, latest in `getValue()`.

## Custom matchers

Implement `fflib_IMatcher` and register with `fflib_Match.matches(...)`, casting the `null` result
to the parameter type of the mocked method.

```apex
@IsTest
private class ChargeServiceTest {

    // Matches any Invoice__c whose total is within a tolerance of an expected value.
    private class InvoiceTotalWithin implements fflib_IMatcher {
        private final Decimal expected;
        private final Decimal tolerance;

        private InvoiceTotalWithin(Decimal expected, Decimal tolerance) {
            this.expected = expected;
            this.tolerance = tolerance;
        }

        public Boolean matches(Object arg) {
            if (!(arg instanceof Invoice__c)) {
                return false;
            }
            Decimal actual = ((Invoice__c) arg).Total__c;
            return actual != null && Math.abs(actual - expected) <= tolerance;
        }

        // Printed under EXPECTED ARGS when the verification fails.
        public override String toString() {
            return '[Invoice total within ' + tolerance + ' of ' + expected + ']';
        }
    }

    private static Invoice__c invoiceTotalWithin(Decimal expected, Decimal tolerance) {
        return (Invoice__c) fflib_Match.matches(new InvoiceTotalWithin(expected, tolerance));
    }

    @IsTest
    static void chargeRegistersRoundedInvoice() {
        fflib_ApexMocks mocks = new fflib_ApexMocks();
        fflib_ISObjectUnitOfWork uowMock = (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);
        Application.UnitOfWork.setMock(uowMock);

        System.Test.startTest();
        new ChargeServiceImpl().charge(new List<Decimal>{ 33.333, 33.333, 33.334 });
        System.Test.stopTest();

        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock, 1)).registerNew(invoiceTotalWithin(100, 0.01));
    }
}
```

Always override `toString()`. Without it the failure message prints the Apex default
`ChargeServiceTest.InvoiceTotalWithin:[expected=100, tolerance=0.01]`, which is readable but noisy;
with it, the failure is self-explanatory.

## Asserting values with matchers outside a mock

`fflib_System.assertEquals(matcher, value[, message])` applies a matcher to a plain value:

```apex
fflib_System.assertEquals(
    fflib_Match.sObjectWith(new Map<SObjectField, Object>{ Account.Industry => 'Technology' }),
    updatedAccount,
    'Industry should have been derived from the product family');
```

Exactly one matcher must be registered. Failure text:
`Expected : [SObject with fields {"Industry":"Technology"}], Actual: Account:{Industry=Media} -- <message>`.

Prefer plain `Assert.areEqual` for scalar comparisons; `fflib_System.assertEquals` earns its place
only when the matcher expresses something `Assert` cannot, such as a partial SObject field match.

## Reading a matcher failure

```text
EXPECTED COUNT: 1
ACTUAL COUNT: 0
METHOD: AccountsSelector__sfdc_ApexStub.selectById(Set<Id>)
---
ACTUAL ARGS: (["001000000000001AAA"])
---
EXPECTED ARGS: [[any Id]]
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ACTUAL ARGS: ()` and `ACTUAL COUNT: 0` | The method was never called | Check `Application.*.setMock` wiring and that the class under test resolves through the factory |
| `ACTUAL COUNT: 0` with populated `ACTUAL ARGS` | Called with different arguments | Diff the two blocks; loosen the matcher or fix the production code |
| `EXPECTED ARGS` shows JSON rather than `[...]` text | No matchers were used; raw values were compared with `==` | Intentional for exact matches; switch to matchers for partial matching |
| `The number of matchers defined (n)...` | Mixed matchers and literals | Wrap every argument |
| Unexpected match on an unrelated verification | A leaked matcher from a previous statement | Ensure every `fflib_Match.*` call is passed directly as an argument |

See `troubleshooting-mocks.md` for the full error catalogue and `apexmocks-api.md` for the
verification modes that produce the `EXPECTED COUNT` qualifiers (`or more times`,
`or fewer times`, ` in order`).
