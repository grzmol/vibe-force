# Rule Catalogue

The rules that earn their place in a Salesforce delivery gate: what they catch, why it matters, and
the fix. Rule names verified against
[PMD Apex rules](https://pmd.github.io/pmd/pmd_rules_apex.html),
[Graph Engine rules](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/rules-sfge.html),
[@lwc/eslint-plugin-lwc](https://github.com/salesforce/eslint-plugin-lwc), and
[@salesforce/eslint-config-lwc](https://github.com/salesforce/eslint-config-lwc).

Severities shown are the vibe-force policy severity (what `config/code-analyzer.yml` sets), not
necessarily the engine default.

## 1. PMD Apex - Security category

| Rule | Catches | vibe-force severity |
| --- | --- | --- |
| `ApexCRUDViolation` | SOQL/SOSL/DML without an access check | 2 |
| `ApexSOQLInjection` | untrusted or unescaped variables in dynamic queries | 1 |
| `ApexSharingViolations` | class with DML and no explicit sharing declaration | 2 |
| `ApexSuggestUsingNamedCred` | hardcoded credentials in callouts | 1 |
| `ApexInsecureEndpoint` | `http://` endpoints | 2 |
| `ApexOpenRedirect` | redirect to a user-controlled location | 2 |
| `ApexBadCrypto` | hardwired keys or IVs for `Crypto` calls | 1 |
| `ApexXSSFromURLParam` | URL parameter values used without escaping | 2 |
| `ApexXSSFromEscapeFalse` | `addError` with escaping disabled | 2 |
| `ApexDangerousMethods` | calls to known-dangerous methods | 2 |

### `ApexCRUDViolation`

```apex
// Violation
public with sharing class ExpenseService {
    public static List<Expense__c> all() {
        return [SELECT Id, Amount__c FROM Expense__c];
    }
}

// Fixed
public with sharing class ExpenseService {
    public static List<Expense__c> all() {
        return [SELECT Id, Amount__c FROM Expense__c WITH USER_MODE LIMIT 1000];
    }
}
```

Full enforcement matrix, including `stripInaccessible` and describe checks: skill `sf-security-model`
(`references/crud-fls-enforcement.md`).

### `ApexSOQLInjection`

```apex
// Violation
List<SObject> rows = Database.query('SELECT Id FROM Account WHERE Name = \'' + input + '\'');

// Fixed
Map<String, Object> binds = new Map<String, Object>{ 'name' => input };
List<Account> rows = Database.queryWithBinds(
    'SELECT Id FROM Account WHERE Name = :name', binds, AccessLevel.USER_MODE
);
```

### `ApexSharingViolations`

```apex
// Violation: no sharing declaration on a class that performs DML
public class InvoiceWriter { public static void save(List<Invoice__c> rows) { insert rows; } }

// Fixed
public with sharing class InvoiceWriter {
    public static void save(List<Invoice__c> rows) { insert as user rows; }
}
```

## 2. PMD Apex - Error Prone category

| Rule | Catches | vibe-force severity |
| --- | --- | --- |
| `ApexCSRF` | DML in a constructor or initializer (state change on page load) | 1 |
| `AvoidDirectAccessTriggerMap` | `Trigger.new[0]` style access that breaks in bulk | 3 |
| `AvoidHardcodingId` | literal record Ids | 2 |
| `AvoidStatefulDatabaseResult` | `Database.SaveResult` and similar held in instance variables of a stateful batch | 3 |
| `EmptyCatchBlock` | swallowed exceptions | 2 |
| `EmptyIfStmt`, `EmptyStatementBlock`, `EmptyTryOrFinallyBlock`, `EmptyWhileStmt` | dead or placeholder code | 4 |
| `InaccessibleAuraEnabledGetter` | non-public getter on a type returned to Lightning (Summer '21 security update) | 2 |
| `InvocableClassNoArgConstructor` | `@InvocableVariable` class without a visible no-arg constructor | 2 |
| `MethodWithSameNameAsEnclosingClass` | non-constructor method shadowing the class name | 3 |
| `OverrideBothEqualsAndHashcode` | broken map/set semantics | 3 |
| `TestMethodsMustBeInTestClasses` | test methods outside an `@IsTest` class | 3 |
| `TypeShadowsBuiltInNamespace` | class named like a System type | 3 |
| `AvoidInterfaceAsMapKey` | interface as a `Map` key with an abstract implementer | 3 |
| `AvoidNonExistentAnnotations` | annotations Apex tolerates but does not implement | 3 |

### `AvoidDirectAccessTriggerMap`

```apex
// Violation: only handles the first record
trigger AccountTrigger on Account (before update) {
    if (Trigger.new[0].Rating == 'Hot') { AccountHandler.flag(Trigger.new[0]); }
}

// Fixed: bulk-safe
trigger AccountTrigger on Account (before update) {
    AccountHandler.beforeUpdate(Trigger.new, Trigger.oldMap);
}
```

### `EmptyCatchBlock`

```apex
// Violation
try { service.call(); } catch (CalloutException e) { }

// Fixed: handle, or rethrow with context
try {
    service.call();
} catch (CalloutException e) {
    Logger.error('Order sync callout failed', e);   // structured, no PII
    throw new OrderSyncException('Order sync unavailable. Retry later.', e);
}
```

## 3. PMD Apex - Performance category

| Rule | Catches | vibe-force severity |
| --- | --- | --- |
| `OperationWithLimitsInLoop` | DML, SOQL, SOSL, `Database` methods, Approval, Email inside a loop | 1 |
| `OperationWithHighCostInLoop` | expensive calls inside loops (for example schema describes) | 2 |
| `AvoidNonRestrictiveQueries` | unfiltered or unbounded SOQL/SOSL | 2 |
| `EagerlyLoadedDescribeSObjectResult` | describes that could be loaded eagerly via `SObjectType.getDescribe(...)` | 4 |
| `AvoidDebugStatements` | `System.debug` contributing to CPU time even with logs off | 3 |

### `OperationWithLimitsInLoop`

```apex
// Violation
for (Account a : accounts) {
    insert new Task(WhatId = a.Id, Subject = 'Follow up');
}

// Fixed
List<Task> tasks = new List<Task>();
for (Account a : accounts) {
    tasks.add(new Task(WhatId = a.Id, Subject = 'Follow up'));
}
if (!tasks.isEmpty()) {
    insert as user tasks;
}
```

`AvoidDebugStatements` is deliberately set to 3 in vibe-force: debug statements consume Apex CPU time
even when debug logs are off. Keep them out of loops and out of hot paths; route diagnostics through
a logger that checks a configuration flag (skill `sf-debugging-logs`).

## 4. PMD Apex - Best Practices and Design

| Rule | Catches | vibe-force severity |
| --- | --- | --- |
| `ApexUnitTestClassShouldHaveAsserts` | test class with no assertions | 2 |
| `ApexUnitTestShouldNotUseSeeAllDataTrue` | `@IsTest(seeAllData=true)` | 2 |
| `ApexUnitTestClassShouldHaveRunAs` | test without a `System.runAs` block | 4 |
| `ApexAssertionsShouldIncludeMessage` | assertions without a failure message | 4 |
| `ApexUnitTestMethodShouldHaveIsTestAnnotation` | legacy `testMethod` keyword | 3 |
| `AvoidLogicInTrigger` | business logic in the trigger body | 2 |
| `AvoidGlobalModifier` | `global` classes (undeletable in packages) | 3 |
| `AvoidFutureAnnotation` | `@future` where Queueable is the modern choice | 3 |
| `QueueableWithoutFinalizer` | `Queueable` with no attached `Finalizer` | 3 |
| `DebugsShouldUseLoggingLevel` | `System.debug(msg)` without a `LoggingLevel` | 4 |
| `UnusedLocalVariable` | declared or assigned but unused locals | 4 |
| `CognitiveComplexity`, `CyclomaticComplexity`, `NcssCount`, `ExcessiveParameterList`, `ExcessivePublicCount`, `TooManyFields` | oversized, hard-to-test units | 4 |
| `UnusedMethod` | unreferenced methods | 4 |
| `ApexDoc` | missing ApexDoc on public API surface | 5 |

`ExcessiveClassLength`, `NcssConstructorCount`, `NcssMethodCount`, and `NcssTypeCount` are marked
deprecated in PMD; prefer `NcssCount` and `CognitiveComplexity`. Async patterns behind
`AvoidFutureAnnotation` and `QueueableWithoutFinalizer`: skill `sf-async-apex-patterns`.

## 5. PMD Apex - Code Style

Configurable naming and brace rules: `ClassNamingConventions`, `MethodNamingConventions`,
`FieldNamingConventions`, `LocalVariableNamingConventions`, `FormalParameterNamingConventions`,
`PropertyNamingConventions`, `AnnotationsNamingConventions`, `OneDeclarationPerLine`,
`FieldDeclarationsShouldBeAtStart`, `IfStmtsMustUseBraces`, `IfElseStmtsMustUseBraces`,
`ForLoopsMustUseBraces`, `WhileLoopsMustUseBraces`.

vibe-force keeps the naming rules at severity 4 (report, do not block) and lets Prettier own brace
and layout questions. The `quickstart` PMD ruleset (`rulesets/apex/quickstart.xml`) is a reasonable
starting selection: it contains the security rules, the empty-block rules, the naming rules, the
complexity rules, the unit-test rules, `AvoidLogicInTrigger`, `AvoidHardcodingId`,
`AvoidDirectAccessTriggerMap`, `OperationWithLimitsInLoop`, and `OperationWithHighCostInLoop`.

## 6. Graph Engine (`sfge`) rules

| Rule | Type | Catches |
| --- | --- | --- |
| `ApexFlsViolation` | path-based | CRUD/FLS violations between an entry point and a DML or SOQL sink |
| `DatabaseOperationsMustUseWithSharing` | path-based | database operations reachable in a `without sharing` context, or implicit sharing inheritance |
| `ApexNullPointerException` | path-based | dereference of a value that can be null along some path |
| `AvoidDatabaseOperationInLoop` | path-based | database operation inside a loop |
| `AvoidMultipleMassSchemaLookups` | path-based | repeated `Schema.getGlobalDescribe()` / `Schema.describeSObjects(...)` in one path or inside a loop |
| `MissingNullCheckOnSoqlVariable` | path-based | `WHERE` clause variable with no null check, turning an indexed lookup into a full scan |
| `UnimplementedType` | traditional | non-global abstract class or interface with no implementation |

Entry points Graph Engine starts paths from: `@AuraEnabled`, `@InvocableMethod`,
`@NamespaceAccessible`, and `@RemoteAction` methods; any method returning a `PageReference`;
`public`-scoped methods on Visualforce controllers; `global`-scoped methods on any class;
`Messaging.InboundEmailResult handleInboundEmail()` implementations of
`Messaging.InboundEmailHandler`; and any method explicitly targeted during invocation.

`ApexFlsViolation` sinks: all DML operations and their `Database.*` counterparts (delete, insert,
merge, undelete, update, upsert) plus SOQL queries and `Database.query`.

`ApexFlsViolation` sanitizers: `Schema.DescribeSObjectResult` checks (acceptable for DELETE,
UNDELETE, MERGE), `Schema.DescribeFieldResult` checks (acceptable for READ, INSERT, UPDATE, UPSERT
on standard and custom objects), lists filtered through `Security.stripInaccessible`, SOQL using
`WITH USER_MODE`, and SOQL using `WITH SECURITY_ENFORCED`. The last sanitizer is relevant only to
classes saved at API 66.0 or earlier: at API 67.0 and later that clause is not allowed in Apex SOQL,
so new code must satisfy the rule with `WITH USER_MODE`, `AccessLevel.USER_MODE`,
`stripInaccessible`, or describe checks.

Reading the message:

> `<Validation-Type>`-validation is missing for `<Operation-Name>` operation on `<Object-Type>` with fields `<Comma-Separated-Fields>`

- `Validation-Type` `CRUD` means an object-level check is missing, `FLS` means field-level.
- `Object-Type` shows `SFGE_Unresolved_Argument` or a variable name when Graph Engine could not infer
  the object.
- `Unknown` in the field list means Graph Engine could not infer all fields: determine them manually.
- The longer variant ending "Manually confirm if the objects and fields involved in these segments
  have FLS checks: `<Unknown-Segments>`" also appears when a field or object name ends in `__r`.
  Review the relationship, then add an engine directive if the warning is genuinely wrong.

### `DatabaseOperationsMustUseWithSharing`

Two distinct messages:

| Message | Meaning | Fix |
| --- | --- | --- |
| "Database operation must be executed from a class that enforces sharing rules." | the operation is in a `without sharing` class or inherits from one | add `with sharing` or `inherited sharing` |
| "The database operation's class implicitly inherits a sharing model from %s %s. Explicitly assign a sharing model instead." | no declaration, so the class implicitly inherits | declare the mode explicitly, even though the current call path is safe |

### `MissingNullCheckOnSoqlVariable`

```apex
// Violation: if targetName is null the WHERE clause scans the whole table
List<Account> rows = [SELECT Id FROM Account WHERE Name = :targetName WITH USER_MODE];

// Fixed
if (String.isBlank(targetName)) {
    return new List<Account>();
}
List<Account> rows = [SELECT Id FROM Account WHERE Name = :targetName WITH USER_MODE];
```

Sanitizers accepted by this rule: an explicit null check (`if (x != null)`), assignment to a
non-null literal, or a check for a specific non-null value.

### `AvoidDatabaseOperationInLoop`

Fix with either a SOQL for-loop over the query results or list accumulation followed by a single DML
after the loop. Same remediation as PMD's `OperationWithLimitsInLoop`; Graph Engine additionally
catches the case where the loop and the operation are in different methods on the same path.

## 7. ESLint LWC rules

Configurations available from `@salesforce/eslint-config-lwc` (each also with a `Ts` suffix variant):

| Config | Contents |
| --- | --- |
| `base` | LWC-specific rules only |
| `recommended` | base + most ESLint possible-error rules + selected best-practice rules + LWC best practices |
| `extended` | recommended + restrictions on syntax that is slow after the COMPAT transform |
| `i18n` | internationalization rules from `@salesforce/eslint-plugin-lightning` |
| `ssr` | server-side-rendering rules only |

vibe-force uses `recommended` plus `eslint-plugin-jest` for test files. `extended` is only worth it
for orgs that still support COMPAT-mode browsers.

| Rule | Catches | vibe-force severity |
| --- | --- | --- |
| `@lwc/lwc/no-inner-html` | `innerHTML` assignment (XSS sink) | 1 |
| `@lwc/lwc/no-document-query` | `document.querySelector` escaping the component boundary | 2 |
| `@lwc/lwc/no-async-operation` | unmanaged `setTimeout`/`setInterval`/`requestAnimationFrame` | 2 |
| `@lwc/lwc/no-leaky-event-listeners` | listeners added without removal | 2 |
| `@lwc/lwc/valid-api` | invalid `@api` usage | 2 |
| `@lwc/lwc/valid-track` | invalid `@track` usage | 2 |
| `@lwc/lwc/valid-wire` | invalid `@wire` usage | 2 |
| `@lwc/lwc/no-unknown-wire-adapters` | wire adapter that does not exist | 2 |
| `@lwc/lwc/no-unexpected-wire-adapter-usages` | wire adapter used outside `@wire` | 2 |
| `@lwc/lwc/no-api-reassignments` | writing to a public property | 2 |
| `@lwc/lwc/no-attributes-during-construction` | setting attributes in the constructor | 2 |
| `@lwc/lwc/no-host-mutation-in-connected-callback` | mutating the host element in `connectedCallback` | 2 |
| `@lwc/lwc/no-deprecated` | deprecated LWC APIs | 2 |
| `@lwc/lwc/no-disallowed-lwc-imports` | importing unsupported APIs from `lwc` | 2 |
| `@lwc/lwc/consistent-component-name` | class name not matching the file name (fixable) | 3 |
| `@lwc/lwc/no-leading-uppercase-api-name` | public property starting with an uppercase letter | 3 |
| `@lwc/lwc/no-template-children` | reaching into `this.template` children | 3 |
| `@lwc/lwc/prefer-custom-event` | `new Event(...)` instead of `CustomEvent` | 3 |
| `@lwc/lwc/valid-graphql-wire-adapter-callback-parameters` | `error` instead of `errors` on GraphQL wire | 3 |
| `@lwc/lwc/newer-version-available` | a newer module version exists (fixable) | 5 |

SSR-only rules (`ssr-no-restricted-browser-globals`, `ssr-no-unsupported-properties`,
`ssr-no-node-env`, `ssr-no-disallowed-lwc-imports`, `ssr-no-host-mutation-in-connected-callback`,
`ssr-no-static-imports-of-user-specific-scoped-modules`, `ssr-no-form-factor`,
`ssr-no-unsupported-node-api`) apply only if the components are rendered server-side; the `lwc/ssr`
processor lints just the JavaScript of SSR-able components.

COMPAT-performance rules (`no-async-await`, `no-for-of`, `no-rest-parameter`) are off in vibe-force:
modern browsers do not need them and they reduce code quality.

`@lwc/lwc/no-dupe-class-members` is deprecated in favour of the base ESLint
`no-dupe-class-members` rule.

### `no-inner-html` fix

```javascript
// Violation
this.template.querySelector('.body').innerHTML = this.markup;

// Fixed: render text, or use lightning-formatted-rich-text for sanitized markup
this.template.querySelector('.body').textContent = this.text;
```

### `no-async-operation` fix

```javascript
// Violation
setTimeout(() => this.refresh(), 500);

// Fixed: own the handle and clear it
connectedCallback() {
    this._timer = setTimeout(() => this.refresh(), 500);
}
disconnectedCallback() {
    clearTimeout(this._timer);
}
```

## 8. Jest test linting

`eslint-plugin-jest` is a peer dependency of `@salesforce/eslint-config-lwc`. Apply it to
`**/__tests__/**` so test files get Jest globals and Jest-specific correctness rules
(`jest/no-disabled-tests`, `jest/no-focused-tests`, `jest/expect-expect`,
`jest/valid-expect`). `[unverified]` The exact rule set enabled by
`eslint-plugin-jest`'s recommended config was not fetched this session; enable the plugin's
recommended config rather than enumerating rules by hand. Test authoring itself: skill
`sf-lwc-jest-testing`.

## 9. `regex` engine rules

Bundled example: `AvoidTermsWithImplicitBias`, `NoTrailingWhiteSpace`. Project conventions worth
encoding as regex rules:

| Convention | Pattern intent |
| --- | --- |
| No `seeAllData=true` | `@IsTest(seeAllData=true)` in `.cls` |
| No `System.assert(` without message | legacy assertion style |
| No `sfdx force:` in scripts or docs | retired CLI syntax |
| No hardcoded org domains | `my-org.my.salesforce.com` literals in `.cls`, `.js`, `.xml` |
| No `SELECT *`-style unbounded queries in docs | documentation drift |

Every custom regex must carry the global modifier. Keep them few and precise: regex rules cannot see
structure and produce false positives quickly.

## 10. `retire-js` engine

Scans bundled JavaScript for known-vulnerable library versions. Policy: any finding at severity 1 or
2 blocks the release; remediate by upgrading the static resource. Run it explicitly when a static
resource changes:

```bash
sf code-analyzer run --workspace . --rule-selector retire-js --view detail
```

## 11. `flow` engine

Flow Scanner rules cover unsafe Flow patterns; the example named in the Code Analyzer docs is
`PreventPassingUserDataIntoElementWithSharing`, which is path-based and reports both the violation
location and the start of the path. List the current set with:

```bash
sf code-analyzer rules --rule-selector flow --view detail
```

Flow design guidance: skill `sf-flow-automation`.

## 12. AppExchange ruleset

`sf code-analyzer run --rule-selector AppExchange --view detail` runs the PMD AppExchange rules used
to prepare managed packages for security review. Run it before submitting a package
(skill `sf-packaging-release`); it is not part of the per-PR gate because it targets ISV concerns.
