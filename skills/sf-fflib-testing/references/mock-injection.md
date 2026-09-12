# Mock injection

How a mock reaches the class under test. Source: `fflib_Application.cls` at
`apex-enterprise-patterns/fflib-apex-common` `master` commit `dab5977`, plus
`Application.cls` from `fflib-apex-common-samplecode` `master`.

If a mock never reaches production code, the test still passes (the class under test just uses the
real collaborator) and the verification fails with `ACTUAL COUNT: 0` and empty `ACTUAL ARGS`.
Injection is therefore the first thing to check on any failing mock test.

## The four factories

The samplecode `Application` class is the canonical wiring:

```apex
public class Application {
    public static final fflib_Application.UnitOfWorkFactory UnitOfWork =
        new UserModeUnitOfWorkFactory(new List<SObjectType>{
            Account.SObjectType, Opportunity.SObjectType, OpportunityLineItem.SObjectType });

    public static final fflib_Application.ServiceFactory Service =
        new fflib_Application.ServiceFactory(new Map<Type, Type>{
            IAccountsService.class => AccountsServiceImpl.class,
            IOpportunitiesService.class => OpportunitiesServiceImpl.class });

    public static final fflib_Application.SelectorFactory Selector =
        new fflib_Application.SelectorFactory(new Map<SObjectType, Type>{
            Account.SObjectType => AccountsSelector.class,
            Opportunity.SObjectType => OpportunitiesSelector.class });

    public static final fflib_Application.DomainFactory Domain =
        new fflib_Application.DomainFactory(Application.Selector, new Map<SObjectType, Type>{
            Account.SObjectType => Accounts.Constructor.class,
            Opportunity.SObjectType => Opportunities.Constructor.class });

    private class UserModeUnitOfWorkFactory extends fflib_Application.UnitOfWorkFactory {
        public UserModeUnitOfWorkFactory(List<SObjectType> objectTypes) { super(objectTypes); }
        public override fflib_ISObjectUnitOfWork newInstance() {
            if (m_mockUow != null) { return m_mockUow; }
            return new fflib_SObjectUnitOfWork(m_objectTypes, new fflib_SObjectUnitOfWork.UserModeDML());
        }
    }
}
```

Note the override: **any custom `newInstance()` override must keep the `m_mockUow` check first**,
otherwise `setMock` silently stops working and every mocked test degrades to a real-DML test.

## setMock catalogue

Every `setMock` is declared `@TestVisible @NamespaceAccessible protected virtual`, which is why a
test class can call `Application.UnitOfWork.setMock(...)` even though the member is `protected`.

| Factory | Signature | Resolves |
| --- | --- | --- |
| `UnitOfWorkFactory` | `void setMock(fflib_ISObjectUnitOfWork mockUow)` | All four `newInstance()` overloads return the mock |
| `ServiceFactory` | `void setMock(Type serviceInterfaceType, Object serviceImpl)` | `newInstance(Type)` for that interface |
| `SelectorFactory` | `void setMock(fflib_ISObjectSelector selectorInstance)` | Calls `selectorInstance.sObjectType()` then delegates |
| `SelectorFactory` | `void setMock(SObjectType sType, fflib_ISObjectSelector selectorInstance)` | `newInstance(SObjectType)` for that type |
| `DomainFactory` | `void setMock(fflib_ISObjectDomain mockDomain)` | Calls `mockDomain.sObjectType()` then delegates |
| `DomainFactory` | `void setMock(SObjectType sType, fflib_ISObjectDomain mockDomain)` | `newInstance(...)` for that type |
| `DomainFactory` | `void setMock(fflib_IDomain mockDomain)` | Keys by `mockDomain.getType()` |

The single-argument selector and domain overloads emit
`*** fflib - Please note your mocked class should have sObjectType() stubbed, or use setMock( SObjectType, SelectorMock )`
at `INFO`. That debug line is the framework warning you that it is about to call
`sObjectType()` / `getType()` on the mock. Either stub it:

```apex
mocks.startStubbing();
mocks.when(selectorMock.sObjectType()).thenReturn(Account.SObjectType);
mocks.stopStubbing();
Application.Selector.setMock(selectorMock);
```

or skip the problem entirely:

```apex
Application.Selector.setMock(Account.SObjectType, selectorMock);
```

The two-argument form is preferable: it cannot fail with a `NullPointerException` from an unstubbed
`sObjectType()` inside `setMock`, and it keeps the stubbing block focused on behaviour.

`ServiceFactory.newInstance` throws
`fflib_Application.DeveloperException('No implementation registered for service interface ' + name)`
when neither a mock nor a real implementation is registered.

## Ordering: stub before injecting

```apex
fflib_ApexMocks mocks = new fflib_ApexMocks();
IAccountsSelector selectorMock = (IAccountsSelector) mocks.mock(IAccountsSelector.class);

mocks.startStubbing();                                   // 1. record stubs
mocks.when(selectorMock.sObjectType()).thenReturn(Account.SObjectType);
mocks.when(selectorMock.selectById(ids)).thenReturn(accounts);
mocks.stopStubbing();                                    // 2. close the recording

Application.Selector.setMock(selectorMock);              // 3. inject

System.Test.startTest();                                 // 4. exercise
new AccountsServiceImpl().recalculate(ids);
System.Test.stopTest();

((IAccountsSelector) mocks.verify(selectorMock, 1)).selectById(ids);   // 5. verify
```

