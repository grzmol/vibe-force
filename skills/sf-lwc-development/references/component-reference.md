# LWC Component Reference

Exhaustive lookup tables for decorators, lifecycle hooks, template directives, configuration file
elements, and `@salesforce` scoped modules. Companion to `SKILL.md` in this directory.

## 1. Decorators

| Decorator | Import | Applies to | Effect | Errors |
| --- | --- | --- | --- | --- |
| `@api` | `import { api } from 'lwc'` | Field, getter/setter pair, method | Makes the member part of the component's public API; settable from the template of the owner and from `js-meta.xml` properties | `@api` + `@track` on the same member is LWC1093 |
| `@track` | `import { track } from 'lwc'` | Field only | Deep reactivity: mutation *inside* an object/array triggers rerender | Not allowed on getters, setters, or methods |
| `@wire` | `import { wire } from 'lwc'` | Field or method | Binds a wire adapter to the member; the adapter identifier must be an imported binding, not a local variable (LWC1097/LWC1098) | Cannot combine with `@track` on the same property |

Reactivity rules (from the LWC reactivity guide):

| Assignment | Rerender? |
| --- | --- |
| `this.bool = false` (was `true`) | Yes |
| `this.number = 42` (was `42`) | No - value is `===` |
| `this.obj = { name: 'John' }` (same literal, new object) | Yes - new reference |
| `this.obj.name = 'Bob'` on an untracked field | No |
| `this.obj = { ...this.obj, title: 'CEO' }` | Yes |
| `this.arr.push(x)` on `@track arr` | Yes |
| `this.arr.push(x)` on an untracked `arr` | No |

Getters used in the template are re-evaluated whenever a reactive field they read changes.

## 2. Lifecycle hooks

| Hook | Direction | Runs | Typical use | Hazards |
| --- | --- | --- | --- | --- |
| `constructor()` | parent to child | Once | `super()` (must be first statement), primitive defaults | `this.template` is not usable; `@api` values are not yet set; no DOM |
| `connectedCallback()` | parent to child | Every insertion into the DOM | LMS `subscribe`, imperative Apex kickoff, `setInterval` | May run more than once if the element is moved; children not rendered yet |
| `render()` | n/a | Before each render | `return templateA` / `templateB` for multi-template components | Must be pure - no side effects |
| `renderedCallback()` | child to parent | After every render | Guarded one-time third-party init, manual DOM measurement | Mutating `@api` props or wire-config props here causes an infinite rerender loop |
| `disconnectedCallback()` | parent to child | Removal from the DOM | `unsubscribe`, `clearInterval`, `AbortController.abort()` | Not guaranteed on page unload |
| `errorCallback(error, stack)` | n/a | A descendant throws during lifecycle or render | Render an error boundary and log | Only catches descendants, not the component's own handlers or promises |

Rerender trigger sequence: a tracked mutation marks the component dirty, and a microtask is enqueued
to rerender. That is why tests must `await Promise.resolve()` before asserting DOM output
(skill `sf-lwc-jest-testing`).

Diffing notes: elements created by `for:each` are reused when their `key` is unchanged; slotted
content is reused when the diffing algorithm can match it.

Form-associated custom elements additionally support `formAssociatedCallback()`,
`formDisabledCallback()`, `formResetCallback()`, and `formStateRestoreCallback(state, mode)` when the
class declares `static formAssociated = true`.

## 3. Template directives

| Directive | Placement | Notes |
| --- | --- | --- |
| `lwc:if={expr}` | `<template>` or any element/custom element | Supersedes `if:true`. Simple dot notation only; complex logic goes in a getter |
| `lwc:elseif={expr}` | Immediately after `lwc:if`/`lwc:elseif` sibling | Cannot appear on the same element as `lwc:if` |
| `lwc:else` | Immediately after `lwc:if`/`lwc:elseif` sibling | No expression |
| `if:true` / `if:false` | Legacy | Do not mix with `lwc:if` on one element; prefer `lwc:if` |
| `for:each={list}` + `for:item="x"` | `<template>` or element | Requires `key` on the first child element |
| `for:index="i"` | With `for:each` | Index is for display only - never use as `key` |
| `iterator:it={list}` | `<template>` or element | Exposes `it.value`, `it.index`, `it.first`, `it.last`; cannot be combined with `for:each` on the same element |
| `key={expr}` | First element inside the iteration | Must be a stable, unique, primitive business key |
| `lwc:ref="name"` | Any element in the template | Access via `this.refs.name`; not supported inside `for:each`/`iterator:` |
| `lwc:dom="manual"` | Empty native element (not a custom element, not a `<slot>`) | Declares that you will insert nodes imperatively; only value `"manual"` is valid (LWC1085); illegal in light DOM (LWC1088) |
| `lwc:render-mode="light"` | Root `<template>` | Pairs with `static renderMode = 'light'` in the class |
| `lwc:inner-html={expr}` | Element | Sanitized HTML injection; not allowed on `<slot>` or on templates with conditional directives |
| `lwc:is={ctor}` on `<lwc:component>` | Dynamic component instantiation | Requires `lightning__dynamicComponent` capability in `js-meta.xml` |
| `lwc:spread={obj}` | Element | Spreads an object of properties onto a child component |
| `<slot>` / `<slot name="x">` | Child template | Slotted content is owned by the parent; event listeners on default/named slots are invalid in light DOM (LWC1139) |
| Scoped slots (`lwc:slot-data`, `lwc:slot-bind`) | Child exposes data to slotted markup | Child: `<slot lwc:slot-data="item">`; parent binds with `lwc:slot-bind` |

