# The Application factory

All signatures read from `apex-enterprise-patterns/fflib-apex-common` @ `master` commit `dab5977`,
file `sfdx-source/apex-common/main/classes/fflib_Application.cls`, plus the interface files
`fflib_IUnitOfWorkFactory.cls`, `fflib_IServiceFactory.cls`, `fflib_ISelectorFactory.cls`,
`fflib_IDomainFactory.cls`. The worked `Application.cls` is adapted from
`fflib-apex-common-samplecode` @ `master` commit `4657d63`,
`sfdx-source/apex-common-samplecode/main/classes/Application.cls`.

## 1. What the class is

`fflib_Application` is `public virtual class` and contains four inner factory classes plus two
exceptions. It is never instantiated directly; you declare one `Application` class per package with
four `public static final` fields.

| Inner class | Implements | Registry key | Returns |
| --- | --- | --- | --- |
| `fflib_Application.UnitOfWorkFactory` | `fflib_IUnitOfWorkFactory` | `List<SObjectType>` (commit order) | `fflib_ISObjectUnitOfWork` |
| `fflib_Application.ServiceFactory` | `fflib_IServiceFactory` | `Map<Type, Type>` interface -> impl | `Object` (cast by caller) |
| `fflib_Application.SelectorFactory` | `fflib_ISelectorFactory` | `Map<SObjectType, Type>` | `fflib_ISObjectSelector` |
| `fflib_Application.DomainFactory` | `fflib_IDomainFactory` | `Map<SObjectType, Type>` or `Map<Object, Type>` | `fflib_IDomain` |
| `fflib_Application.ApplicationException` | `extends Exception` | - | - |
| `fflib_Application.DeveloperException` | `extends Exception` | - | - |

Every factory class and every method is `virtual`, so you can subclass a factory to change
instantiation (the samplecode does this for user-mode DML - see section 6).

## 2. Complete reference `Application.cls`

```apex
/**
 * Single wiring point for one package directory. Nothing else registers implementations.
 */
public class Application {
    /**
     * Unit of Work: SObjectTypes are committed in this order.
     * Parents must appear before their children or the child insert fails on the lookup.
     */
    public static final fflib_Application.UnitOfWorkFactory UnitOfWork =
        new UserModeUnitOfWorkFactory(
            new List<SObjectType> {
                Account.SObjectType,
                Contact.SObjectType,
                Opportunity.SObjectType,
                OpportunityLineItem.SObjectType,
                Invoice__c.SObjectType,
                InvoiceLine__c.SObjectType });

    /** Service layer: Apex interface -> implementing class. */
    public static final fflib_Application.ServiceFactory Service =
        new fflib_Application.ServiceFactory(
            new Map<Type, Type> {
                IAccountsService.class      => AccountsServiceImpl.class,
                IOpportunitiesService.class => OpportunitiesServiceImpl.class,
                IInvoicingService.class     => InvoicingServiceImpl.class });

    /** Selector layer: SObjectType -> selector class. */
    public static final fflib_Application.SelectorFactory Selector =
        new fflib_Application.SelectorFactory(
            new Map<SObjectType, Type> {
                Account.SObjectType             => AccountsSelector.class,
                Contact.SObjectType             => ContactsSelector.class,
                Opportunity.SObjectType         => OpportunitiesSelector.class,
                OpportunityLineItem.SObjectType => OpportunityLineItemsSelector.class,
                PricebookEntry.SObjectType      => PricebookEntriesSelector.class,
                Pricebook2.SObjectType          => PricebooksSelector.class,
                Product2.SObjectType            => ProductsSelector.class,
                User.SObjectType                => UsersSelector.class });

    /** Domain layer: SObjectType -> domain *constructor* class. */
    public static final fflib_Application.DomainFactory Domain =
        new fflib_Application.DomainFactory(
            Application.Selector,
            new Map<SObjectType, Type> {
                Account.SObjectType             => Accounts.Constructor.class,
                Opportunity.SObjectType         => Opportunities.Constructor.class,
                OpportunityLineItem.SObjectType => OpportunityLineItems.Constructor.class });

    /**
     * Unit of Work factory that swaps the default SimpleDML for UserModeDML so that commitWork()
     * runs DML in AccessLevel.USER_MODE. m_objectTypes and m_mockUow are @NamespaceAccessible
     * protected members of fflib_Application.UnitOfWorkFactory.
     */
    private class UserModeUnitOfWorkFactory extends fflib_Application.UnitOfWorkFactory {
        public UserModeUnitOfWorkFactory(List<SObjectType> objectTypes) { super(objectTypes); }
        public override fflib_ISObjectUnitOfWork newInstance() {
            if (m_mockUow != null) { return m_mockUow; }
            return new fflib_SObjectUnitOfWork(
                m_objectTypes, new fflib_SObjectUnitOfWork.UserModeDML());
        }
    }
}
```

