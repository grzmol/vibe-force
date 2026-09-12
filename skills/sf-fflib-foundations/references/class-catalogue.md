# fflib class catalogue

Every public type in both libraries, generated from the class listings and sources of
`apex-enterprise-patterns/fflib-apex-common` @ `master` commit `dab5977`
(`sfdx-source/apex-common/main/classes`, 22 files) and `fflib-apex-mocks` @ `master`
commit `d81e9e1` (`sfdx-source/apex-mocks/main/classes`, 23 files). Signatures were read from those
files this session; anything not read is marked `[unverified]`.

## 1. fflib-apex-common - layer map

| Layer | Types |
| --- | --- |
| Factory / wiring | `fflib_Application`, `fflib_IUnitOfWorkFactory`, `fflib_IServiceFactory`, `fflib_ISelectorFactory`, `fflib_IDomainFactory` |
| Selector | `fflib_SObjectSelector`, `fflib_ISObjectSelector`, `fflib_QueryFactory` |
| Domain | `fflib_SObjectDomain`, `fflib_ISObjectDomain`, `fflib_IDomain`, `fflib_IDomainConstructor`, `fflib_SObjects`, `fflib_ISObjects`, `fflib_Objects`, `fflib_IObjects` |
| Unit of Work | `fflib_SObjectUnitOfWork`, `fflib_ISObjectUnitOfWork` |
| Utility | `fflib_SObjectDescribe`, `fflib_SecurityUtils`, `fflib_StringBuilder` |

## 2. fflib-apex-common - class by class

