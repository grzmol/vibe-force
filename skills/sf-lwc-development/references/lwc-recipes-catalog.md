# LWC Recipes Catalog

Curated index of runnable reference implementations in `trailheadapps/lwc-recipes`, mapped to the
problem each one solves. Component names below were read from the repository's
`force-app/main/default/lwc` directory, so every path resolves.

Base URL for every entry:
`https://github.com/trailheadapps/lwc-recipes/tree/main/force-app/main/default/lwc/<name>`

Deploy the whole sample app to a scratch org before studying it:

```bash
git clone https://github.com/trailheadapps/lwc-recipes
cd lwc-recipes
sf org create scratch --definition-file config/project-scratch-def.json --alias vf-recipes --set-default
sf project deploy start --target-org vf-recipes
sf org assign permset --name recipes --target-org vf-recipes
sf data import tree --plan ./data/data-plan.json --target-org vf-recipes
sf org open --target-org vf-recipes
```

## 1. Template and rendering basics

| Recipe | Demonstrates |
| --- | --- |
| `hello` | Minimal bundle: class, template, configuration file |
| `helloBinding` | Two-way-ish binding via `onchange` handler and a reactive field |
| `helloExpressions` | Computed values through getters instead of template expressions |
| `helloConditionalRendering` | `lwc:if` / `lwc:else` |
| `helloForEach` | `for:each` with `key` |
| `helloIterator` | `iterator:it` with `it.first` / `it.last` |
| `miscMultipleTemplates` | `render()` returning different imported templates |
| `clock` | `setInterval` in `connectedCallback()` with cleanup in `disconnectedCallback()` |
| `miscDomQuery` | `this.template.querySelector` / `querySelectorAll` |
| `lightDomQuery`, `lightDomQueryChild` | `static renderMode = 'light'` and `this.querySelector` |

## 2. Public API and composition

| Recipe | Demonstrates |
| --- | --- |
| `apiProperty` | `@api` field consumed from a parent template |
| `apiSetterGetter` | `@api` getter/setter pair normalizing input |
| `apiMethod` | `@api` method invoked by a parent |
| `apiSpread` | `lwc:spread` to pass an object of properties |
| `compositionBasics` | Parent/child composition with `@api` |
| `compositionContactSearch` | Search input, list, and detail panel composed together |
| `compositionIteration` | Rendering a list of child components |
| `compositionWithAppBuilder` | `targetConfigs` properties driving component behaviour |
| `child`, `contactTile`, `contactListItem` | Presentational leaf components |
| `paginator` | Reusable pagination child dispatching `previous`/`next` events |

## 3. Events

| Recipe | Demonstrates |
| --- | --- |
| `eventSimple` | `CustomEvent` with no payload, default (non-bubbling) options |
| `eventWithData` | `CustomEvent` with a `detail` payload |
| `eventBubbling`, `contactListItemBubbling` | `bubbles: true` and handling at an ancestor |
| `dispatchRefreshEvent` | `RefreshEvent` from `lightning/refresh` |
| `dispatchEventHeadlessAction` | Event dispatch from a headless quick action |
| `pubsub` | The legacy pubsub module kept only for comparison - prefer LMS |
| `lmsPublisherWebComponent`, `lmsSubscriberWebComponent` | Lightning Message Service publish/subscribe with `MessageContext` |

## 4. Apex integration

| Recipe | Demonstrates |
| --- | --- |
| `apexWireMethodToProperty` | `@wire(apexMethod)` bound to a field |
| `apexWireMethodToFunction` | `@wire(apexMethod)` bound to a function, enabling `refreshApex` |
| `apexWireMethodWithParams` | Dynamic `'$field'` parameters |
| `apexWireMethodWithComplexParams` | Object parameters serialized to Apex |
| `apexImperativeMethod` | Imperative call with `.then()/.catch()` |
| `apexImperativeMethodWithParams` | Imperative call with named arguments |
| `apexImperativeMethodWithComplexParams` | Passing Apex-typed objects imperatively |
| `apexStaticSchema` | `@salesforce/schema` imports instead of string field names |
| `errorPanel`, `ldsUtils` | The canonical `reduceErrors` helper and a reusable error display component |

## 5. Lightning Data Service and UI API

| Recipe | Demonstrates |
| --- | --- |
| `wireGetRecord`, `wireGetRecordStaticContact`, `wireGetRecordDynamicContact` | `getRecord` with static and reactive configurations |
| `wireGetRecordUser` | Reading the running user's record |
| `wireGetRecords`, `wireGetRecordsDifferentTypes` | `getRecords` batching |
| `wireGetObjectInfo` | `getObjectInfo` for metadata and default record type |
| `wireGetPicklistValues`, `wireGetPicklistValuesByRecordType` | Picklist adapters |
| `wireListView` | `getListUi`-style list view data |
| `ldsCreateRecord` | `createRecord` with `generateRecordInputForCreate` |
| `ldsGenerateRecordInputForCreate` | Building record input from create defaults |
| `ldsDeleteRecord` | `deleteRecord` |
| `ldsNotifyRecordUpdateAvailable` | Re-syncing LDS after an out-of-band write |
| `recordFormStaticContact`, `recordFormDynamicContact` | `lightning-record-form` |
| `recordEditFormStaticContact`, `recordEditFormDynamicContact` | `lightning-record-edit-form` with custom layout |
| `recordViewFormStaticContact`, `recordViewFormDynamicContact` | Read-only record display |
| `recordPickerHello`, `recordPickerMultiValue`, `recordPickerDynamicTarget` | `lightning-record-picker` |
| `viewToRefresh` | Refresh patterns after data changes |