## 3. Companion interfaces

```apex
// service/IAccountsService.cls - pure contract, no fflib types needed
public interface IAccountsService {
    void updateOpportunityActivity(Set<Id> accountIds);
}

// service/AccountsService.cls - static facade used by callers
public with sharing class AccountsService {
    public static void updateOpportunityActivity(Set<Id> accountIds) {
        service().updateOpportunityActivity(accountIds);
    }
    private static IAccountsService service() {
        return (IAccountsService) Application.Service.newInstance(IAccountsService.class);
    }
}

// service/AccountsServiceImpl.cls - registered in Application.Service
public with sharing class AccountsServiceImpl implements IAccountsService {
    public void updateOpportunityActivity(Set<Id> accountIds) {
        fflib_ISObjectUnitOfWork uow = Application.UnitOfWork.newInstance();
        IAccounts accounts = (IAccounts) Application.Domain.newInstance(accountIds);
        accounts.updateOpportunityActivity();
        uow.registerDirty(accounts.getRecords());
        uow.commitWork();
    }
}

// selectors/IAccountsSelector.cls - MUST extend fflib_ISObjectSelector so the factory can bind it
public interface IAccountsSelector extends fflib_ISObjectSelector {
    List<Account> selectById(Set<Id> idSet);
    List<Account> selectByOpportunity(List<Opportunity> opportunities);
}
```

`fflib_ISObjectSelector` declares exactly two methods (`fflib_ISObjectSelector.cls`):

```apex
Schema.SObjectType sObjectType();
List<SObject> selectSObjectsById(Set<Id> idSet);
```

## 4. Factory API tables

### `UnitOfWorkFactory`

| Method | Behaviour |
| --- | --- |
| `UnitOfWorkFactory()` | empty registry; `newInstance()` would build a UoW with a null type list |
| `UnitOfWorkFactory(List<SObjectType> objectTypes)` | clones the list into `m_objectTypes` |
| `fflib_ISObjectUnitOfWork newInstance()` | mock if set, else `new fflib_SObjectUnitOfWork(m_objectTypes)` |
| `newInstance(fflib_SObjectUnitOfWork.IDML dml)` | same, with a custom DML implementation |
| `newInstance(List<SObjectType> objectTypes)` | ad-hoc type list for one use case |
| `newInstance(List<SObjectType> objectTypes, fflib_SObjectUnitOfWork.IDML dml)` | both |
| `protected virtual void setMock(fflib_ISObjectUnitOfWork mockUow)` | `@TestVisible` |

When a mock is set, all four `newInstance` overloads return the mock and the `objectTypes`/`dml`
arguments are ignored (documented in the source `@remark`).

### `ServiceFactory`

| Method | Behaviour |
| --- | --- |
| `ServiceFactory()` | empty |
| `ServiceFactory(Map<Type, Type> serviceInterfaceTypeByServiceImplType)` | registry; also initialises the mock map |
| `Object newInstance(Type serviceInterfaceType)` | mock, else `implType.newInstance()`; throws `DeveloperException('No implementation registered for service interface ' + name)` |
| `protected virtual void setMock(Type serviceInterfaceType, Object serviceImpl)` | `@TestVisible` |

The factory does not verify that the implementation actually implements the interface - Apex cannot
check that at runtime. A mis-mapped pair fails on the caller's cast with a `System.TypeException`.

### `SelectorFactory`

| Method | Behaviour |
| --- | --- |
| `SelectorFactory()` | empty |
| `SelectorFactory(Map<SObjectType, Type> sObjectBySelectorType)` | registry + mock map |
| `fflib_ISObjectSelector newInstance(SObjectType sObjectType)` | mock, else `selectorClass.newInstance()`; throws `DeveloperException('Selector class not found for SObjectType ' + type)` |
| `List<SObject> selectById(Set<Id> recordIds)` | derives the SObjectType from the first Id, asserts all Ids share it, calls `selectSObjectsById`; throws `DeveloperException('Invalid record Id\'s set')` on null/empty |
| `List<SObject> selectByRelationship(List<SObject> relatedRecords, SObjectField relationshipField)` | collects non-null lookup values then `selectById` |
| `protected virtual void setMock(fflib_ISObjectSelector selectorInstance)` | derives key from `selectorInstance.sObjectType()` |
| `protected virtual void setMock(SObjectType sType, fflib_ISObjectSelector selectorInstance)` | explicit key - preferred |

```apex
// selectByRelationship in practice: Opportunity -> parent Accounts, one SOQL, no custom method
List<Account> accounts =
    (List<Account>) Application.Selector.selectByRelationship(opportunities, Opportunity.AccountId);
```

### `DomainFactory`

