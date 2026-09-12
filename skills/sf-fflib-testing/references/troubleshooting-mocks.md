# Troubleshooting fflib mocks

Error text -> cause -> fix. Framework messages are copied verbatim from
`apex-enterprise-patterns/fflib-apex-mocks` `master` commit `d81e9e1` and
`fflib-apex-common` `master` commit `dab5977`. Platform messages are marked where their exact
wording was not verified this session.

Every framework failure is a `fflib_ApexMocks.ApexMocksException`. There is no `MethodNotMocked`
exception, no `MockitoException`, and no distinct verification-failure type: the verification
assertion is also an `ApexMocksException`.

## Stubbing errors

| Message | Thrown from | Cause | Fix |
| --- | --- | --- | --- |
| `The stubbing is not correct, no return values have been set.` | `fflib_ApexMocks.returnValue` / `fflib_MethodReturnValue.StandardAnswer` | A `when(...)` was recorded without a `thenReturn`/`thenThrow`/`thenAnswer`, or `thenReturnMulti`/`thenThrowMulti` got a null or empty list | Complete the stub. The exception fires at *call* time, not at stubbing time, so the stack trace points at production code |
| Method returns `null` unexpectedly, then `System.NullPointerException` deep in the class under test | not an ApexMocks error | The method was never stubbed; unstubbed methods return `null` silently | Stub it, or check the argument values match exactly - a stub registered for `selectById(setA)` does not answer `selectById(setB)` |
| Stub returns the *wrong* value | - | Two mocks of the same type share stubs because `fflib_ApexMocksConfig.HasIndependentMocks` is `false` | Set `fflib_ApexMocksConfig.HasIndependentMocks = true;` as the first line of the test method |
| A real call made between `startStubbing()` and `stopStubbing()` never executes | - | Everything in the stubbing block is recorded, not executed | Move real calls outside the block |
| A stub silently stops answering after the first call | - | `thenReturnMulti` exhausted; `StandardAnswer` returns the **last** value forever after | Intended behaviour - add more values if you need distinct ones |

## Matcher errors

| Message | Thrown from | Cause | Fix |
| --- | --- | --- | --- |
| `The number of matchers defined (1). does not match the number expected (2)` (plus the "all arguments must be passed in as matchers" hint) | `fflib_Match.getAndClearMatchers` | Mixed matchers and literals in one call, or a matcher leaked from a previous statement | Wrap every argument, e.g. `mock.add(fflib_Match.anyInteger(), fflib_Match.eq('String'))` |
| `MethodArgs cannot be null` | `fflib_Match.validateArgs` | Internal state corruption, usually a matcher registered outside any stub/verify | Ensure `fflib_Match.*` results are always passed directly as method arguments |
| `MethodArgs.argValues cannot be null` | `fflib_Match.validateArgs` | As above | As above |
| `Matchers cannot be null` | `fflib_Match.validateArgs` | As above | As above |
| `MethodArgs and matchers must have the same count, MethodArgs: (2) [...], Matchers: (1) [...]` | `fflib_Match.validateArgs` | Arity mismatch discovered during comparison | Same as the first row |
| `Arg cannot be null: null` | `fflib_MatcherDefinitions.validateNotNull` | A matcher that requires a value got `null`, e.g. `fflib_Match.stringStartsWith(null)` | Pass a value, or use `fflib_Match.isNull()` |
| `Arg cannot be null/empty: {}` | `SObjectWith.validate` | `fflib_Match.sObjectWith(...)` with a null or empty map | Provide at least one field/value pair |
| `Arg cannot be null/empty/other than list of map<Schema.SobjectField,Object>: ()` | `SObjectsWith.validate` | `fflib_Match.sObjectsWith(...)` with a null or empty list | Provide one map per expected record |
| `Invalid connective expression: null` | `Combined.validate` | A `Combined` matcher built with a null connective | Use `fflib_Match.allOf` / `anyOf` / `noneOf` rather than constructing `Combined` directly |
| `Invalid inner matchers: ()` | `Combined.validate` | `allOf`/`anyOf`/`noneOf` with an empty list | Supply at least one inner matcher |
| An `sObjectsWith` verification fails and the arguments look identical | `SObjectsWith.matches` swallows exceptions | The records were queried by a selector that did not select one of the matched fields, so reading it throws `SObject row was retrieved via SOQL without querying the requested field` and the match returns `false` | Add the field to the selector field list, or match on a field that is selected |