| Class | Kind | Layer | Purpose | Key members |
| --- | --- | --- | --- | --- |
| `fflib_Application` | `public virtual class` | factory | container for the four inner factories | inner `UnitOfWorkFactory`, `ServiceFactory`, `SelectorFactory`, `DomainFactory`; `ApplicationException`, `DeveloperException` |
| `fflib_IUnitOfWorkFactory` | interface | factory | UoW factory contract | `newInstance()`, `newInstance(IDML)`, `newInstance(List<SObjectType>)`, `newInstance(List<SObjectType>, IDML)` |
| `fflib_IServiceFactory` | interface | factory | service factory contract | `Object newInstance(Type serviceInterfaceType)` |
| `fflib_ISelectorFactory` | interface | factory | selector factory contract | `newInstance(SObjectType)`, `selectById(Set<Id>)`, `selectByRelationship(List<SObject>, SObjectField)` |
| `fflib_IDomainFactory` | interface | factory | domain factory contract | `newInstance(Set<Id>)`, `newInstance(List<SObject>)`, `newInstance(List<Object>, Object)`, `newInstance(List<SObject>, SObjectType)` |
| `fflib_SObjectSelector` | `public abstract with sharing class` | selector | base class for all query classes | abstract `getSObjectType()`, `getSObjectFieldList()`; `selectSObjectsById`, `queryLocatorById`, `newQueryFactory`, `addQueryFactorySubselect`, `configureQueryFactoryFields`, `setDataAccess`, enum `DataAccess{LEGACY, USER_MODE, SYSTEM_MODE}` |
| `fflib_ISObjectSelector` | interface | selector | minimum selector contract | `sObjectType()`, `selectSObjectsById(Set<Id>)` |
| `fflib_QueryFactory` | `public class` (no sharing declaration - inherits caller) | selector | fluent SOQL builder | `selectField(s)`, `selectFieldSet`, `setCondition`, `setLimit`, `setOffset`, `addOrdering`/`setOrdering`, `subselectQuery`, `setEnforceFLS`, `setSortSelectFields`, `setAllRows`, `toSOQL`, `deepClone`; enums `SortOrder`, `FLSEnforcement{NONE, LEGACY, USER_MODE, SYSTEM_MODE}`; inner `Ordering` |
| `fflib_SObjectDomain` | `public virtual class` | domain / trigger handler | legacy combined domain + trigger handler; lifecycle hooks and trigger dispatch | virtual `onApplyDefaults`, `onValidate()`, `onValidate(Map<Id,SObject>)`, `onBeforeInsert`, `onBeforeUpdate(Map<Id,SObject>)`, `onBeforeDelete`, `onAfterInsert`, `onAfterUpdate(Map<Id,SObject>)`, `onAfterDelete`, `onAfterUndelete`; `onInsert(List<SObject>)`, `onUpdate(List<SObject>, Map<Id,SObject>)`, `onDelete(Map<Id,SObject>)`, `onUndelete(List<SObject>)`; `static triggerHandler(Type domainClass)`; inner `IConstructable`, `IConstructable2`, `Configuration`, `DomainException`, `TestFactory` |
| `fflib_ISObjectDomain` | interface (`extends fflib_IDomain`) | domain | SObject domain contract | `sObjectType()`, `getRecords()` |
| `fflib_IDomain` | interface | domain | generic domain contract (post-April-2021 structure) | `Object getType()`, `List<Object> getObjects()` |
| `fflib_IDomainConstructor` | interface | domain | constructor contract for the new domain structure | `fflib_IDomain construct(List<Object> objects)` |
| `fflib_SObjects` | `public virtual class extends fflib_Objects implements fflib_ISObjects` | domain | SObject-typed domain base without trigger coupling | `SObjectDescribe` property; `getRecords()`, `getRecordIds()`, `getSObjectType()`, `getType()`, `addError(String)`, `addError(SObjectField, String)`, `clearField(s)`, protected `getIdFieldValues`, `getStringFieldValues`, `getFieldValues`, `getRecordsByFieldValue(s)`, `getRecordsWithBlankFieldValues`, `getRecordsWithAllBlankFieldValues` |
| `fflib_ISObjects` | interface (`extends fflib_IObjects`) | domain | SObject domain contract | `getRecords()`, `getRecordIds()`, `getSObjectType()` |
| `fflib_Objects` | `public virtual class implements fflib_IObjects` | domain | domain base for non-SObject collections | `getType()`, `getObjects()`, `contains`, `containsAll`, `containsNot`, `isEmpty`, `isNotEmpty`, `size`, protected `setObjects` |
| `fflib_IObjects` | interface (`extends fflib_IDomain`) | domain | non-SObject domain contract | `contains`, `containsAll`, `containsNot`, `isEmpty`, `isNotEmpty`, `size` |
| `fflib_SObjectUnitOfWork` | `public virtual class` | UoW | ordered DML + email + platform event dispatch | `registerNew`, `registerDirty`, `registerUpsert`, `registerDeleted`, `registerPermanentlyDeleted`, `registerEmptyRecycleBin`, `registerRelationship`, `registerPublishBeforeTransaction`, `registerPublishAfterSuccessTransaction`, `registerPublishAfterFailureTransaction`, `registerWork`, `registerEmail`, `commitWork`; inner `IDoWork`, `IDML`, `IDMLUpsertable`, `SimpleDML`, `UserModeDML`, `IEmailWork`, `UnitOfWorkException` |
| `fflib_ISObjectUnitOfWork` | interface | UoW | UoW contract (the type you mock) | all `register*` methods plus `commitWork()` |
| `fflib_SObjectDescribe` | `public class` | utility | transaction-cached describe access with namespace handling | static `getDescribe(String/SObjectType/DescribeSObjectResult/SObject)`, `getRawGlobalDescribe`, `getGlobalDescribe`, `flushCache`; instance `getField(String[, Boolean implyNamespace])`, `getNameField`, `getDescribe`, `getFieldsMap`, `getFields`, `getFieldSetsMap`; inner `FieldsMap`, `GlobalDescribeMap`, `NamespacedAttributeMap`, `InvalidDescribeException` |
| `fflib_SecurityUtils` | `public class` | utility | pre-user-mode CRUD/FLS assertions | `checkInsert`, `checkRead`, `checkUpdate` (String and SObjectField overloads), `checkFieldIsInsertable/Readable/Updateable`, `checkObjectIsInsertable/Readable/Updateable/Deletable`, `BYPASS_INTERNAL_FLS_AND_CRUD`; inner `SecurityException`, `CrudException`, `FlsException` |
| `fflib_StringBuilder` | `public virtual class` | utility | comma-delimited field list assembly (pre-`QueryFactory`) | `add(String)`, `add(List<String>)`, `toString`, `getStringValue`; inner `CommaDelimitedListBuilder`, `FieldListBuilder`, `MultiCurrencyFieldListBuilder` |