| Method | Behaviour |
| --- | --- |
| `DomainFactory()` | empty |
| `DomainFactory(SelectorFactory selectorFactory, Map<Object, Type> constructorTypeByObject)` | generic (non-SObject domains) |
| `DomainFactory(SelectorFactory selectorFactory, Map<SObjectType, Type> sObjectByDomainConstructorType)` | usual form |
| `fflib_IDomain newInstance(Set<Id> recordIds)` | queries via the selector factory, then constructs |
| `fflib_IDomain newInstance(List<SObject> records)` | derives type via `records.getSObjectType()`; throws `DeveloperException('Unable to determine SObjectType')` for `List<SObject>` |
| `fflib_IDomain newInstance(List<SObject> records, SObjectType domainSObjectType)` | explicit type - use for `List<SObject>` |
| `fflib_IDomain newInstance(List<Object> objects, Object objectType)` | non-SObject domains |
| `setMock(fflib_ISObjectDomain)` / `setMock(SObjectType, fflib_ISObjectDomain)` / `setMock(fflib_IDomain)` | `@TestVisible protected` |

Construction dispatch inside `newInstance(List<Object>, Object)`, in order:

1. registered class `instanceof fflib_SObjectDomain.IConstructable2` -> `construct(records, sObjectType)`
2. else `instanceof fflib_SObjectDomain.IConstructable` -> `construct(records)`
3. else cast to `fflib_IDomainConstructor` -> `construct(objects)`

That is why you register `Accounts.Constructor.class`, not `Accounts.class` - the inner
`Constructor` class is the one implementing a constructable interface. A domain class that itself
implements `fflib_IDomainConstructor` may be registered directly (the samplecode registers
`DeveloperWorkItem__c.SObjectType => DeveloperWorkItems.class`). Domain layer detail lives in skill
`sf-fflib-domain-service-uow`.

## 5. Mock injection matrix

| Factory | Signature | Key used | Notes |
| --- | --- | --- | --- |
| `Application.UnitOfWork` | `setMock(fflib_ISObjectUnitOfWork)` | none (single slot) | overrides every `newInstance` overload |
| `Application.Service` | `setMock(Type, Object)` | the interface `Type` | one slot per interface; additive |
| `Application.Selector` | `setMock(fflib_ISObjectSelector)` | `mock.sObjectType()` | stub `sObjectType()` first |
| `Application.Selector` | `setMock(SObjectType, fflib_ISObjectSelector)` | explicit | preferred |
| `Application.Domain` | `setMock(fflib_ISObjectDomain)` | `mock.sObjectType()` | legacy trigger-handler domains |
| `Application.Domain` | `setMock(SObjectType, fflib_ISObjectDomain)` | explicit | preferred |
| `Application.Domain` | `setMock(fflib_IDomain)` | `mock.getType()` | new domain structure |

Working example, verbatim shape from
`fflib-apex-common-samplecode/.../test/classes/service/AccountsServiceTest.cls`:

```apex
@IsTest
private class AccountsServiceTest {
    @IsTest
    static void itShouldUpdateOpportunityActivity() {
        List<Account> accounts = new List<Account> {
            new Account(Name = 'A', Id = fflib_IDGenerator.generate(Schema.Account.SObjectType)),
            new Account(Name = 'B', Id = fflib_IDGenerator.generate(Schema.Account.SObjectType)) };
        Set<Id> accountIds = new Map<Id, SObject>(accounts).keySet();

        fflib_ApexMocks mocks = new fflib_ApexMocks();
        fflib_ISObjectUnitOfWork uowMock =
            (fflib_ISObjectUnitOfWork) mocks.mock(fflib_ISObjectUnitOfWork.class);
        IAccountsSelector selectorMock = (IAccountsSelector) mocks.mock(IAccountsSelector.class);
        IAccounts domainMock = (IAccounts) mocks.mock(Accounts.class);

        mocks.startStubbing();
        mocks.when(selectorMock.sObjectType()).thenReturn(Schema.Account.SObjectType);
        mocks.when(selectorMock.selectSObjectsById(accountIds)).thenReturn(accounts);
        mocks.when(domainMock.getType()).thenReturn(Schema.Account.SObjectType);
        mocks.when(domainMock.getRecords()).thenReturn(accounts);
        mocks.stopStubbing();

        Application.UnitOfWork.setMock(uowMock);
        Application.Domain.setMock(domainMock);
        Application.Selector.setMock(selectorMock);

        System.Test.startTest();
        new AccountsServiceImpl().updateOpportunityActivity(accountIds);
        System.Test.stopTest();

        ((IAccountsSelector) mocks.verify(selectorMock)).selectSObjectsById(accountIds);
        ((IAccounts) mocks.verify(domainMock)).updateOpportunityActivity();
        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock)).registerDirty(accounts);
        ((fflib_ISObjectUnitOfWork) mocks.verify(uowMock)).commitWork();
    }
}
```