Injecting before stubbing works for the UoW and Service factories, but the single-argument selector
and domain `setMock` overloads call the mock, and an un-stubbed call made while `Stubbing` is false
is recorded as a real invocation - corrupting later verify counts. Keep the order above always.

No teardown is needed: the `Application` statics are per-transaction, and each test method runs in
its own transaction.

## Interface design that stays mockable

The Stub API cannot stub static methods, private methods, properties, triggers, inner classes,
system types, `Batchable` implementers, or classes whose only constructor is private. That drives
the shape of every fflib layer.

| Layer | Mockable shape | Unmockable shape |
| --- | --- | --- |
| Service | `IOpportunitiesService` interface + `OpportunitiesServiceImpl` class + static facade `OpportunitiesService` that delegates to `Application.Service.newInstance(IOpportunitiesService.class)` | Static methods holding the logic |
| Selector | `IAccountsSelector extends fflib_ISObjectSelector`, implemented by `AccountsSelector` | `public static List<Account> byId(...)` |
| Domain | `IAccounts` interface returned by `Accounts.newInstance(...)` | Logic on the trigger handler only |
| Unit of Work | `fflib_ISObjectUnitOfWork` (already an interface) | `new fflib_SObjectUnitOfWork(...)` inline in the service |

Concrete consequences:

- **Never `new` a collaborator inside a service.** `Application.Selector.newInstance(...)`,
  `Application.Domain.newInstance(...)`, `Application.UnitOfWork.newInstance()` are the only
  acceptable constructions.
- **The static facade is a one-liner.** `OpportunitiesService.applyDiscounts(x)` must do nothing
  but `service().applyDiscounts(x)`. Logic on the facade is untestable in isolation because static
  methods cannot be stubbed.
- **Test the `Impl`, not the facade.** `new OpportunitiesServiceImpl().applyDiscounts(...)` gives
  precise coverage attribution. Add exactly one test that goes through the facade to prove the
  `Application.Service` registration exists.
- **Mock interfaces, not classes, wherever an interface exists.** `mocks.mock(Accounts.class)` does
  work (samplecode does it to obtain an `IAccounts`), but mocking `IAccounts.class` keeps the mock
  independent of the concrete class' constructor requirements.

## Injecting into a controller

A controller should hold no logic beyond translating exceptions, so its test mocks the service.

```apex
public with sharing class OpportunityDiscountController {
    @AuraEnabled
    public static void applyDiscount(Id opportunityId, Decimal percentage) {
        try {
            OpportunitiesService.applyDiscounts(new Map<Id, Decimal>{ opportunityId => percentage });
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }
}
```

```apex
@IsTest
static void applyDiscountDelegatesToService() {
    fflib_ApexMocks mocks = new fflib_ApexMocks();
    IOpportunitiesService serviceMock = (IOpportunitiesService) mocks.mock(IOpportunitiesService.class);
    Application.Service.setMock(IOpportunitiesService.class, serviceMock);

    Id oppId = fflib_IDGenerator.generate(Opportunity.SObjectType);

    System.Test.startTest();
    OpportunityDiscountController.applyDiscount(oppId, 10);
    System.Test.stopTest();

    ((IOpportunitiesService) mocks.verify(serviceMock, 1))
        .applyDiscounts(new Map<Id, Decimal>{ oppId => 10 });
}
```

For the error path, stub the service to throw and assert the wrapper:

```apex
@IsTest
static void applyDiscountWrapsServiceFailure() {
    fflib_ApexMocks mocks = new fflib_ApexMocks();
    IOpportunitiesService serviceMock = (IOpportunitiesService) mocks.mock(IOpportunitiesService.class);

    mocks.startStubbing();
    // applyDiscounts is void, so use doThrowWhen rather than when(...).thenThrow(...)
    mocks.doThrowWhen(new OpportunitiesService.ServiceException('Discount too large'), serviceMock);
    serviceMock.applyDiscounts(new Map<Id, Decimal>());
    mocks.stopStubbing();

    Application.Service.setMock(IOpportunitiesService.class, serviceMock);

    try {
        OpportunityDiscountController.applyDiscount(null, 90);
        Assert.fail('AuraHandledException expected');
    } catch (AuraHandledException e) {
        Assert.isNotNull(e, 'Controller should wrap service failures');
    }
}
```

`AuraHandledException.getMessage()` returns the generic `Script-thrown exception` string unless the
controller also calls `setMessage(...)`; assert on the fact that it was thrown, or set and assert
`e.getMessage()` only when the controller explicitly sets it. `[unverified]` whether
`setMessage(...)` is required in API 67.0 for `getMessage()` to return the custom text - do not
assert the message text unless you have run the test.

## Injecting a selector into a domain

Domains obtain related data through `Application.Selector`. Mock the selector, construct the domain
directly with in-memory records, and assert on the records.