### 2.1 Notes on deprecated surface

| Member | Status | Replacement |
| --- | --- | --- |
| `fflib_SObjectSelector(Boolean, Boolean enforceCRUD, Boolean enforceFLS[, Boolean sortSelectFields])` | deprecated in source Javadoc | `fflib_SObjectSelector(Boolean includeFieldSetFields, DataAccess dataAccess)` |
| `fflib_SObjectSelector.enforceFLS()` | deprecated | `setDataAccess(DataAccess.USER_MODE)` |
| `fflib_SObjectSelector.assertIsAccessible()` | deprecated | automatic inside `newQueryFactory()` unless disabled |
| `fflib_SObjectSelector.getFieldListBuilder()`, `getFieldListString()`, `getRelatedFieldListString(String)` | deprecated | `newQueryFactory()` |
| `fflib_SObjectSelector.setFieldListBuilder(...)` | **no-op** - the method body is empty with a TODO | `newQueryFactory()` + `selectField(s)` |
| `fflib_QueryFactory.setEnforceFLS(Boolean)` | deprecated | `setEnforceFLS(FLSEnforcement)` |
| `fflib_QueryFactory.subselectQuery(SObjectType[, Boolean])` | deprecated, logs a `LoggingLevel.WARN` debug at runtime | `subselectQuery(String relationshipName[, Boolean])` or `subselectQuery(Schema.ChildRelationship[, Boolean])` |
| `fflib_SObjectUnitOfWork.SimpleDML` | deprecated per `docs/changelog.md` (Dec 2022) | `fflib_SObjectUnitOfWork.UserModeDML` |
| `fflib_SObjectDomain` as a combined domain + trigger handler | superseded April 2021 | `fflib_SObjects` / `fflib_IDomain` for domain, `fflib_ISObjectDomain` implementation for trigger handling |

`fflib_StringBuilder` remains only because `getFieldListBuilder()` returns one. New code should not
reference it.

## 3. fflib-apex-mocks - class by class