Two details worth memorising: the domain mock is created from the concrete class
(`mocks.mock(Accounts.class)`) because the Stub API stubs a class or interface that the mock must be
castable from, and the test instantiates `new AccountsServiceImpl()` directly - the service under
test is the only thing not resolved through the factory.

## 6. Custom factory subclasses

Because all factory methods are `virtual` and the protected members are `@NamespaceAccessible`, you
can specialise instantiation without touching fflib. Two useful cases:

```apex
// (a) Always use user-mode DML (samplecode pattern).
private class UserModeUnitOfWorkFactory extends fflib_Application.UnitOfWorkFactory {
    public UserModeUnitOfWorkFactory(List<SObjectType> objectTypes) { super(objectTypes); }
    public override fflib_ISObjectUnitOfWork newInstance() {
        if (m_mockUow != null) { return m_mockUow; }
        return new fflib_SObjectUnitOfWork(
            m_objectTypes, new fflib_SObjectUnitOfWork.UserModeDML());
    }
}

// (b) Resolve service implementations from Custom Metadata so a package extension can override
//     a binding without editing Application.cls.
private class ConfigurableServiceFactory extends fflib_Application.ServiceFactory {
    public ConfigurableServiceFactory(Map<Type, Type> defaults) { super(defaults); }
    public override Object newInstance(Type serviceInterfaceType) {
        ServiceBinding__mdt override = ServiceBinding__mdt.getInstance(
            serviceInterfaceType.getName().replace('.', '_'));
        if (override != null && override.ImplementationClass__c != null) {
            return Type.forName(override.ImplementationClass__c).newInstance();
        }
        return super.newInstance(serviceInterfaceType);
    }
}
```

Pattern (b) is how the community "configurable dependency injection" variants work; the Custom
Metadata type name and fields above are an example, not an fflib API. `[unverified]` as an fflib
feature - fflib ships no Custom Metadata binding out of the box.

## 7. Common wiring mistakes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `fflib_Application.DeveloperException: No implementation registered for service interface IXService` | interface missing from the `Service` map, or you registered the facade class instead of the interface | register `IXService.class => XServiceImpl.class` |
| `fflib_Application.DeveloperException: Selector class not found for SObjectType X` | `X.SObjectType` missing from the `Selector` map | add it; check custom object suffix `__c` |
| `fflib_Application.DeveloperException: Domain constructor class not found for SObjectType X` | domain not registered, or registered under the wrong SObjectType | register `X.SObjectType => Xs.Constructor.class` |
| `System.TypeException: Invalid conversion from runtime type A to B` | `Map<Type, Type>` maps an interface to a class that does not implement it | fix the mapping; the factory cannot detect this |
| `System.NullPointerException` inside `DomainFactory.newInstance` | registered the domain class instead of its `Constructor` inner class | use `Xs.Constructor.class` |
| `REQUIRED_FIELD_MISSING` at `commitWork()` | child SObjectType listed before its parent | reorder the `UnitOfWork` list |
| Mock ignored, real selector runs | `Application.Selector.setMock(mock)` called without stubbing `sObjectType()` | use `setMock(X.SObjectType, mock)` |
| `Application` static initialiser throws in a subscriber org | a registered SObjectType is not deployed/licensed there | split `Application.cls` per package, or register lazily in a `virtual` factory override |
| Two features each with their own `Application` | duplicated registries; mocks set on one are invisible to the other | one `Application` per package directory |
| `setMock` "method is not visible" compile error | called from non-test code | `setMock` is `protected @TestVisible`; only tests may call it |

## 8. Checklist for an `Application.cls` review

- [ ] Exactly one `Application` class in the package directory.
- [ ] UnitOfWork SObjectType list ordered parents -> children, and includes every SObject any service commits.
- [ ] Every service interface in the repo appears in the `Service` map exactly once.
- [ ] Every selector class appears in the `Selector` map, keyed by the SObjectType it queries.
- [ ] Every domain appears in the `Domain` map keyed by SObjectType, value is the constructor class.
- [ ] `Domain` factory is constructed with `Application.Selector`, not a fresh `SelectorFactory`.
- [ ] No `new XServiceImpl()`, `new XSelector()`, or `new fflib_SObjectUnitOfWork(...)` in product code outside `Application.cls`.
- [ ] `assert-application-wiring.apex` runs clean against the target org (see skill `sf-fflib-foundations` Verification).

## Related

- Skill `sf-fflib-selector-layer` - selector implementation and `fflib_QueryFactory`
- Skill `sf-fflib-domain-service-uow` - domain, service, and Unit of Work internals
- Skill `sf-fflib-testing` - ApexMocks, `setMock`, matchers, verification
- Skill `sf-fflib-operations` - trigger wiring, batch jobs, packaging fflib
- Skill `sf-apex-development` - Apex conventions that still apply inside every layer
