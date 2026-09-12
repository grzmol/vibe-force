# LWC Events and Messaging

Every supported communication path between Lightning web components, plus the Lightning Message
Service setup required for cross-DOM communication with Aura, Visualforce, and utility-bar items.

## 1. Choose the channel

| Direction | Mechanism | Notes |
| --- | --- | --- |
| Parent to child | Public property (`@api prop`) | Declarative, reactive, testable |
| Parent to child, imperative | Public method (`@api method()`) called via `this.refs.child.method()` | Use only for focus/reset/imperative refresh |
| Child to parent | `CustomEvent` with defaults (`bubbles: false, composed: false`) | Handled with `on<event>` on the child tag |
| Grandchild to ancestor | `CustomEvent` with `bubbles: true` (keep `composed: false` if the ancestor is in the same shadow tree) | Prefer re-dispatching at each level for explicit contracts |
| Sibling / unrelated subtree (same Lightning page) | Lightning Message Service | Replaces every home-grown `pubsub.js` |
| LWC to Aura | LMS, or Aura component events when the LWC is nested inside Aura | LMS is the maintained path |
| LWC to Visualforce in the same Lightning page | LMS | Visualforce uses `sforce.one.subscribe` / `publish` |
| LWC to Open CTI softphone | LMS | Open CTI exposes LMS methods |
| Component to platform (UI action) | `ShowToastEvent`, `CloseActionScreenEvent`, `RefreshEvent`, `NavigationMixin` | Platform-provided events |
| Server to component | `lightning/empApi` (platform events / CDC) | See skill `sf-integration-patterns` |

## 2. CustomEvent propagation matrix

| `bubbles` | `composed` | Travels | Use for |
| --- | --- | --- | --- |
| `false` | `false` (defaults) | Only to listeners on the dispatching element | Child-to-parent - the default and correct choice |
| `true` | `false` | Up through the containing shadow tree, stops at the shadow boundary | Deeply nested markup inside one component |
| `true` | `true` | Up through every shadow boundary to `document` | Genuinely application-wide signals only |
| `false` | `true` | Crosses the boundary but does not bubble | Rarely useful |

```javascript
// child/paginator.js
handleNext() {
    this.dispatchEvent(new CustomEvent('pagechange', {
        detail: { page: this.page + 1 }        // primitives only: detail is not deeply cloned
    }));
}
```

```html
<!-- parent/list.html -->
<c-paginator page={page} onpagechange={handlePageChange}></c-paginator>
```

```javascript
handlePageChange(event) {
    this.page = event.detail.page;             // parent owns the state
}
```

Rules:

- Event names are lowercase, no hyphens, no `on` prefix; the template handler is `on` + name.
- Do not put object references in `detail` when the event crosses a component boundary: the
  receiver can mutate your internal state. Pass ids and primitives, or a defensive copy.
- Do not use `stopPropagation()` to compensate for `bubbles: true`; stop setting `bubbles`.
- Never call `event.preventDefault()` on a `CustomEvent` unless it was created with
  `cancelable: true` and you check `dispatchEvent`'s return value.

## 3. Parent to child patterns

```html
<!-- declarative: preferred -->
<c-address-form
    record-id={recordId}
    readonly={isReadOnly}
    onsave={handleSave}>
</c-address-form>
```

```javascript
// imperative: only for focus/reset/refresh
<c-address-form lwc:ref="form"></c-address-form>
// ...
resetForm() {
    this.refs.form.reset();      // reset() is @api on the child
}
```

Attribute-to-property mapping is kebab-case in markup, camelCase in JavaScript
(`record-id` maps to `recordId`). Reserved names such as `class`, `slot`, `style`, `key`, and
`is` cannot be `@api` property names.

## 4. Lightning Message Service

### 4.1 Channel metadata

`force-app/main/default/messageChannels/Record_Selected.messageChannel-meta.xml`:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<LightningMessageChannel xmlns="http://soap.sforce.com/2006/04/metadata">
    <masterLabel>RecordSelected</masterLabel>
    <isExposed>true</isExposed>
    <description>Message Channel to pass a record Id</description>
    <lightningMessageFields>
        <fieldName>recordId</fieldName>
        <description>This is the record Id that changed</description>
    </lightningMessageFields>
</LightningMessageChannel>
```

`isExposed=true` makes the channel usable outside its own namespace - only set it for channels that
are a deliberate public API of a package. `lightningMessageFields` documents the payload; it does
not enforce it at runtime.

### 4.2 Publisher

```javascript
import { LightningElement, wire } from 'lwc';
import { publish, MessageContext } from 'lightning/messageService';
import RECORD_SELECTED_CHANNEL from '@salesforce/messageChannel/Record_Selected__c';

