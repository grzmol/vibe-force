# LWC Jest Mocking Cookbook

Every mock an LWC test needs, with the exact module path, the factory to use, and the assertion it
enables. All snippets are drawn from the Salesforce testing documentation and the `lwc-recipes`
mock implementations.

## 0. Which tool for which module

| Module under test | Tool | Why |
| --- | --- | --- |
| `@salesforce/apex/Cls.method` used imperatively | `jest.mock(path, () => ({ default: jest.fn() }), { virtual: true })` | You control resolve/reject |
| `@salesforce/apex/Cls.method` used with `@wire` | `createApexTestWireAdapter(jest.fn())` inside the same virtual mock | Adapter must provision data |
| `lightning/uiRecordApi` wires | `createLdsTestWireAdapter(jest.fn())` in a `moduleNameMapper` mock | LDS `{data, error}` shape |
| `lightning/uiRecordApi` imperative writes | `jest.fn().mockResolvedValue({})` | Promise-returning functions |
| `CurrentPageReference`, `MessageContext` | `createTestWireAdapter(jest.fn())` | Raw value emission |
| `lightning/navigation` `NavigationMixin` | Hand-written mixin mock with `jest.fn()` spies | Symbols cannot be spied otherwise |
| `lightning/messageService` | Handler-registry mock | Lets publish actually reach subscribers |
| `lightning/platformShowToastEvent` | Default stub is enough; listen for `ShowToastEventName` | Event assertion |
| `@salesforce/label/*`, `@salesforce/i18n/*`, `@salesforce/user/*` | `jest.mock(path, () => ({ default: value }), { virtual: true })` | Scoped modules are synthetic |
| `lightning-*` base components | Built-in stubs | Already installed by `sfdx-lwc-jest` |
| `fetch` / third-party libraries | `global.fetch = jest.fn()` / `jest.mock('module')` | jsdom has no network |

## 1. Imperative Apex

```javascript
import getContactList from '@salesforce/apex/ContactController.getContactList';

jest.mock(
    '@salesforce/apex/ContactController.getContactList',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

const APEX_CONTACTS = require('./data/getContactList.json');

beforeEach(() => {
    getContactList.mockResolvedValue(APEX_CONTACTS);
});

afterEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    jest.clearAllMocks();
});

it('passes the search term to Apex', async () => {
    const element = createElement('c-contact-search', { is: ContactSearch });
    document.body.appendChild(element);

    const input = element.shadowRoot.querySelector('lightning-input');
    input.value = 'Amy';
    input.dispatchEvent(new CustomEvent('change'));

    await Promise.resolve();
    await Promise.resolve();

    expect(getContactList).toHaveBeenCalledWith({ searchKey: 'Amy' });
});
```

Rejection path:

```javascript
const APEX_ERROR = {
    body: { message: 'An internal server error has occurred' },
    ok: false,
    status: 400,
    statusText: 'Bad Request'
};
getContactList.mockRejectedValue(APEX_ERROR);
```

## 2. Apex wire adapter

```javascript
import getContactList from '@salesforce/apex/ContactController.getContactList';

jest.mock(
    '@salesforce/apex/ContactController.getContactList',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

it('renders rows when the wire provisions data', async () => {
    const element = createElement('c-contact-list', { is: ContactList });
    document.body.appendChild(element);

    getContactList.emit(APEX_CONTACTS);
    await Promise.resolve();

    expect(element.shadowRoot.querySelectorAll('p')).toHaveLength(APEX_CONTACTS.length);
});

it('renders the error panel when the wire errors', async () => {
    const element = createElement('c-contact-list', { is: ContactList });
    document.body.appendChild(element);

    getContactList.error();                 // default: 400 Bad Request
    await Promise.resolve();

    expect(element.shadowRoot.querySelector('c-error-panel')).not.toBeNull();
});

it('re-provisions when the reactive parameter changes', async () => {
    const element = createElement('c-contact-list', { is: ContactList });
    element.accountId = '001xx1';
    document.body.appendChild(element);
    await Promise.resolve();

    expect(getContactList.getLastConfig()).toEqual({ accountId: '001xx1' });

    element.accountId = '001xx2';
    await Promise.resolve();

    expect(getContactList.getLastConfig()).toEqual({ accountId: '001xx2' });
});
```