## Verification errors

The assertion template from `fflib_MethodVerifier.throwException`:

```text
EXPECTED COUNT: <n><qualifier><inOrder>
ACTUAL COUNT: <m>
METHOD: <Type>__sfdc_ApexStub.<method>(<ArgTypes>)
<custom message from description(...)>
---
ACTUAL ARGS: (<json>), (<json>)
---
EXPECTED ARGS: <matcher descriptions or json>
```

`<qualifier>` is empty for an exact count, ` or more times` when the minimum was not met, and
` or fewer times` when the maximum was exceeded. `<inOrder>` is ` in order` for `fflib_InOrder`.
The `ACTUAL ARGS` / `EXPECTED ARGS` block only appears when the method takes arguments.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ACTUAL COUNT: 0`, `ACTUAL ARGS: ()` | The method was never called on the mock | Check injection: was `Application.*.setMock` called, and does the class under test resolve through the factory rather than `new`? |
| `ACTUAL COUNT: 0` with populated `ACTUAL ARGS` | Called with different arguments | Diff the two blocks. Common causes: a regenerated fake id, a `Set` vs `List` argument, a `Decimal` scale difference |
| `ACTUAL COUNT: 2` where 1 was expected | The production code calls twice, or two mock instances share counts | Fix the production code, or set `HasIndependentMocks = true` |
| Counts include calls made during stubbing | `stopStubbing()` was never called, or a real call happened inside the block | Bracket the block correctly |
| A verification passes that should fail | The matcher is too loose (`anyObject()` everywhere) | Tighten to `sObjectWith`/`eq` for the fields that matter |
| `The calls() method is available only in the InOrder Verification.` | `mocks.calls(n)` passed to `mocks.verify(...)` | Use `mocks.times(n)`, or obtain an `fflib_InOrder` via `mocks.inOrder(...)` |
| `The atMost method is not implemented for the fflib_InOrder class` (same for `between`) | Unsupported mode under ordered verification | Use `times`, `calls`, `atLeast`, `atLeastOnce` or `never` in order |
| `No more Interactions were expected after the <Type>.<method>(<Args>) method.` | `fflib_InOrder.verifyNoMoreInteractions()` found a later invocation | Either verify the extra call or remove it from the production code |
| `No Interactions expected on this InOrder Mock instance!` | `fflib_InOrder.verifyNoInteractions()` found any invocation | As above |
| `Invalid index, must be greater or equal to zero and less of 2.` | `invocation.getArgument(i)` out of range inside an `fflib_Answer` | Use `getArguments().size()` to bound the index |
| Compile error on `mocks.verifyNoMoreInteractions()` | The method does not exist on `fflib_ApexMocks` | It lives on `fflib_InOrder` only; for unordered checks use `mocks.verify(mock, fflib_ApexMocks.NEVER)` per method |
| `fflib_System.assertEquals expects you to register exactly 1 fflib_IMatcher (typically through the helpers in fflib_Match).` | Zero or multiple matchers registered before the assert | Register exactly one |

## Stub-creation errors (platform)

`mocks.mock(Type)` is `Test.createStub(...)`, so the platform's restrictions apply. The Apex
Developer Guide lists what cannot be mocked:

| Cannot be stubbed | Consequence in an fflib codebase | Workaround |
| --- | --- | --- |
| Static methods, including `@future` | A static service facade cannot be mocked | Put logic in the `Impl` class behind an interface; keep the facade a one-liner |
| Private methods | Private helpers are invisible to the stub | Test them through the public method |
| Properties (getters and setters) | An interface exposing `public Decimal Total { get; set; }` cannot be stubbed | Expose `getTotal()` / `setTotal(...)` methods |
| Triggers | You cannot stub trigger execution | Use `fflib_SObjectDomain.Test.Database` or real DML |
| Inner classes | `mocks.mock(Outer.Inner.class)` fails | Move the type to a top-level class or interface |
| System types | `mocks.mock(Database.DMLOptions.class)` fails | Wrap in your own interface |
| Classes implementing `Batchable` | A batch class cannot be mocked | Mock its collaborators; run one real chunk |
| Classes with only private constructors | Singletons cannot be mocked | Add an interface, mock that |
| Iterators as a parameter or return type | Such methods cannot be stubbed | Use `List` in the interface |
| Types in another namespace | `Test.createStub` requires the mocked object to be in the same namespace as the call; the `StubProvider` implementation may live elsewhere | Define the interface in the namespace under test |

The runtime exception for an incompatible stub target is a `System.TypeException`; the exact
message wording is `[unverified]` - it was not confirmed against a running org this session. Treat
any `System.TypeException` raised by `mocks.mock(...)` as "this type is on the list above".

## fflib_Application errors during a test

| Message | Cause | Fix |
| --- | --- | --- |
| `No implementation registered for service interface <IFoo>` | No `setMock` for that interface and no entry in the `Application.Service` map | Call `Application.Service.setMock(IFoo.class, mock)`, or register the impl |
| `Selector class not found for SObjectType <Type>` | No `setMock` and no entry in the `Application.Selector` map | Use `Application.Selector.setMock(Type.SObjectType, mock)` |
| `Domain constructor class not found for SObjectType <Type>` | No entry in the `Application.Domain` map | Register the `Constructor` class, or `setMock` the domain |
| `Invalid record Id's set` | `Application.Selector.selectById(ids)` with an empty or null set | Guard callers, or stub the selector |
| `Unable to determine SObjectType, Set contains Id's from different SObject types` | Mixed-type id set - easy to produce with `fflib_IDGenerator` across types | Build the set from one type |
| `Unable to determine SObjectType` / `Must specify sObjectType` | Domain factory given an empty record list or a null type | Pass the `SObjectType` overload explicitly |
| `Permission to create an <Object> denied.` (also update/delete/undelete) | `fflib_SObjectDomain` CRUD security check under a restricted user | Expected in a negative test; otherwise grant the permission set or call `fflib_SObjectDomain.getTriggerEvent(...)`/`Configuration.disableTriggerCRUDSecurity()` deliberately |
| `System.NullPointerException` inside `Application.Selector.setMock(mock)` | The single-argument overload calls `mock.sObjectType()`, which is unstubbed and returns `null` | Stub `sObjectType()`, or use `setMock(SObjectType, mock)` |