export default class ContactList extends LightningElement {
    @wire(MessageContext) messageContext;

    handleSelect(event) {
        publish(this.messageContext, RECORD_SELECTED_CHANNEL, {
            recordId: event.currentTarget.dataset.id      // serializable JSON only
        });
    }
}
```

### 4.3 Subscriber

```javascript
import { LightningElement, wire } from 'lwc';
import {
    subscribe,
    unsubscribe,
    APPLICATION_SCOPE,
    MessageContext
} from 'lightning/messageService';
import RECORD_SELECTED_CHANNEL from '@salesforce/messageChannel/Record_Selected__c';

export default class ContactDetail extends LightningElement {
    recordId;
    subscription = null;

    @wire(MessageContext) messageContext;

    connectedCallback() {
        if (this.subscription) {
            return;
        }
        this.subscription = subscribe(
            this.messageContext,
            RECORD_SELECTED_CHANNEL,
            (message) => { this.recordId = message.recordId; },
            { scope: APPLICATION_SCOPE }
        );
    }

    disconnectedCallback() {
        unsubscribe(this.subscription);
        this.subscription = null;
    }
}
```

API surface:

| Function | Signature | Notes |
| --- | --- | --- |
| `publish` | `publish(messageContext, messageChannel, message)` | `message` must be serializable JSON - no functions, no symbols |
| `subscribe` | `subscribe(messageContext, messageChannel, listener, subscriberOptions?)` | Returns a subscription object |
| `unsubscribe` | `unsubscribe(subscription)` | Call in `disconnectedCallback()` |
| `MessageContext` | Wire adapter | Automatically unregisters subscriptions when the component is destroyed |
| `createMessageContext` / `releaseMessageContext` | For service components that do not extend `LightningElement` | You must release manually |
| `APPLICATION_SCOPE` | `{ scope: APPLICATION_SCOPE }` | Without it, messages are limited to the active navigation tab, item, or utility item; utility items are always active |

Default scope covers standard navigation tabs, console workspace tabs, console subtabs, console
navigation items, and utility items. Use `APPLICATION_SCOPE` when a utility-bar component must hear
messages from any tab.

### 4.4 Service component (no LightningElement)

```javascript
// messageBridge.js - a plain module used by several components
import { createMessageContext, releaseMessageContext, subscribe } from 'lightning/messageService';
import CHANNEL from '@salesforce/messageChannel/Record_Selected__c';

let context;
let subscription;

export function start(listener) {
    context = createMessageContext();
    subscription = subscribe(context, CHANNEL, listener);
}

export function stop() {
    releaseMessageContext(context);   // required: releases every subscription made with this context
    context = undefined;
    subscription = undefined;
}
```

## 5. Platform events raised by components

| Event | Import | Payload / effect |
| --- | --- | --- |
| `ShowToastEvent` | `lightning/platformShowToastEvent` | `{ title, message, variant: 'info'\|'success'\|'warning'\|'error', mode: 'dismissible'\|'pester'\|'sticky', messageData }` |
| `CloseActionScreenEvent` | `lightning/actions` | Closes a screen quick action modal |
| `RefreshEvent` | `lightning/refresh` | Requests a refresh of the surrounding container |
| `NavigationMixin.Navigate` | `lightning/navigation` | Navigates to a page reference |
| `NavigationMixin.GenerateUrl` | `lightning/navigation` | Resolves a URL string for a page reference |

```javascript
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

this.dispatchEvent(new ShowToastEvent({
    title: 'Record updated',
    message: 'Open {0} to review.',
    messageData: [{ url: this.recordUrl, label: 'the case' }],   // {n} placeholders become links
    variant: 'success',
    mode: 'dismissible'
}));
```

Toasts are unavailable in some containers (for example Experience Cloud LWR sites); provide inline
feedback as a fallback rather than relying on the toast alone.

## 6. Navigation page reference types

```javascript
import { NavigationMixin } from 'lightning/navigation';