Adapter API (identical across the three factories unless noted):

| Method | Signature | Notes |
| --- | --- | --- |
| `emit` | `emit(value, filterFn?)` | `filterFn(config)` targets one adapter instance when a component wires the same adapter twice |
| `error` | `error(body?, status?, statusText?)` | LDS default `404 NOT_FOUND`; Apex default `400 Bad Request`; not available on the generic adapter |
| `emitError` | `emitError({ body, status, statusText }, filterFn?)` | Same as `error` with a filter |
| `getLastConfig` | `getLastConfig()` | Last resolved wire configuration - the way to assert `'$field'` reactivity |

## 3. Lightning Data Service

`force-app/test/jest-mocks/lightning/uiRecordApi.js`:

```javascript
import { createLdsTestWireAdapter } from '@salesforce/wire-service-jest-util';

export const getRecord = createLdsTestWireAdapter(jest.fn());
export const getRecords = createLdsTestWireAdapter(jest.fn());
export const getRecordCreateDefaults = createLdsTestWireAdapter(jest.fn());
export const getRecordUi = createLdsTestWireAdapter(jest.fn());

export const createRecord = jest.fn().mockResolvedValue({});
export const updateRecord = jest.fn().mockResolvedValue({});
export const deleteRecord = jest.fn().mockResolvedValue();
export const notifyRecordUpdateAvailable = jest.fn().mockResolvedValue();
export const generateRecordInputForCreate = jest.fn();
export const generateRecordInputForUpdate = jest.fn();
export const createRecordInputFilteredByEditedFields = jest.fn();

export const getFieldValue = jest.fn((record, field) => {
    const name = typeof field === 'string' ? field : `${field.objectApiName}.${field.fieldApiName}`;
    const path = name.substring(name.indexOf('.') + 1).split('.');
    let cursor = record;
    while (path.length > 0 && cursor && cursor.fields) {
        const next = cursor.fields[path.shift()];
        if (next === undefined) return undefined;
        cursor = next.value;
    }
    return cursor;
});

export const getFieldDisplayValue = jest.fn((record, field) => {
    const name = typeof field === 'string' ? field : `${field.objectApiName}.${field.fieldApiName}`;
    const path = name.substring(name.indexOf('.') + 1).split('.');
    let cursor = record;
    while (cursor && cursor.fields) {
        const key = path.shift();
        const next = cursor.fields[key];
        if (next === undefined) return undefined;
        if (path.length > 0) {
            cursor = next.value;
        } else {
            return next.displayValue;
        }
    }
    return cursor;
});
```

Register it in `jest.config.js` under `'^lightning/uiRecordApi$'`. Tests then do:

```javascript
import { getRecord, updateRecord, notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';

getRecord.emit(require('./data/getRecord.json'));
expect(updateRecord).toHaveBeenCalledWith({ fields: { Id: '001xx1', Name: 'Acme 2' } });
expect(notifyRecordUpdateAvailable).toHaveBeenCalledWith([{ recordId: '001xx1' }]);
```

`getObjectInfo`, `getPicklistValues`, and `graphql` are mocked the same way with
`createLdsTestWireAdapter` in `lightning/uiObjectInfoApi` and `lightning/uiGraphQLApi` mock files.

## 4. `refreshApex`

```javascript
import { refreshApex } from '@salesforce/apex';

jest.mock(
    '@salesforce/apex',
    () => ({ refreshApex: jest.fn(() => Promise.resolve()) }),
    { virtual: true }
);

it('refreshes the wired list after a successful save', async () => {
    // ... trigger the save
    await Promise.resolve();
    expect(refreshApex).toHaveBeenCalled();
});
```

If the project also mocks `@salesforce/apex` through `moduleNameMapper` (for `getSObjectValue`),
add `refreshApex` to that mock file instead of declaring a second virtual mock.

## 5. Navigation

`force-app/test/jest-mocks/lightning/navigation.js`:

```javascript
import { createTestWireAdapter } from '@salesforce/wire-service-jest-util';

export const CurrentPageReference = createTestWireAdapter(jest.fn());

const Navigate = Symbol('Navigate');
const GenerateUrl = Symbol('GenerateUrl');

export const mockNavigate = jest.fn();
export const mockGenerate = jest.fn();

export const NavigationMixin = (Base) =>
    class extends Base {
        [Navigate](pageReference, replace) {
            mockNavigate({ pageReference, replace });
        }
        [GenerateUrl](pageReference) {
            mockGenerate({ pageReference });
            return Promise.resolve('https://www.example.com');
        }
    };
NavigationMixin.Navigate = Navigate;
NavigationMixin.GenerateUrl = GenerateUrl;

export const getNavigateCalledWith = () =>
    mockNavigate.mock.calls.length === 0
        ? { pageReference: undefined, replace: undefined }
        : mockNavigate.mock.lastCall[0];

export const getGenerateUrlCalledWith = () =>
    mockGenerate.mock.calls.length === 0 ? { pageReference: undefined } : mockGenerate.mock.lastCall[0];
```

```javascript
import { getNavigateCalledWith, CurrentPageReference } from 'lightning/navigation';

it('navigates to the record page', async () => {
    const element = createElement('c-nav-button', { is: NavButton });
    element.recordId = '001xx1';
    document.body.appendChild(element);

    element.shadowRoot.querySelector('lightning-button').click();
    await Promise.resolve();

    const { pageReference } = getNavigateCalledWith();
    expect(pageReference.type).toBe('standard__recordPage');
    expect(pageReference.attributes.recordId).toBe('001xx1');
    expect(pageReference.attributes.actionName).toBe('view');
});

it('reads URL state', async () => {
    const element = createElement('c-filtered-list', { is: FilteredList });
    document.body.appendChild(element);

    CurrentPageReference.emit({ state: { c__filter: 'open' } });
    await Promise.resolve();

    expect(element.shadowRoot.querySelector('.filter').textContent).toBe('open');
});
```

## 6. Lightning Message Service

`force-app/test/jest-mocks/lightning/messageService.js` (registry mock: `publish` actually invokes
subscribers, so a publisher and a subscriber can be tested together):

```javascript
export const APPLICATION_SCOPE = Symbol('APPLICATION_SCOPE');
export const createMessageChannel = jest.fn();
export const createMessageContext = jest.fn();
export const MessageContext = jest.fn();
export const releaseMessageContext = jest.fn();

let mockSubscriptionId = 0;
const handlers = {};

export const publish = jest.fn((messageContext, messageChannel, message) => {
    handlers[messageChannel]?.forEach((entry) => entry.handler(message));
});

export const subscribe = jest.fn((messageContext, messageChannel, messageHandler) => {
    const id = mockSubscriptionId++;
    if (!handlers[messageChannel]) handlers[messageChannel] = [];
    handlers[messageChannel].push({ id, handler: messageHandler });
    return { id };
});

export const unsubscribe = jest.fn((subscription) => {
    Object.keys(handlers).forEach((channel) => {
        handlers[channel] = handlers[channel].filter((entry) => entry.id !== subscription.id);
    });
});
```

```javascript
import { publish, subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import RECORD_SELECTED from '@salesforce/messageChannel/Record_Selected__c';

it('publishes the selected record id', async () => {
    const element = createElement('c-lms-publisher', { is: LmsPublisher });
    document.body.appendChild(element);

    element.shadowRoot.querySelector('[data-id="003xx1"]').click();
    await Promise.resolve();

    expect(publish).toHaveBeenCalledWith(undefined, RECORD_SELECTED, { recordId: '003xx1' });
});

it('renders the record id received on the channel', async () => {
    const element = createElement('c-lms-subscriber', { is: LmsSubscriber });
    document.body.appendChild(element);

    const handler = subscribe.mock.calls[0][2];   // the listener the component registered
    handler({ recordId: '003xx9' });
    await Promise.resolve();

    expect(element.shadowRoot.querySelector('.selected').textContent).toBe('003xx9');
});

it('unsubscribes on disconnect', () => {
    const element = createElement('c-lms-subscriber', { is: LmsSubscriber });
    document.body.appendChild(element);
    document.body.removeChild(element);
    expect(unsubscribe).toHaveBeenCalled();
});
```

