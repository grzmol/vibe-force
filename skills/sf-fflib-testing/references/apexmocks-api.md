# ApexMocks API reference

Every public type in `fflib-apex-mocks`, extracted from source at
`apex-enterprise-patterns/fflib-apex-mocks` branch `master`, commit `d81e9e1`
(`sfdx-source/apex-mocks/main/classes`). Signatures below are copied from that source; anything
marked `[unverified]` was not confirmed there.

## Class inventory

| Class | Kind | Role | You call it directly |
| --- | --- | --- | --- |
| `fflib_ApexMocks` | class, `implements System.StubProvider` | Mock control object: create, stub, verify | Yes |
| `fflib_ApexMocksUtils` | class | Fake relationships and read-only field injection | Yes |
| `fflib_ApexMocksConfig` | `@IsTest` class | Global switch `HasIndependentMocks` | Yes |
| `fflib_IDGenerator` | class | Fake Salesforce ids | Yes |
| `fflib_Match` | class | Matcher factory (`anyId()`, `eq()`, `sObjectWith()`, ...) | Yes |
| `fflib_MatcherDefinitions` | class | The matcher implementations behind `fflib_Match` | Rarely |
| `fflib_IMatcher` | interface | `Boolean matches(Object arg)` - custom matchers | Yes, to implement |
| `fflib_Answer` | interface | `Object answer(fflib_InvocationOnMock)` - dynamic returns | Yes, to implement |
| `fflib_InvocationOnMock` | class | The invocation handed to an `fflib_Answer` | Yes, inside answers |
| `fflib_ArgumentCaptor` | class | Capture arguments during verification | Yes |
| `fflib_InOrder` | class, extends `fflib_MethodVerifier` | Ordered verification | Yes, via `mocks.inOrder(...)` |
| `fflib_AnyOrder` | class, extends `fflib_MethodVerifier` | Default (unordered) verifier | No - internal default |
| `fflib_VerificationMode` | class | `times`/`atLeast`/`atMost`/`between`/`atLeastOnce`/`calls`/`never`/`description` | Yes |
| `fflib_MethodVerifier` | abstract class | Assertion message construction | No |
| `fflib_MethodReturnValue` | `@IsTest` class | `thenReturn`/`thenThrow`/`thenAnswer`/`*Multi` | Yes, as `when(...)` result |
| `fflib_MethodReturnValueRecorder` | class | Stub storage | No |
| `fflib_MethodCountRecorder` | class | Invocation storage (instance + deprecated static mirror) | No |
| `fflib_QualifiedMethod` | class | Method identity key (type + name + arg types [+ instance]) | No |
| `fflib_QualifiedMethodAndArgValues` | class | Method + args pair | No |
| `fflib_MethodArgValues` | class | Argument tuple with `equals`/`hashCode` | No |
| `fflib_MatchersReturnValue` | class | Matchers paired with a stubbed return | No |
| `fflib_System` | class | `assertEquals(matcher, value[, message])` | Yes |
| `fflib_Inheritor` | `@IsTest` class | Framework's own multi-interface test fixture (`IA`/`IB`/`IC`) | No |

## fflib_ApexMocks

`public with sharing class fflib_ApexMocks implements System.StubProvider`