export default class Nav extends NavigationMixin(LightningElement) {
    toRecord(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId, objectApiName: 'Case', actionName: 'view' }
        });
    }
    toNew() {
        this[NavigationMixin.Navigate]({
            type: 'standard__objectPage',
            attributes: { objectApiName: 'Account', actionName: 'new' }
        });
    }
    toListView() {
        this[NavigationMixin.Navigate]({
            type: 'standard__objectPage',
            attributes: { objectApiName: 'Contact', actionName: 'list' },
            state: { filterName: 'Recent' }
        });
    }
    toRelatedList(recordId) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordRelationshipPage',
            attributes: { recordId, objectApiName: 'Case', relationshipApiName: 'CaseComments', actionName: 'view' }
        });
    }
    toTab() {
        this[NavigationMixin.Navigate]({ type: 'standard__navItemPage', attributes: { apiName: 'CustomTabName' } });
    }
    toExternal() {
        this[NavigationMixin.Navigate](
            { type: 'standard__webPage', attributes: { url: 'https://example.com' } },
            true   // replace the current entry in browser history
        );
    }
    async copyLink(recordId) {
        const url = await this[NavigationMixin.GenerateUrl]({
            type: 'standard__recordPage',
            attributes: { recordId, actionName: 'view' }
        });
        return url;
    }
}
```

| Page reference type | Key attributes |
| --- | --- |
| `standard__recordPage` | `recordId`, `objectApiName` (optional), `actionName`: `view` / `edit` / `clone` |
| `standard__objectPage` | `objectApiName`, `actionName`: `home` / `list` / `new`; `state.filterName` for list views |
| `standard__recordRelationshipPage` | `recordId`, `objectApiName`, `relationshipApiName`, `actionName: 'view'` |
| `standard__navItemPage` | `apiName` (custom tab; managed packages use `ns__TabName`) |
| `standard__webPage` | `url` |
| `standard__component` | `componentName: 'c__myComponent'` (requires `lightning__UrlAddressable`) |
| `standard__app` | `appTarget` |
| `standard__namedPage` | `pageName`: `home`, `chatter`, `dataAssessment`, `filePreview`, `today` |
| `comm__namedPage` | Experience Cloud site pages |

Read the incoming page state with the `CurrentPageReference` wire adapter:

```javascript
import { CurrentPageReference } from 'lightning/navigation';

@wire(CurrentPageReference)
pageRef;                          // pageRef.state.c__filter for custom URL params
```

## 7. Aura and Visualforce interop

| Source | Target | Path |
| --- | --- | --- |
| LWC nested in Aura | Aura parent | `CustomEvent` - the Aura parent handles it with `on<event>` in its markup |
| Aura parent | LWC child | Set public attributes, or call `@api` methods via `component.find('cmp').method()` |
| LWC and Visualforce in the same Lightning page | Both ways | LMS: Visualforce calls `sforce.one.subscribe(channel, callback)` / `sforce.one.publish(channel, payload)` after loading `lightning/messageService` via `$Lightning`-free `sforce.one` |
| LWC and Open CTI softphone | Both ways | LMS methods documented in the Open CTI Developer Guide |

LMS is available in Lightning Experience and in Experience Builder sites. It is not available in the
Salesforce mobile app's classic containers or in standalone Visualforce pages outside a Lightning
page.

## 8. Anti-patterns

| Anti-pattern | Consequence | Fix |
| --- | --- | --- |
| Custom `pubsub.js` module | Does not cross DOM trees, leaks subscriptions, untestable across containers | LMS with `MessageContext` |
| `subscribe()` without a matching `unsubscribe()` | Duplicate handlers after navigation; memory leak | `unsubscribe` in `disconnectedCallback()` and null the field |
| Subscribing in `renderedCallback()` | Re-subscribes on every render | Subscribe in `connectedCallback()` with an idempotence guard |
| `bubbles: true, composed: true` for a parent handler | Any component on the page can intercept the event | Default event options |
| Passing a mutable object in `event.detail` | Receiver mutates publisher state silently | Pass ids/primitives or a copy |
| Publishing a non-serializable payload over LMS | Runtime failure - messages cannot contain functions or symbols | Plain JSON |
| `document.addEventListener` for cross-component talk | Global listener, no cleanup, blocked patterns under Lightning Web Security | LMS |
| Reaching into `child.shadowRoot` from a parent | Breaks encapsulation, fails at runtime | `@api` method or event |

## Verification

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" jest --files "force-app/main/default/lwc/**"
sf project deploy start --source-dir force-app/main/default/messageChannels --target-org vf-dev
```

Jest assertions for events and LMS (dispatched-event spies, `publish` mock, `MessageContext` test
adapter) are in skill `sf-lwc-jest-testing`, `references/mocking-cookbook.md`.

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/events-create-dispatch.html
- https://developer.salesforce.com/docs/platform/lwc/guide/events-handling.html
- https://developer.salesforce.com/docs/platform/lwc/guide/use-message-channel.html
- https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-message-service
- https://developer.salesforce.com/docs/platform/lwc/guide/use-navigate-page-types.html
- https://developer.salesforce.com/docs/platform/lwr/references/csr-reference/navigationmixin
- https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-platform-show-toast-event
- https://github.com/trailheadapps/lwc-recipes/blob/main/force-app/main/default/messageChannels/Record_Selected.messageChannel-meta.xml