```apex
@IsTest
static void applyDefaultsSetsOwnerFromAccountTeam() {
    fflib_ApexMocks mocks = new fflib_ApexMocks();
    IUsersSelector usersMock = (IUsersSelector) mocks.mock(IUsersSelector.class);

    Id ownerId = fflib_IDGenerator.generate(User.SObjectType);
    mocks.startStubbing();
    mocks.when(usersMock.sObjectType()).thenReturn(User.SObjectType);
    mocks.when(usersMock.selectDefaultOwner()).thenReturn(new User(Id = ownerId));
    mocks.stopStubbing();
    Application.Selector.setMock(User.SObjectType, usersMock);

    Opportunities domain = new Opportunities(new List<Opportunity>{
        new Opportunity(Name = 'A', StageName = 'Open', CloseDate = System.today()) });

    System.Test.startTest();
    domain.onApplyDefaults();
    System.Test.stopTest();

    Assert.areEqual(ownerId, ((Opportunity) domain.getRecords()[0]).OwnerId,
        'Default owner should come from the users selector');
}
```

Assert on the **record**, not on a UoW interaction: `onApplyDefaults` mutates `Trigger.new` in
place and registers nothing.

## Injecting the Unit of Work into a service

```apex
fflib_ISObjectUnitOfWork uowMock = (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);
Application.UnitOfWork.setMock(uowMock);
```

`fflib_ISObjectUnitOfWork` is already an interface, so no stubbing is required unless the service
reads something back - and it should not. Verify against the full method surface:

| Verified method | Proves |
| --- | --- |
| `registerNew(SObject)` / `registerNew(List<SObject>)` | Insert intent |
| `registerNew(SObject, SObjectField, SObject)` | Insert with a parent relationship resolved at commit |
| `registerDirty(SObject)` / `(List<SObject>)` / `(SObject, List<SObjectField>)` / `(List<SObject>, List<SObjectField>)` | Update intent, optionally field-scoped |
| `registerUpsert(...)` (4 overloads) | Upsert intent, optionally by external id |
| `registerDeleted(...)`, `registerPermanentlyDeleted(...)`, `registerEmptyRecycleBin(...)` | Delete intent |
| `registerRelationship(SObject, SObjectField, SObject)` and the email/external-id overloads | Deferred parent-child wiring |
| `registerPublishBeforeTransaction` / `...AfterSuccessTransaction` / `...AfterFailureTransaction` | Platform-event intent at each commit phase |
| `registerWork(fflib_SObjectUnitOfWork.IDoWork)` / `registerEmail(Messaging.Email)` | Custom work and email |
| `commitWork()` | The service actually committed |

Always verify `commitWork()`. A service that registers work but never commits is the single most
common fflib defect, and only that verification catches it.

## Independent mocks

`fflib_ApexMocksConfig.HasIndependentMocks` defaults to `false`: two mocks of the same type share
stubbed behaviour and invocation counts, because `fflib_QualifiedMethod` identity excludes the mock
instance. Set it to `true` when one test needs two distinguishable mocks of one type:

```apex
@IsTest
static void routesEachRegionToItsOwnGateway() {
    fflib_ApexMocksConfig.HasIndependentMocks = true;

    fflib_ApexMocks mocks = new fflib_ApexMocks();
    IPaymentGateway euGateway = (IPaymentGateway) mocks.mock(IPaymentGateway.class);
    IPaymentGateway usGateway = (IPaymentGateway) mocks.mock(IPaymentGateway.class);

    mocks.startStubbing();
    mocks.when(euGateway.currencyCode()).thenReturn('EUR');
    mocks.when(usGateway.currencyCode()).thenReturn('USD');
    mocks.stopStubbing();

    System.Test.startTest();
    new PaymentRouter(euGateway, usGateway).route(new List<Payment__c>{
        new Payment__c(Region__c = 'EU'), new Payment__c(Region__c = 'US') });
    System.Test.stopTest();

    ((IPaymentGateway) mocks.verify(euGateway, 1)).charge(fflib_Match.anySObject());
    ((IPaymentGateway) mocks.verify(usGateway, 1)).charge(fflib_Match.anySObject());
}
```

With the flag left at `false` the two `verify(..., 1)` calls would both see a combined count of 2
and fail. Set the flag as the first statement of the test method; it is a static, so it resets per
transaction.

## Injection checklist

- [ ] The class under test resolves collaborators exclusively through `Application.*`.
- [ ] Any overridden `newInstance()` still honours its `m_mock*` field.
- [ ] Stubbing is closed with `stopStubbing()` before the first `setMock` that calls the mock.
- [ ] Selector and domain mocks use the two-argument `setMock(SObjectType, mock)` form, or stub
      `sObjectType()` / `getType()`.
- [ ] `commitWork()` is verified in every service test that mutates data.
- [ ] At least one test per service goes through the static facade, proving the
      `Application.Service` map entry exists.
- [ ] `HasIndependentMocks = true` whenever two mocks share a type.

See `test-variants-cookbook.md` for complete test classes using each of these injections,
`troubleshooting-mocks.md` when injection appears correct but verification still fails, and
`sf-fflib-foundations` for the production-side factory design.