| Member | Signature | Purpose |
| --- | --- | --- |
| `NEVER` | `public static final Integer NEVER = 0` | Sugar for "zero invocations" in `verify(mock, NEVER)` |
| constructor | `fflib_ApexMocks()` | Creates the recorders; `verifying = false`, `Stubbing = false` |
| `mock` | `Object mock(Type classToMock)` | Returns `Test.createStub(classToMock, this)` |
| `handleMethodCall` | `Object handleMethodCall(Object stubbedObject, String stubbedMethodName, Type returnType, List<Type> listOfParamTypes, List<String> listOfParamNames, List<Object> listOfArgs)` | `System.StubProvider` callback; delegates to `mockNonVoidMethod` |
| `extractTypeName` | `static String extractTypeName(Object mockInstance)` | `String.valueOf(mock).split(':')[0]`, e.g. `IFoo__sfdc_ApexStub` |
| `verify` | `Object verify(Object mockInstance)` | Equivalent to `verify(mock, times(1))` |
| `verify` | `Object verify(Object mockInstance, Integer times)` | Exact count |
| `verify` | `Object verify(Object mockInstance, fflib_VerificationMode mode)` | Any mode |
| `verifyMethodCall` | `void verifyMethodCall(fflib_InvocationOnMock mockInvocation)` | Internal; resets the verifier to `fflib_AnyOrder` after each verify |
| `startStubbing` | `void startStubbing()` | Sets `Stubbing = true` |
| `stopStubbing` | `void stopStubbing()` | Sets `Stubbing = false` |
| `when` | `fflib_MethodReturnValue when(Object ignoredRetVal)` | Returns the recorder's pending `fflib_MethodReturnValue` |
| `doThrowWhen` | `Object doThrowWhen(Exception e, Object mockInstance)` | Stub a **void** method to throw |
| `doThrowWhen` | `Object doThrowWhen(List<Exception> exps, Object mockInstance)` | Consecutive throws for a void method |
| `doAnswer` | `Object doAnswer(fflib_Answer answer, Object mockInstance)` | Stub a **void** method with a side effect |
| `mockVoidMethod` | `void mockVoidMethod(Object mockInstance, String methodName, List<Type> methodArgTypes, List<Object> methodArgValues)` | Called by generated mock classes |
| `mockNonVoidMethod` | `Object mockNonVoidMethod(Object mockInstance, String methodName, List<Type> methodArgTypes, List<Object> methodArgValues)` | Called by generated mock classes |
| `inOrder` | `fflib_InOrder inOrder(List<Object> unorderedMockInstances)` | Builds the ordered verifier |
| `getOrderedMethodCalls` | `List<fflib_InvocationOnMock> getOrderedMethodCalls()` | Recorded invocations in call order |
| `recordMethod` | `void recordMethod(fflib_InvocationOnMock invocation)` | Internal |
| `prepareMethodReturnValue` | `fflib_MethodReturnValue prepareMethodReturnValue(fflib_InvocationOnMock)` | Internal |
| `getMethodReturnValue` | `fflib_MethodReturnValue getMethodReturnValue(fflib_InvocationOnMock)` | Internal |
| `setOrderedVerifier` | `void setOrderedVerifier(fflib_InOrder verifyOrderingMode)` | Internal, used by `fflib_InOrder` |
| `toString` | `override String toString()` | Returns the literal `'fflib_ApexMocks'` to avoid circular-reference errors |
| `verifying` | `public Boolean verifying { get; set; }` | True between `verify(mock)` and the verified call |
| `Stubbing` | `public Boolean Stubbing { get; private set; }` | Delegates to the return-value recorder |
| `DoThrowWhenExceptions` | `public List<Exception> DoThrowWhenExceptions { get; set; }` | Pending void-method throws |

Verification-mode factories mirrored on `fflib_ApexMocks` (each returns a fresh
`fflib_VerificationMode`): `times(Integer)`, `calls(Integer)`, `description(String)`,
`atLeast(Integer)`, `atMost(Integer)`, `atLeastOnce()`, `between(Integer, Integer)`, `never()`.

Nested exception: `public class ApexMocksException extends Exception` - **every** framework error
is this type. There is no `MethodNotMocked` exception in the source.

### Call dispatch

`mockNonVoidMethod` branches on state:

1. `verifying == true` -> `verifyMethodCall(invocation)` and return `null`.
2. `Stubbing == true` -> `prepareMethodReturnValue(invocation)`; apply any pending
   `DoThrowWhenExceptions` or `doAnswer`; return `null`.
3. otherwise -> `recordMethod(invocation)` and return the stubbed value.

`returnValue()` throws `ApexMocksException('The stubbing is not correct, no return values have
been set.')` when a `when(...)` was recorded without a `then*`, and rethrows the stubbed value when
it `instanceof Exception`.

## fflib_VerificationMode

`public enum ModeName { times, atLeast, atMost, between, atLeastOnce, calls }`

| Method | Sets | Available in `verify` | Available in `inOrder.verify` |
| --- | --- | --- | --- |
| `times(Integer n)` | `VerifyMin = VerifyMax = n` | Yes | Yes |
| `atLeast(Integer n)` | `VerifyMin = n` | Yes | Yes (greedy) |
| `atLeastOnce()` | `VerifyMin = 1` | Yes | Yes (greedy) |
| `atMost(Integer n)` | `VerifyMax = n` | Yes | **No** |
| `between(Integer lo, Integer hi)` | `VerifyMin = lo`, `VerifyMax = hi` | Yes | **No** |
| `never()` | `VerifyMin = VerifyMax = fflib_ApexMocks.NEVER` | Yes | Yes |
| `calls(Integer n)` | `VerifyMin = n`, `VerifyMax = null` | **No** | Yes (non-greedy) |
| `description(String msg)` | `CustomAssertMessage` | Yes | Yes |

Public properties: `VerifyMin`, `VerifyMax`, `CustomAssertMessage`, and the `ModeName Method`
field. Rejections:

- `fflib_AnyOrder.validateMode` -> `ApexMocksException('The calls() method is available only in the InOrder Verification.')`
- `fflib_InOrder.validateMode` -> `ApexMocksException('The ' + mode + ' method is not implemented for the fflib_InOrder class')` for `atMost` and `between`.

## fflib_InOrder

| Method | Signature | Notes |
| --- | --- | --- |
| constructor | `fflib_InOrder(fflib_ApexMocks mocks, List<Object> unorderedMockInstances)` | Deprecated; prefer `mocks.inOrder(new List<Object>{ ... })` |
| `verify` | `Object verify(Object mockInstance)` | `times(1)` semantics, in order |
| `verify` | `Object verify(Object mockInstance, Integer times)` | |
| `verify` | `Object verify(Object mockInstance, fflib_VerificationMode mode)` | |
| `verifyNoMoreInteractions` | `void verifyNoMoreInteractions()` | Throws `'No more Interactions were expected after the <method> method.'` |
| `verifyNoInteractions` | `void verifyNoInteractions()` | Throws `'No Interactions expected on this InOrder Mock instance!'` |

These two "no interactions" assertions exist **only** on `fflib_InOrder`. `fflib_ApexMocks` has no
`verifyNoMoreInteractions` and no `verifyZeroInteractions`.

`times(n)` under InOrder copies Mockito: it consumes `n` matching invocations, skipping
non-matching ones in between, and fails if the very next invocation also matches. For `a(); a();
b(); a();`, `inOrder.verify(mock, 2).a()` and `inOrder.verify(mock, 3).a()` pass but
`inOrder.verify(mock, 1).a()` fails. `calls(n)` is the non-greedy variant and does not fail when
the method is called more times than expected.

## fflib_MethodReturnValue

`@IsTest public with sharing class fflib_MethodReturnValue`

| Method | Signature | Behaviour |
| --- | --- | --- |
| `thenReturn` | `fflib_MethodReturnValue thenReturn(Object value)` | Appends `value` to the standard answer |
| `thenThrow` | `fflib_MethodReturnValue thenThrow(Exception e)` | Appends an exception; thrown when returned |
| `thenReturnMulti` | `fflib_MethodReturnValue thenReturnMulti(List<Object> values)` | Consecutive returns |
| `thenThrowMulti` | `fflib_MethodReturnValue thenThrowMulti(List<Exception> es)` | Consecutive throws |
| `thenAnswer` | `void thenAnswer(fflib_Answer answer)` | Replaces the answer entirely |
| `Answer` | `public fflib_Answer Answer { get; set; }` | The active answer |

`StandardAnswer` semantics: values are consumed in order; once the list is exhausted the **last**
value is returned for every subsequent call. `setValues(null)` or an empty list throws
`ApexMocksException('The stubbing is not correct, no return values have been set.')`.

Chaining works because `thenReturn`/`thenThrow` return `this`:

```apex
mocks.startStubbing();
mocks.when(svcMock.next()).thenReturn('a').thenReturn('b').thenReturn('c');
mocks.stopStubbing();
// calls: 'a', 'b', 'c', 'c', 'c', ...
```

## fflib_Answer and fflib_InvocationOnMock

```apex
public interface fflib_Answer {
    Object answer(fflib_InvocationOnMock invocation);
}
```

| `fflib_InvocationOnMock` member | Signature | Notes |
| --- | --- | --- |
| `getArgument` | `Object getArgument(Integer index)` | Throws `'Invalid index, must be greater or equal to zero and less of <n>.'` |
| `getArguments` | `List<Object> getArguments()` | Raw argument list |
| `getMethodArgValues` | `fflib_MethodArgValues getMethodArgValues()` | Wrapper with `equals`/`hashCode` |
| `getMethod` | `fflib_QualifiedMethod getMethod()` | `toString()` -> `Type.method(ArgTypes)` |
| `getMock` | `Object getMock()` | The stub instance |

```apex
private class EchoUpperAnswer implements fflib_Answer {
    public Object answer(fflib_InvocationOnMock invocation) {
        return ((String) invocation.getArgument(0)).toUpperCase();
    }
}

mocks.startStubbing();
mocks.when(fooMock.shout(fflib_Match.anyString())).thenAnswer(new EchoUpperAnswer());
mocks.stopStubbing();
```

For **void** methods use `mocks.doAnswer(answer, mock)` followed by the void call, inside
stubbing:

```apex
mocks.startStubbing();
mocks.doAnswer(new RecordSideEffectAnswer(), uowMock);
uowMock.registerDirty(new Account());
mocks.stopStubbing();
```

## fflib_ArgumentCaptor