| Class | Kind | Role | Key members |
| --- | --- | --- | --- |
| `fflib_ApexMocks` | `public with sharing class ... implements System.StubProvider` | the mock control object | `mock(Type)`, `when(Object)`, `startStubbing()`, `stopStubbing()`, `verify(Object[, fflib_VerificationMode\|Integer])`, `doThrowWhen(Exception\|List<Exception>, Object)`, `doAnswer(fflib_Answer, Object)`, `inOrder(List<Object>)`, `times/calls/atLeast/atMost/atLeastOnce/between/never/description`, `NEVER = 0`, `mockVoidMethod`, `mockNonVoidMethod`, `extractTypeName` |
| `fflib_ApexMocksConfig` | `public class` | global mock configuration | `static Boolean HasIndependentMocks {get; set;}` |
| `fflib_ApexMocksUtils` | `public class` | build otherwise unsettable record shapes | `setReadOnlyFields(SObject, Type, Map<SObjectField, Object>)`, `setReadOnlyFields(SObject, Type, Map<String, Object>)`, `makeRelationship(Type parentsType, List<SObject> parents, SObjectField relationshipField, List<List<SObject>> children)` |
| `fflib_IDGenerator` | `public class` | fake but valid record Ids without DML | `static Id generate(Schema.SObjectType)` |
| `fflib_Match` | `public class` | argument matcher entry point | `matches`, `eq`, `eqBoolean/eqDate/eqDatetime/eqDecimal/eqDouble/eqId/eqInteger/eqList/eqLong/eqSObjectField/eqSObjectType/eqString`, `allOf`, `anyOf`, `noneOf`, `isNot`, `getAndClearMatchers`, `matchesAllArgs` |
| `fflib_MatcherDefinitions` | `public class` | the concrete matcher implementations behind `fflib_Match` | inner matcher classes (`Eq`, `AnyOf`, `AllOf`, ... ) `[unverified]` in detail - see skill `sf-fflib-testing` |
| `fflib_IMatcher` | interface | matcher contract | single `matches` contract |
| `fflib_ArgumentCaptor` | `public class` | capture arguments passed to a mock | `static forClass(Type)`, `capture()`, `getValue()`, `getAllValues()`, `matches(Object)`, `storeArgument(Object)` |
| `fflib_Answer` | interface | callback-style stubbing | implement `answer(fflib_InvocationOnMock)` in the test class |
| `fflib_InvocationOnMock` | `public with sharing class` | the invocation handed to an `fflib_Answer` | `getArgument(Integer)`, `getArguments()`, `getMethodArgValues()`, `getMethod()`, `getMock()` |
| `fflib_InOrder` | `public with sharing class` (`extends fflib_MethodVerifier`) | ordered verification across mocks | `verify(Object[, fflib_VerificationMode\|Integer])`, `verifyNoMoreInteractions()`, `verifyNoInteractions()` |
| `fflib_AnyOrder` | `public class` (`extends fflib_MethodVerifier`) | default unordered verification | constructors only; used internally by `fflib_ApexMocks.verify` |
| `fflib_MethodVerifier` | `public abstract class` | shared verification algorithm | `verifyMethodCall(fflib_InvocationOnMock, fflib_VerificationMode)` |
| `fflib_VerificationMode` | `public with sharing class` | how many times / which message | `times`, `calls`, `atLeast`, `atMost`, `atLeastOnce`, `between`, `never`, `description`; `VerifyMin`, `VerifyMax`, `CustomAssertMessage`; enum `ModeName` |
| `fflib_MethodReturnValue` | `public with sharing class` | the object `when()` returns | `thenReturn(Object)`, `thenThrow(Exception)`, `thenAnswer(fflib_Answer)`, `thenReturnMulti(List<Object>)`, `thenThrowMulti(List<Exception>)`; inner `StandardAnswer` |
| `fflib_MethodReturnValueRecorder` | `public with sharing class` | stubbing state machine | `Stubbing`, `DoThrowWhenExceptions`, `MethodReturnValue` |
| `fflib_MethodCountRecorder` | `public with sharing class` | invocation log used by verification | `getInstanceOrderedMethodCalls()`, `getInstanceMethodArgumentsByTypeName()`, static `getOrderedMethodCalls()`, `getMethodArgumentsByTypeName()`, `recordMethod(fflib_InvocationOnMock)` |
| `fflib_QualifiedMethod` | `public with sharing class` | identity of a stubbed method | `typeName`, `methodName`, `methodArgTypes`, `mockInstance`, `equals`, `hashCode` |
| `fflib_QualifiedMethodAndArgValues` | `public with sharing class` | method + the args it was called with | `getQualifiedMethod()`, `getMethodArgValues()`, `getMockInstance()`, `toString()` |
| `fflib_MethodArgValues` | `public with sharing class` | argument tuple with value equality | `argValues`, `equals`, `hashCode` |
| `fflib_MatchersReturnValue` | `public with sharing class` | pairs a matcher list with a return value | `matchers`, `returnValue` |
| `fflib_System` | `public class` | assertion helpers used by the framework | `static assertEquals(...)` overloads |
| `fflib_Inheritor` | `public class` | test fixture proving multi-interface stubbing (`IA`, `IB`, `IC`) | `doA()`, `doB()`, `doC()` - not for product code |

## 4. Which types you reference from your own code

| You write | You reference |
| --- | --- |
| `Application.cls` | `fflib_Application.*Factory`, `fflib_ISObjectUnitOfWork`, `fflib_SObjectUnitOfWork.UserModeDML` |
| a selector | `fflib_SObjectSelector`, `fflib_ISObjectSelector`, `fflib_QueryFactory`, `fflib_SObjectSelector.DataAccess` |
| a domain | `fflib_SObjects` or `fflib_SObjectDomain`, `fflib_IDomain`/`fflib_ISObjectDomain`, `fflib_IDomainConstructor` |
| a service | `fflib_ISObjectUnitOfWork` only |
| a unit test | `fflib_ApexMocks`, `fflib_IDGenerator`, `fflib_Match`, `fflib_ApexMocksUtils`, `fflib_ArgumentCaptor`, `fflib_VerificationMode` |
| nothing, ever | `fflib_StringBuilder`, `fflib_Inheritor`, `fflib_MethodCountRecorder`, `fflib_QualifiedMethod*`, `fflib_MethodArgValues`, `fflib_MatchersReturnValue`, `fflib_MethodReturnValueRecorder` (framework internals) |