Message channel imports (`@salesforce/messageChannel/*`) resolve to opaque objects under
`sfdx-lwc-jest`; compare by identity, never by shape.

## 7. Toasts

The default stub dispatches a real `CustomEvent` named `lightning__showtoast`, exported as
`ShowToastEventName`:

```javascript
import { ShowToastEventName } from 'lightning/platformShowToastEvent';

it('shows a success toast', async () => {
    const element = createElement('c-saver', { is: Saver });
    document.body.appendChild(element);

    const handler = jest.fn();
    element.addEventListener(ShowToastEventName, handler);

    element.shadowRoot.querySelector('lightning-button').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].detail.variant).toBe('success');
    expect(handler.mock.calls[0][0].detail.title).toBe('Saved');
});
```

## 8. Modals, alerts, confirms, and quick actions

```javascript
import LightningConfirm from 'lightning/confirm';

jest.mock('lightning/confirm', () => ({ __esModule: true, default: { open: jest.fn() } }), {
    virtual: true
});

it('deletes only when the user confirms', async () => {
    LightningConfirm.open.mockResolvedValue(true);
    // ... click delete, flush, assert deleteRecord called
});
```

`lightning/actions` (`CloseActionScreenEvent`) and `lightning/modal` mocks follow the same shape as
the toast mock: export an event class or a class with a `jest.fn()` `open` method.

## 9. Scoped modules: labels, i18n, user, permissions, schema

```javascript
jest.mock('@salesforce/label/c.Escalate_Case', () => ({ default: 'Escalate' }), { virtual: true });
jest.mock('@salesforce/i18n/lang', () => ({ default: 'de' }), { virtual: true });
jest.mock('@salesforce/user/Id', () => ({ default: '005xx000001Sv6d' }), { virtual: true });
jest.mock('@salesforce/userPermission/ViewSetup', () => ({ default: true }), { virtual: true });
```

`@salesforce/schema/*` imports resolve to `{ objectApiName, fieldApiName }` objects automatically;
mock them only if a helper needs `getSObjectValue`:

```javascript
// force-app/test/jest-mocks/apex.js
export const getSObjectValue = (object, field) => object[field.fieldApiName];
```

## 10. `fetch`, static resources, and third-party libraries

```javascript
// network
global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ total: 3 }) })
);
afterEach(() => { global.fetch.mockClear(); });

// resource loader: resolve immediately so renderedCallback can continue
jest.mock('lightning/platformResourceLoader', () => ({
    loadScript: jest.fn(() => Promise.resolve()),
    loadStyle: jest.fn(() => Promise.resolve())
}), { virtual: true });

jest.mock('@salesforce/resourceUrl/chartjs', () => ({ default: '/resource/chartjs' }), { virtual: true });
```

Components that draw to a canvas need `jest-canvas-mock` in `setupFiles`.

## 11. Mock hygiene

| Rule | Reason |
| --- | --- |
| `jest.clearAllMocks()` in `afterEach` | Call counts and `lastCall` leak between tests otherwise |
| Set `mockResolvedValue` in `beforeEach`, not at module scope | Each test starts from a known state |
| Prefer fixture JSON under `__tests__/data/` over inline literals | Realistic payload shapes catch field-path bugs |
| Never assert on the stub internals of `lightning-*` components | Stubs are inert by design |
| One virtual mock per Apex method, declared at the top of the file | `jest.mock` is hoisted; declaring it inside a test does not work |
| Do not mock the component under test | Test the real class |

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-create-tests.html
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-patterns.html
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-wire-utility.html
- https://github.com/salesforce/wire-service-jest-util (adapter API reference)
- https://github.com/salesforce/sfdx-lwc-jest (base component stubs, module mapping)
- https://github.com/trailheadapps/lwc-recipes/tree/main/force-app/test/jest-mocks (navigation, messageService, uiRecordApi, platformShowToastEvent, refresh, apex mocks)