## 6. GraphQL wire adapter

| Recipe | Demonstrates |
| --- | --- |
| `graphqlContacts` | Basic `gql` query through `@wire(graphql)` |
| `graphqlVariables` | Reactive `variables` object |
| `graphqlPagination` | Cursor-based paging with `pageInfo` |
| `graphqlMultipleObjects` | Multiple root objects in one query |
| `graphqlRefresh` | `refreshGraphQL` |

## 7. Datatables and custom data types

| Recipe | Demonstrates |
| --- | --- |
| `customDataTypes`, `datatableCustomDataType` | Extending `LightningDatatable` with custom cell types |
| `datatableInlineEditWithApex` | Inline edit saved through Apex |
| `datatableInlineEditWithUiApi` | Inline edit saved through `updateRecord` |

## 8. Navigation and workspace APIs

| Recipe | Demonstrates |
| --- | --- |
| `navToRecord`, `navToNewRecord`, `navToNewRecordWithDefaults` | `standard__recordPage` / `standard__objectPage` navigation |
| `navToListView`, `navToRelatedList` | List views and related lists |
| `navToHome`, `navToChatterHome`, `navToFilesHome`, `navToHelloTab` | Named pages and custom tabs |
| `navigateToRecordHeadlessAction` | Navigation from a headless quick action |
| `wireCurrentPageReference` | Reading URL state with `CurrentPageReference` |
| `workspaceAPI*` (`OpenTab`, `OpenSubtab`, `CloseTab`, `FocusTab`, `RefreshTab`, `SetTabLabel`, `SetTabIcon`, `HighlightTab`, `DisableTabClose`) | Console workspace manipulation via `lightning/platformWorkspaceApi` |

## 9. Styling and third-party libraries

| Recipe | Demonstrates |
| --- | --- |
| `stylesheets` | Component CSS and `:host` |
| `stylingHooks` | SLDS styling hooks and custom CSS properties on base components |
| `cssLibrary` | CSS-only component shared via `@import` |
| `miscStaticResource` | `@salesforce/resourceUrl` |
| `resourceLoader`, `libsD3`, `libsChartjs`, `libsFullCalendar` | `loadScript`/`loadStyle` plus guarded `renderedCallback()` initialization |
| `chartBar` | Chart rendering with `lwc:dom="manual"` |
| `miscContentAsset` | `@salesforce/contentAssetUrl` |

## 10. Platform services and miscellany

| Recipe | Demonstrates |
| --- | --- |
| `miscToastNotification` | `ShowToastEvent` variants |
| `miscNotificationModules` | `LightningAlert`, `LightningConfirm`, `LightningPrompt` |
| `miscModal`, `myModal` | `LightningModal` subclass and its `open()` API |
| `miscI18n` | `@salesforce/i18n` locale-sensitive formatting |
| `miscGetUserId` | `@salesforce/user/Id` |
| `miscPermissionBasedUI` | `@salesforce/userPermission` / `customPermission` gating |
| `miscSharedJavaScript` | Plain ES module shared between components |
| `miscRestApiCall` | Authenticated REST call from a component (see skill `sf-integration-patterns`) |
| `miscLogger` | `lightning/logger` |
| `editRecordScreenAction` | Screen quick action closing itself with `CloseActionScreenEvent` |
| `mortgage`, `todoList` | Small end-to-end feature components with Jest suites |
| `viewSource` | Utility component used by the sample app shell |

## How to use this catalog in vibe-force

1. Wave 0 (`sf-scout`): name the closest recipe for the component shape being built and record it in
   `.vibeforce/state/contract.md`.
2. Wave 1 (`sf-lwc-engineer`): copy the pattern, not the code - recipes omit error handling and
   accessibility polish that production components need.
3. Every recipe bundle ships a `__tests__` directory; those tests are the reference style enforced
   by skill `sf-lwc-jest-testing` and the `vf-check jest` gate.

## Sources

- https://github.com/trailheadapps/lwc-recipes (component directory listing read via
  `https://data.jsdelivr.com/v1/packages/gh/trailheadapps/lwc-recipes@main?structure=flat`)
- https://github.com/trailheadapps/lwc-recipes/blob/main/README.md (setup commands)
- https://github.com/trailheadapps/lwc-recipes/blob/main/force-app/main/default/lwc/stylingHooks