| Method | Signature | Notes |
| --- | --- | --- |
| `forClass` | `static fflib_ArgumentCaptor forClass(Type ignoredCaptureType)` | The type is ignored at runtime; still pass the right one |
| `capture` | `Object capture()` | Registers an `AnyObject` matcher; **use only inside `verify`** |
| `getValue` | `Object getValue()` | Last captured value, or `null` |
| `getAllValues` | `List<Object> getAllValues()` | All captured values across all matching invocations |

Capture happens in `fflib_MethodVerifier.capture(...)`, which is invoked only while verifying and
only for invocations that matched every matcher. A captor used inside `startStubbing()` captures
nothing.

## fflib_ApexMocksUtils

| Method | Signature |
| --- | --- |
| `makeRelationship` | `static Object makeRelationship(Type parentsType, List<SObject> parents, SObjectField relationshipField, List<List<SObject>> children)` |
| `makeRelationship` | `static Object makeRelationship(String parentTypeName, String childTypeName, List<SObject> parents, String relationshipFieldName, List<List<SObject>> children)` |
| `setReadOnlyFields` | `static Object setReadOnlyFields(SObject objInstance, Type deserializeType, Map<SObjectField, Object> properties)` |
| `setReadOnlyFields` | `static Object setReadOnlyFields(SObject objInstance, Type deserializeType, Map<String, Object> properties)` |

Errors: `ApexMocksException('SObject type not found: <name>')` and
`ApexMocksException('SObject field not found: <name>')` from the string-based overloads.
Null property values are written as an explicit JSON null (`writeNullField`) because
`JSONGenerator.writeObjectField` rejects null.

## fflib_IDGenerator

```apex
public static Id generate(Schema.SObjectType sObjectType)
```

Uses a static counter and the type's key prefix, padding to a 15-character body:
`001` + `00000000000` + `1`. Ids are unique within a transaction, sequential, and describe-cached
per `SObjectType`. They are **not** valid in any DML or SOQL against the org.

## fflib_ApexMocksConfig

```apex
@IsTest public class fflib_ApexMocksConfig {
    public static Boolean HasIndependentMocks { get; set; }   // static initialiser sets false
}
```

`false` (default): stubbed behaviour and invocation counts are shared across all mock instances of
the same type. `true`: each mock instance keeps its own. The switch is read by
`fflib_QualifiedMethod.equals` and `hashCode`, which include the mock instance in identity only
when it is `true`.

## fflib_System

```apex
public static void assertEquals(Object ignoredRetval, Object value)
public static void assertEquals(Object ignoredRetval, Object value, String customAssertMessage)
```

Asserts a **value** against a matcher outside a mock, e.g.
`fflib_System.assertEquals(fflib_Match.stringContains('OPEN'), actual);`. Exactly one matcher must
have been registered; otherwise it throws
`'fflib_System.assertEquals expects you to register exactly 1 fflib_IMatcher (typically through the helpers in fflib_Match).'`.
Failure message: `Expected : <matcher>, Actual: <value>[ -- <custom message>]`.

## fflib_MethodCountRecorder

Each `fflib_ApexMocks` owns an instance recorder (`getInstanceOrderedMethodCalls()`,
`getInstanceMethodArgumentsByTypeName()`). `recordMethod` also mirrors into a private static
`STATIC_RECORDER` so the **deprecated** static getters `getOrderedMethodCalls()` and
`getMethodArgumentsByTypeName()` keep their historical globally shared behaviour. The instance
recorder is what makes counts survive asynchronous flows such as platform-event triggers. Do not
write new code against the static getters.

## Version notes and drift

| Fact | Status on `master` d81e9e1 |
| --- | --- |
| `fflib_SObjectMocks` (generated selector/domain/UoW mock base classes) | **Not present** in `fflib-apex-common` `master` (`dab5977`). Codebases referencing it are on an older fork |
| `mocks.mock(Type)` | Stub API based; the older generator-only workflow is legacy |
| `fflib_ApexMocksConfig.HasIndependentMocks` | Defaults to `false` for backwards compatibility |
| `verifyNoMoreInteractions` / `verifyNoInteractions` | `fflib_InOrder` only |
| `@NamespaceAccessible` annotations | Present throughout, so the framework is usable from a second-generation package namespace |
| `fflib_MethodCountRecorder` static getters | Deprecated in favour of instance getters |
| Named exception types other than `ApexMocks.ApexMocksException` | None exist |

See also: `sf-fflib-foundations` for `fflib_Application`, `sf-fflib-operations` for keeping the
framework version pinned in the package, and `matchers-and-captors.md` for the matcher half of
this API.