Event handler binding is `on<eventname>={handler}` with an all-lowercase event name and no
parentheses. Multiple handlers for the same event on one element are invalid.

## 4. `js-meta.xml` elements

| Element | Required | Notes |
| --- | --- | --- |
| `apiVersion` | Yes (Spring '25 and later, to save changes) | `67.0` per `config/vibe-force.defaults.json`. Minimum supported value is `45.0`. LDS and base components always run at the latest version regardless of this value |
| `isExposed` | Yes | `false` hides the component from all builders |
| `masterLabel` | For exposed components | Title shown in Setup and builders |
| `description` | Recommended | Tooltip in the builders |
| `targets` / `target` | For exposed components | At least one required for builder visibility |
| `targetConfigs` / `targetConfig` | Optional | Per-target `property`, `objects`, `supportedFormFactors` |
| `capabilities` / `capability` | Optional | `lightning__dynamicComponent`, `lightningCommunity__RelaxedCSP`, `lightning__ServerRenderable`, `lightning__ServerRenderableWithHydration`, `lightning__ServiceCloudVoiceToolkitApi` |
| `ai` / `description` / `property` | Optional | Agentforce descriptions for record pages; `aiDescription` up to 4,000 characters |

### Target values

| Target | Where the component appears |
| --- | --- |
| `lightning__AppPage` | App page in Lightning App Builder |
| `lightning__HomePage` | Home page in Lightning App Builder |
| `lightning__RecordPage` | Record page in Lightning App Builder |
| `lightning__Tab` | Custom tab in Lightning Experience and the Salesforce mobile app |
| `lightning__FlowScreen` | Flow screen component in Flow Builder |
| `lightning__RecordAction` | Quick action on a record page (`actionType` = `Action` or `ScreenAction`) |
| `lightning__GlobalAction` | Global quick action (`actionType` in `targetConfig`) |
| `lightning__UtilityBar` | Utility item in App Manager |
| `lightning__UrlAddressable` | Direct navigation by URL (`standard__component` page reference) |
| `lightning__Inbox` | Outlook/Gmail integration email application panes |
| `lightning__PropertyEditor` | Custom property editor in Experience Builder |
| `lightning__AgentforceInput` / `lightning__AgentforceOutput` | Agent action input/output |
| `lightning__EnablementProgram` | Custom exercise type in Program Builder |
| `lightning__ECSFSApp` | Field Service Mobile App Builder |
| `lightning__ServiceDocument` | Document Builder |
| `lightning_VoiceExtension` | Voice Extension page |
| `lightningCommunity__Page` | Drag-and-drop component in Experience Builder |
| `lightningCommunity__Default` | Exposes editable properties when selected in Experience Builder |
| `lightningCommunity__Page_Layout` | Content layout for an LWR site |
| `lightningCommunity__Theme_Layout` | Theme layout for an LWR site |
| `lightningSnapin__ChatHeader`, `lightningSnapin__ChatMessage`, `lightningSnapin__Minimized`, `lightningSnapin__PreChat`, `lightningSnapin__MessagingPreChat`, `lightningSnapin__MessagingHeader` | Embedded Service / Messaging for In-App and Web |
| `lightningStatic__Email` | Email Content Builder |
| `analytics__Dashboard` | CRM Analytics dashboard widget |

### Target-specific configuration cheatsheet

| Scenario | Snippet |
| --- | --- |
| Record page restricted to two objects | `<targetConfig targets="lightning__RecordPage"><objects><object>Account</object><object>Case</object></objects></targetConfig>` |
| App page, phone only | `<targetConfig targets="lightning__AppPage"><supportedFormFactors><supportedFormFactor type="Small"/></supportedFormFactors></targetConfig>` |
| Flow screen input/output | `<property name="todos" type="String[]" label="Todos" role="inputOnly"/>` (`role` accepts `inputOnly` / `outputOnly`) |
| Headless quick action | `<targetConfig targets="lightning__RecordAction"><actionType>Action</actionType></targetConfig>` |
| Experience Cloud property editable in Experience Builder | Declare the property under `lightningCommunity__Default` |

Experience Cloud specifics: components on an LWR site get `recordId` only if you declare it as a
property; there is no implicit record context outside `lightning__RecordPage`. Quick actions of type
`Action` (headless) must implement `@api invoke()`.

## 5. `@salesforce` scoped modules

| Module | Import form | Returns |
| --- | --- | --- |
| `@salesforce/apex/Class.method` | `import m from '@salesforce/apex/Cls.method'` | Function returning a Promise (imperative) or wire adapter |
| `@salesforce/apex` | `import { refreshApex } from '@salesforce/apex'` | `refreshApex(valueProvisionedByApexWireService)` |
| `@salesforce/schema/Object` | `import ACCOUNT from '@salesforce/schema/Account'` | `{ objectApiName }` |
| `@salesforce/schema/Object.Field` | `import NAME from '@salesforce/schema/Account.Name'` | `{ objectApiName, fieldApiName }` |
| `@salesforce/schema/Object.Rel__r.Field` | Same | Cross-object field reference |
| `@salesforce/label/c.Name` | `import lbl from '@salesforce/label/c.Escalate'` | Translated label string |
| `@salesforce/resourceUrl/Name` | `import url from '@salesforce/resourceUrl/chartjs'` | Static resource URL string |
| `@salesforce/contentAssetUrl/Name` | Same shape | Content asset URL |
| `@salesforce/messageChannel/Name__c` | `import CH from '@salesforce/messageChannel/Record_Selected__c'` | Message channel object (namespaced: `ns__Channel__c`) |
| `@salesforce/user/Id`, `@salesforce/user/isGuest` | `import id from '@salesforce/user/Id'` | Current user id / guest flag |
| `@salesforce/userPermission/Name` | `import hasPerm from '@salesforce/userPermission/ViewSetup'` | Boolean |
| `@salesforce/customPermission/Name` | Boolean | Custom permission check |
| `@salesforce/i18n/lang`, `/locale`, `/currency`, `/timeZone`, `/dir`, `/firstDayOfWeek`, `/numberFormat.*`, `/dateTime.*` | `import lang from '@salesforce/i18n/lang'` | Locale-sensitive values for the running user |
| `@salesforce/site/Id`, `@salesforce/site/basePath` | Experience Cloud site context | String |
| `@salesforce/client/formFactor` | `'Large' \| 'Medium' \| 'Small'` | Device form factor |

## 6. Platform modules

| Module | Key exports |
| --- | --- |
| `lightning/uiRecordApi` | `getRecord`, `getRecords`, `getRecordCreateDefaults`, `createRecord`, `updateRecord`, `deleteRecord`, `getFieldValue`, `getFieldDisplayValue`, `generateRecordInputForCreate`, `generateRecordInputForUpdate`, `createRecordInputFilteredByEditedFields`, `notifyRecordUpdateAvailable`, `getRecordNotifyChange` (deprecated) |
| `lightning/uiObjectInfoApi` | `getObjectInfo`, `getObjectInfos`, `getPicklistValues`, `getPicklistValuesByRecordType` |
| `lightning/uiListsApi` | `getListUi`, `getListInfoByName`, `getListRecordsByName` |
| `lightning/uiRelatedListApi` | `getRelatedListRecords`, `getRelatedListInfo`, `getRelatedListInfoBatch` |
| `lightning/uiGraphQLApi` | `graphql`, `gql`, `refreshGraphQL` |
| `lightning/navigation` | `NavigationMixin`, `CurrentPageReference` |
| `lightning/messageService` | `publish`, `subscribe`, `unsubscribe`, `MessageContext`, `createMessageContext`, `releaseMessageContext`, `APPLICATION_SCOPE` |
| `lightning/platformShowToastEvent` | `ShowToastEvent` |
| `lightning/platformResourceLoader` | `loadScript`, `loadStyle` |
| `lightning/actions` | `CloseActionScreenEvent` (screen quick actions) |
| `lightning/refresh` | `RefreshEvent`, `registerRefreshHandler`, `unregisterRefreshHandler` |
| `lightning/logger` | `log` |
| `lightning/empApi` | `subscribe`, `unsubscribe`, `onError` (platform events; see skill `sf-integration-patterns`) |
| `lightning/modal`, `lightning/modalBody`, `lightning/modalFooter`, `lightning/modalHeader` | `LightningModal` base class and slots |
| `lightning/alert`, `lightning/confirm`, `lightning/prompt` | `LightningAlert.open()`, `LightningConfirm.open()`, `LightningPrompt.open()` |

## 7. Base component selection

| Requirement | Component |
| --- | --- |
| Full record create/edit/view form with layout and FLS | `lightning-record-form` |
| Custom-arranged form fields, still FLS-aware | `lightning-record-edit-form` + `lightning-input-field` + `lightning-button` (`type="submit"`) |
| Read-only record display | `lightning-record-view-form` + `lightning-output-field` |
| Tabular data with sorting/inline edit | `lightning-datatable` |
| Record lookup | `lightning-record-picker` |
| Page container | `lightning-card`, `lightning-layout`, `lightning-layout-item` |
| Feedback | `lightning-spinner`, `lightning-icon`, `ShowToastEvent` |
| Modal | `LightningModal` subclass (`lightning/modal`) |

## 8. Shadow DOM vs light DOM

| Aspect | Shadow (default) | Light (`static renderMode = 'light'`) |
| --- | --- | --- |
| Query own elements | `this.template.querySelector` | `this.querySelector` |
| Access host element | `this.template.host` semantics via `:host` in CSS | `this` is the host element |
| Style scoping | Automatic | None unless the stylesheet is scoped (`*.scoped.css`) |
| Event retargeting | Yes | No - listeners see the original target |
| Third-party libraries needing global DOM access | Blocked | Works |
| `lwc:dom="manual"` | Allowed | Compile error (LWC1088) |
| Slot event listeners | Allowed | Invalid (LWC1139) |

## 9. Lightning Web Security constraints

LWS is enabled by default for orgs created in Winter '23 and later and has been GA for LWC and Aura
since Summer '23; Lightning Locker was the prior architecture.

| Feature | Lightning Locker | Lightning Web Security |
| --- | --- | --- |
| JavaScript strict mode | Enforced | Enforced |
| DOM containment | Component can only access elements it created; `shadowRoot` properties not modifiable | Browser shadow DOM; `shadowRoot` appears closed from outside the namespace sandbox |
| Secure wrappers | Wraps `window`, `document`, `element` | No wrappers; uses distortions on unsafe APIs |
| Custom elements / third-party web components | Blocked | Allowed within the namespace |
| `eval()` | Limited to global scope | Allowed but distorted |
| `Blob` MIME types | Allow-list | Same list, but the MIME type must be specified on construction |
| Arrays passed to children | Proxied (performance cost) | Not filtered |
| Cross-namespace imports | Restricted | Allowed; namespaces are isolated sandboxes |
| Lightning Out | Requires Locker | Not supported under LWS |

Practical consequences: `JSON.parse(JSON.stringify(x))` cloning tricks written for Locker are
unnecessary; iframe content access and `postMessage` origin checks behave normally under LWS.
Disable LWS in a scratch org only for reproduction work, via the scratch org definition file
(see skill `sf-scratch-orgs-sandboxes`).

## 10. Performance and accessibility checklist

| Rule | Rationale |
| --- | --- |
| Prefer `@wire` over imperative Apex for reads | Client-side LDS/Apex cache serves repeats without a round trip |
| Mark read-only Apex `cacheable=true` | Otherwise every render costs a server call |
| Return narrow DTOs from Apex, not whole SObject graphs | Payload size dominates render time |
| Lazy-load heavy children behind `lwc:if` | Avoids constructing components the user never opens |
| Guard `renderedCallback()` work with a boolean | The hook runs on every render |
| Use `key` values that are stable business ids | Prevents full list re-creation on every update |
| Debounce `oninput`-driven wire configs | Each keystroke otherwise re-provisions the adapter |
| Remove `console.*` before merging | `vf-check lint` flags it; console output leaks data |
| Every interactive element has a label (`label`, `alternative-text`, `aria-label`) | Screen-reader access; `vf-check jest` can assert with `@sa11y/jest` |
| `lightning-spinner` requires `alternative-text` | Announced busy state |
| Do not remove focus outlines in CSS | Keyboard navigation |
| Use `errorCallback()` on container components | One broken child should not blank the page |

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/create-lifecycle-hooks.html
- https://developer.salesforce.com/docs/platform/lwc/guide/create-lifecycle-hooks-rendered.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-salesforce-modules.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-ui-api-record.html
- https://lwc.dev/guide/javascript_reactive, https://lwc.dev/guide/reference, https://lwc.dev/guide/html_templates
- https://developer.salesforce.com/docs/platform/lightning-components-security/guide/lws-intro.html
- https://developer.salesforce.com/docs/platform/lightning-components-security/guide/get-started-compare-lws-locker.html