## Debugging procedure

Work top to bottom; each step is cheap and eliminates a whole class of cause.

1. **Read the whole assertion.** `ACTUAL COUNT: 0` with `ACTUAL ARGS: ()` means "never called";
   anything else means "called differently". These are completely different bugs.
2. **Confirm injection.** Temporarily assert the factory returns the mock:
   ```apex
   Assert.areSame(selectorMock, Application.Selector.newInstance(Account.SObjectType),
       'Selector factory must return the mock');
   ```
   If this fails, the problem is `setMock`, not the mock.
3. **Confirm the class under test uses the factory.** Search the production class for `new ` on a
   selector, domain, service or Unit of Work. Any direct construction defeats injection.
4. **Confirm stubbing is closed.** `stopStubbing()` present, and no real calls inside the block.
5. **Loosen the matcher, then tighten.** Re-verify with `fflib_Match.anyObject()` for every
   argument. If it passes, the arguments differ and the earlier `ACTUAL ARGS` block tells you how.
   Tighten back to the minimum that still expresses the contract.
6. **Print the invocation log.** During investigation only:
   ```apex
   for (fflib_InvocationOnMock call : mocks.getOrderedMethodCalls()) {
       System.debug(LoggingLevel.ERROR, call.getMethod() + ' <- ' + call.getArguments());
   }
   ```
   `getMethod().toString()` renders as `Type.method(ArgTypes)`. Remove the loop before committing.
7. **Check `HasIndependentMocks`** if two mocks share a type.
8. **Check the stub-target list** if `mocks.mock(...)` itself threw.
9. **Ask whether a mock is the right tool at all.** If the failing expectation is about SOQL, DML,
   FLS, validation rules or trigger order, no mock configuration will make it correct - convert the
   test to recipe 4, 5, 6 or 13 in `test-variants-cookbook.md`.

## Running one test for a fast loop

```bash
sf apex run test --target-org vf-dev \
  --tests AccountsServiceTest.updateOpportunityActivityQueriesDelegatesAndCommits \
  --synchronous --result-format human --wait 20

# Full gate once the loop is green
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" apex --target-org vf-dev
```

`--synchronous` runs a single class inline and returns the assertion text immediately, which is
what you want while chasing a verification failure. See `sf-debugging-logs` for capturing the
`System.debug` output from step 6 and `sf-code-analyzer-quality` for the static rules that catch
assertion-free tests before they reach the org.