## 5. `@NamespaceAccessible` and packaging

Nearly every public member in both libraries carries `@NamespaceAccessible` (visible in the source
headers of `fflib_Application`, `fflib_SObjectSelector`, `fflib_QueryFactory`, `fflib_ApexMocks`).
That annotation only matters when the library is compiled **inside a namespaced second-generation
package** and consumed from another package in the same namespace group. In an unpackaged org or a
vendored copy it is inert. Consequences for packaging decisions are in skill `sf-packaging-release`.

## 6. PMD suppressions the library carries

fflib suppresses its own analyzer noise at class level, which is why the vendored directory deploys
clean and why you should not copy its style:

| File | Suppressed rules (from the `@SuppressWarnings` header) |
| --- | --- |
| `fflib_Application.cls` | `PMD.EmptyStatementBlock`, `PMD.CognitiveComplexity`, `PMD.ClassNamingConventions`, `PMD.FieldNamingConventions`, `PMD.ApexDoc` |
| `fflib_SObjectSelector.cls` | the above plus `PMD.MethodNamingConventions`, `PMD.PropertyNamingConventions`, `PMD.FieldDeclarationsShouldBeAtStart`, `PMD.LocalVariableNamingConventions`, `PMD.AvoidBooleanMethodParameters`, `PMD.ExcessiveParameterList`, `PMD.CyclomaticComplexity`, `PMD.ExcessivePublicCount`, `PMD.StdCyclomaticComplexity`, `PMD.NcssMethodCount` |
| `fflib_IDomain.cls`, `fflib_IObjects.cls`, `fflib_ISObjects.cls`, `fflib_ISObjectDomain.cls`, `fflib_IDomainConstructor.cls` | `PMD.ApexDoc`, `PMD.ClassNamingConventions` |
| `fflib_QueryFactory.cls` `subselectQuery` overloads | `PMD.AvoidDebugStatements` (they emit deprecation warnings) |

Your own selectors and services get no such blanket suppression: keep methods small, document public
APIs, and scope `ApexCRUDViolation`/`ApexSOQLInjection` deliberately rather than suppressing them
file-wide. Skill `sf-code-analyzer-quality`.

## 7. Exception inventory

Every exception type the two libraries can throw at you, with the condition that produces it.

| Exception | Declared in | Thrown when |
| --- | --- | --- |
| `fflib_Application.DeveloperException` | `fflib_Application` | no implementation registered for a service interface; no selector class for an SObjectType; no domain constructor class for an SObjectType; `selectById` called with a null/empty Id set or with mixed SObjectTypes; `newInstance(List<SObject>)` unable to determine the SObjectType; `newInstance(records, null)` |
| `fflib_Application.ApplicationException` | `fflib_Application` | reserved for application code to extend; fflib itself does not throw it |
| `fflib_QueryFactory.InvalidFieldException` | `fflib_QueryFactory` | unknown field name or null `SObjectField` token, in `NONE`/`LEGACY` mode only |
| `fflib_QueryFactory.InvalidFieldSetException` | `fflib_QueryFactory` | field set belongs to another SObject, or a cross-object member with `allowCrossObject = false` |
| `fflib_QueryFactory.NonReferenceFieldException` | `fflib_QueryFactory` | a mid-path segment of a dotted field path is not a lookup or master-detail field |
| `fflib_QueryFactory.InvalidSubqueryRelationshipException` | `fflib_QueryFactory` | unknown child relationship name, or a child relationship with a null relationship name |
| `fflib_SecurityUtils.SecurityException` | `fflib_SecurityUtils` | abstract-style base (`virtual`); never thrown directly |
| `fflib_SecurityUtils.CrudException` | `fflib_SecurityUtils` | object-level read/create/update/delete denied. Message text comes from Custom Labels |
| `fflib_SecurityUtils.FlsException` | `fflib_SecurityUtils` | field-level read/insert/update denied. Message text comes from Custom Labels |
| `fflib_SObjectDomain.DomainException` | `fflib_SObjectDomain` | selector CRUD failure marshalled for backwards compatibility (`configureQueryFactory`), plus domain-layer validation failures |
| `fflib_SObjectUnitOfWork.UnitOfWorkException` | `fflib_SObjectUnitOfWork` | Unit of Work registration/commit misuse - detail in skill `sf-fflib-domain-service-uow` |
| `fflib_SObjectDescribe.DescribeException` | `fflib_SObjectDescribe` | abstract base for describe failures |
| `fflib_SObjectDescribe.InvalidDescribeException` | `fflib_SObjectDescribe` | describe requested for an unknown SObject or field |

Two consequences worth designing around:

1. A selector CRUD failure surfaces as `fflib_SObjectDomain.DomainException` - a domain-layer type
   thrown from the query layer. That is deliberate backwards compatibility, not a bug.
2. Under `DataAccess.USER_MODE` none of the fflib exceptions above fire for access problems; the
   platform throws `System.QueryException` instead. Callers migrating to user mode must change the
   type they catch. See skill `sf-fflib-selector-layer`, `references/selector-security.md`.

## 8. Inner type inventory

Inner types are referenced by outer-qualified name (`fflib_SObjectUnitOfWork.UserModeDML`), and
several of them are the actual extension points of the library.

| Outer class | Inner types | Notes |
| --- | --- | --- |
| `fflib_Application` | `UnitOfWorkFactory`, `ServiceFactory`, `SelectorFactory`, `DomainFactory`, `ApplicationException`, `DeveloperException` | all four factories are `virtual`; subclass one to change instantiation |
| `fflib_SObjectUnitOfWork` | `IDoWork`, `IDML`, `IDMLUpsertable`, `SimpleDML`, `UserModeDML`, `IEmailWork`, `UnitOfWorkException` | `UserModeDML extends SimpleDML`; pass an `IDML` to the UoW constructor or factory `newInstance` |
| `fflib_SObjectDomain` | `IConstructable`, `IConstructable2`, `Configuration`, `DomainException`, `TestFactory` | `Configuration` toggles trigger-state behaviour; `IConstructable2` also receives the `SObjectType` |
| `fflib_QueryFactory` | `Ordering`, `InvalidFieldException`, `InvalidFieldSetException`, `NonReferenceFieldException`, `InvalidSubqueryRelationshipException` | `Ordering` is the only inner type you construct |
| `fflib_SObjectDescribe` | `NamespacedAttributeMap`, `FieldsMap`, `GlobalDescribeMap`, `DescribeException`, `InvalidDescribeException` | `FieldsMap`/`GlobalDescribeMap` extend `NamespacedAttributeMap` and support `implyNamespace` lookups |
| `fflib_SecurityUtils` | `SecurityException`, `CrudException`, `FlsException` | `CrudException`/`FlsException` have private constructors - only fflib raises them |
| `fflib_StringBuilder` | `CommaDelimitedListBuilder`, `FieldListBuilder`, `MultiCurrencyFieldListBuilder` | legacy; reachable only through the deprecated `getFieldListBuilder()` |
| `fflib_MethodReturnValue` | `StandardAnswer` | the default `fflib_Answer` behind `thenReturn` |
| `fflib_ApexMocksUtils` | `InjectChildrenEventHandler`, `InjectFieldsEventHandler` | JSON-rewriting helpers behind `makeRelationship`/`setReadOnlyFields` |
| `fflib_Inheritor` | `IA`, `IB`, `IC` | library test fixture only |
| `fflib_VerificationMode` | `ModeName` enum | `times`/`atLeast`/`atMost`/`between`/`never` map onto it |

Extension points you are expected to use: an `fflib_Application.*Factory` subclass, an
`fflib_SObjectUnitOfWork.IDML` implementation, an `fflib_SObjectDomain.IConstructable`/`IConstructable2`
or `fflib_IDomainConstructor` implementation, and an `fflib_Answer` implementation in tests.
Everything else in the table is internal.

## Related

- Skill `sf-fflib-selector-layer` - `fflib_SObjectSelector` and `fflib_QueryFactory` in depth
- Skill `sf-fflib-domain-service-uow` - `fflib_SObjects`, `fflib_SObjectDomain`, `fflib_SObjectUnitOfWork`
- Skill `sf-fflib-testing` - every `fflib-apex-mocks` type in use
- Skill `sf-fflib-operations` - which of these classes appear in triggers, batch, and packaging
- Skill `sf-security-model` - `fflib_SecurityUtils` versus native user mode
