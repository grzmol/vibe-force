# LWC Jest Test Recipes

Eleven complete suites for the component shapes this harness produces. Each recipe states the
component contract it assumes, then the test file.

## 0. Shared preamble

Every recipe below starts from this preamble. It is shown in full once; later recipes include only
the lines that differ (imports, mocks, and the `describe` block).

```javascript
import { createElement } from 'lwc';

// Cleanup that every LWC test file needs: the jsdom instance is shared across test cases
// in a single file, so the DOM and the mock state must be reset between them.
afterEach(() => {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
});

// One microtask turn. Chained promises need one call per turn.
async function flushPromises() {
    return Promise.resolve();
}
```

Projects that use `import { createElement } from '@lwc/engine-dom';` (the current sample-app style)
substitute that import; everything else is identical.

## 1. Presentational component with public properties

Contract: `c-status-badge` exposes `@api status`, renders a label and a variant class.

```javascript
import StatusBadge from 'c/statusBadge';

describe('c-status-badge', () => {
    it('renders the label for a known status', () => {
        const element = createElement('c-status-badge', { is: StatusBadge });
        element.status = 'Escalated';
        document.body.appendChild(element);

        const badge = element.shadowRoot.querySelector('.badge');
        expect(badge.textContent).toBe('Escalated');
        expect(badge.className).toContain('badge_error');
    });

    it('falls back to Unknown for an unrecognized status', () => {
        const element = createElement('c-status-badge', { is: StatusBadge });
        element.status = 'Zzz';
        document.body.appendChild(element);

        expect(element.shadowRoot.querySelector('.badge').textContent).toBe('Unknown');
    });

    it('rerenders when the property changes after insertion', async () => {
        const element = createElement('c-status-badge', { is: StatusBadge });
        element.status = 'New';
        document.body.appendChild(element);

        element.status = 'Closed';
        await flushPromises();

        expect(element.shadowRoot.querySelector('.badge').textContent).toBe('Closed');
    });
});
```

## 2. Conditional rendering: loading, data, empty, error

Contract: `c-case-panel` wires an Apex method and renders a spinner, a list, an empty state, or an
error panel.

```javascript
import CasePanel from 'c/casePanel';
import getCases from '@salesforce/apex/CaseController.getCases';

jest.mock(
    '@salesforce/apex/CaseController.getCases',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

const CASES = [
    { Id: '500xx1', CaseNumber: '00001', Subject: 'Broken widget' },
    { Id: '500xx2', CaseNumber: '00002', Subject: 'Late shipment' }
];

describe('c-case-panel', () => {
    it('renders one row per case', async () => {
        const element = createElement('c-case-panel', { is: CasePanel });
        document.body.appendChild(element);

        getCases.emit(CASES);
        await flushPromises();

        const rows = element.shadowRoot.querySelectorAll('[data-id]');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('00001');
        expect(element.shadowRoot.querySelector('lightning-spinner')).toBeNull();
    });

    it('renders the empty state for zero cases', async () => {
        const element = createElement('c-case-panel', { is: CasePanel });
        document.body.appendChild(element);

        getCases.emit([]);
        await flushPromises();

        expect(element.shadowRoot.querySelector('.empty').textContent).toBe('No open cases.');
    });

    it('renders the error panel and no rows on wire error', async () => {
        const element = createElement('c-case-panel', { is: CasePanel });
        document.body.appendChild(element);

        getCases.emitError({
            body: { message: 'Insufficient access' },
            status: 403,
            statusText: 'Forbidden'
        });
        await flushPromises();

        expect(element.shadowRoot.querySelector('c-error-panel')).not.toBeNull();
        expect(element.shadowRoot.querySelectorAll('[data-id]')).toHaveLength(0);
    });
});
```

## 3. Imperative Apex triggered by a click

Contract: `c-escalate-button` calls `escalate({caseId, reason})`, notifies LDS, then toasts.

```javascript
import EscalateButton from 'c/escalateButton';
import escalate from '@salesforce/apex/CaseEscalationService.escalate';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { ShowToastEventName } from 'lightning/platformShowToastEvent';

jest.mock('@salesforce/apex/CaseEscalationService.escalate', () => ({ default: jest.fn() }), {
    virtual: true
});

describe('c-escalate-button', () => {
    function build() {
        const element = createElement('c-escalate-button', { is: EscalateButton });
        element.recordId = '500xx1';
        document.body.appendChild(element);
        return element;
    }

    async function settle() {
        await flushPromises();
        await flushPromises();
    }

    it('calls Apex with the record id and notifies LDS', async () => {
        escalate.mockResolvedValue('500xx1');
        const element = build();

        element.shadowRoot.querySelector('lightning-button').click();
        await settle();

        expect(escalate).toHaveBeenCalledWith({ caseId: '500xx1', reason: 'SLA breach' });
        expect(notifyRecordUpdateAvailable).toHaveBeenCalledWith([{ recordId: '500xx1' }]);
    });

    it('fires an error toast and skips the LDS notification when Apex rejects', async () => {
        escalate.mockRejectedValue({ body: { message: 'Escalation blocked' } });
        const element = build();
        const handler = jest.fn();
        element.addEventListener(ShowToastEventName, handler);

        element.shadowRoot.querySelector('lightning-button').click();
        await settle();

        expect(handler.mock.calls[0][0].detail.variant).toBe('error');
        expect(handler.mock.calls[0][0].detail.message).toBe('Escalation blocked');
        expect(notifyRecordUpdateAvailable).not.toHaveBeenCalled();
    });
});
```

## 4. `getRecord` wire with `getFieldValue`

Contract: `c-account-header` wires `getRecord` for `Account.Name` and `Account.Rating`.

```javascript
import AccountHeader from 'c/accountHeader';
import { getRecord } from 'lightning/uiRecordApi';

const RECORD = require('./data/getRecord.json');

describe('c-account-header', () => {
    it('requests the record id it was given', async () => {
        const element = createElement('c-account-header', { is: AccountHeader });
        element.recordId = '001xx000003DGg0AAG';
        document.body.appendChild(element);
        await flushPromises();

        expect(getRecord.getLastConfig().recordId).toBe('001xx000003DGg0AAG');
    });

    it('renders the account name', async () => {
        const element = createElement('c-account-header', { is: AccountHeader });
        element.recordId = '001xx000003DGg0AAG';
        document.body.appendChild(element);

        getRecord.emit(RECORD);
        await flushPromises();

        expect(element.shadowRoot.querySelector('h1').textContent).toBe(RECORD.fields.Name.value);
    });
});
```

Fixture `__tests__/data/getRecord.json`:

```json
{
    "apiName": "Account",
    "id": "001xx000003DGg0AAG",
    "fields": {
        "Name": { "displayValue": null, "value": "Acme" },
        "Rating": { "displayValue": "Hot", "value": "Hot" }
    }
}
```

## 5. Child component dispatching an event

Contract: `c-row-selector` renders `@api rows` and dispatches `rowselect` with `{ recordId }`.

```javascript
import RowSelector from 'c/rowSelector';

const ROWS = [{ id: '003xx1', name: 'Amy' }, { id: '003xx2', name: 'Bo' }];

describe('c-row-selector', () => {
    it('dispatches rowselect with the clicked id', async () => {
        const element = createElement('c-row-selector', { is: RowSelector });
        element.rows = ROWS;
        document.body.appendChild(element);

        const handler = jest.fn();
        element.addEventListener('rowselect', handler);

        element.shadowRoot.querySelector('[data-id="003xx2"]').click();
        await flushPromises();

        expect(handler).toHaveBeenCalledTimes(1);
        const event = handler.mock.calls[0][0];
        expect(event.detail).toEqual({ recordId: '003xx2' });
        expect(event.bubbles).toBe(false);
        expect(event.composed).toBe(false);
    });
});
```

## 6. Parent handling a child event

Contract: `c-contact-browser` composes `c-row-selector` and shows a detail panel.

```javascript
import ContactBrowser from 'c/contactBrowser';

describe('c-contact-browser', () => {
    it('shows the detail panel for the selected row', async () => {
        const element = createElement('c-contact-browser', { is: ContactBrowser });
        document.body.appendChild(element);

        const selector = element.shadowRoot.querySelector('c-row-selector');
        selector.dispatchEvent(new CustomEvent('rowselect', { detail: { recordId: '003xx2' } }));
        await flushPromises();

        const detail = element.shadowRoot.querySelector('c-contact-detail');
        expect(detail).not.toBeNull();
        expect(detail.recordId).toBe('003xx2');
    });
});
```

Dispatching on the child element is the supported way to simulate a child; never reach into
`selector.shadowRoot`.

## 7. Form built on `lightning-record-edit-form`

Contract: `c-quick-case` injects `Origin` into the submit payload and toasts on success.

```javascript
import QuickCase from 'c/quickCase';
import { ShowToastEventName } from 'lightning/platformShowToastEvent';

describe('c-quick-case', () => {
    it('injects Origin before submitting', async () => {
        const element = createElement('c-quick-case', { is: QuickCase });
        document.body.appendChild(element);

        const form = element.shadowRoot.querySelector('lightning-record-edit-form');
        form.submit = jest.fn();
        form.dispatchEvent(
            new CustomEvent('submit', { detail: { fields: { Subject: 'Printer down' } } })
        );
        await flushPromises();

        expect(form.submit).toHaveBeenCalledWith({ Subject: 'Printer down', Origin: 'Web' });
    });

    it('toasts on success', async () => {
        const element = createElement('c-quick-case', { is: QuickCase });
        document.body.appendChild(element);
        const handler = jest.fn();
        element.addEventListener(ShowToastEventName, handler);

        element.shadowRoot
            .querySelector('lightning-record-edit-form')
            .dispatchEvent(new CustomEvent('success', { detail: { id: '500xx9' } }));
        await flushPromises();

        expect(handler.mock.calls[0][0].detail.variant).toBe('success');
    });
});
```

## 8. Navigation

Requires the `lightning/navigation` mock from `references/mocking-cookbook.md`.

```javascript
import OpenRecordButton from 'c/openRecordButton';
import { getNavigateCalledWith } from 'lightning/navigation';

describe('c-open-record-button', () => {
    it('navigates to the record view page', async () => {
        const element = createElement('c-open-record-button', { is: OpenRecordButton });
        element.recordId = '500xx1';
        element.objectApiName = 'Case';
        document.body.appendChild(element);

        element.shadowRoot.querySelector('lightning-button').click();
        await flushPromises();

        const { pageReference } = getNavigateCalledWith();
        expect(pageReference).toEqual({
            type: 'standard__recordPage',
            attributes: { recordId: '500xx1', objectApiName: 'Case', actionName: 'view' }
        });
    });
});
```

## 9. Lightning Message Service publisher and subscriber

Requires the registry-style `lightning/messageService` mock, which makes `publish` reach real
subscribers.

```javascript
import Publisher from 'c/lmsPublisher';
import Subscriber from 'c/lmsSubscriber';
import { publish, unsubscribe } from 'lightning/messageService';
import RECORD_SELECTED from '@salesforce/messageChannel/Record_Selected__c';

describe('record selection over LMS', () => {
    it('publishes the selected id', async () => {
        const element = createElement('c-lms-publisher', { is: Publisher });
        document.body.appendChild(element);

        element.shadowRoot.querySelector('[data-id="003xx1"]').click();
        await flushPromises();

        expect(publish).toHaveBeenCalledWith(undefined, RECORD_SELECTED, { recordId: '003xx1' });
    });

    it('renders what a publisher sends', async () => {
        const subscriber = createElement('c-lms-subscriber', { is: Subscriber });
        document.body.appendChild(subscriber);
        const publisher = createElement('c-lms-publisher', { is: Publisher });
        document.body.appendChild(publisher);

        publisher.shadowRoot.querySelector('[data-id="003xx1"]').click();
        await flushPromises();

        expect(subscriber.shadowRoot.querySelector('.selected').textContent).toBe('003xx1');
    });

    it('unsubscribes when removed from the DOM', () => {
        const subscriber = createElement('c-lms-subscriber', { is: Subscriber });
        document.body.appendChild(subscriber);
        document.body.removeChild(subscriber);

        expect(unsubscribe).toHaveBeenCalled();
    });
});
```

## 10. Timers and cleanup

Contract: `c-polling-counter` polls Apex on an interval and clears it in `disconnectedCallback()`.

```javascript
import PollingCounter from 'c/pollingCounter';
import getCount from '@salesforce/apex/CounterController.getCount';

jest.mock('@salesforce/apex/CounterController.getCount', () => ({ default: jest.fn() }), {
    virtual: true
});

describe('c-polling-counter', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        getCount.mockResolvedValue(7);
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it('polls once per interval', async () => {
        const element = createElement('c-polling-counter', { is: PollingCounter });
        document.body.appendChild(element);

        jest.advanceTimersByTime(30000);
        await flushPromises();
        jest.advanceTimersByTime(30000);
        await flushPromises();

        expect(getCount).toHaveBeenCalledTimes(2);
    });

    it('stops polling after disconnect', async () => {
        const element = createElement('c-polling-counter', { is: PollingCounter });
        document.body.appendChild(element);
        jest.advanceTimersByTime(30000);
        await flushPromises();
        document.body.removeChild(element);

        jest.advanceTimersByTime(120000);
        await flushPromises();

        expect(getCount).toHaveBeenCalledTimes(1);
    });
});
```

## 11. Light DOM component and accessibility

Contract: `c-light-panel` sets `static renderMode = 'light'`.

```javascript
import LightPanel from 'c/lightPanel';

describe('c-light-panel', () => {
    it('renders into the light DOM', () => {
        const element = createElement('c-light-panel', { is: LightPanel });
        document.body.appendChild(element);

        expect(element.shadowRoot).toBeNull();
        expect(element.querySelector('.panel')).not.toBeNull();
    });

    it('has no accessibility violations', async () => {
        const element = createElement('c-light-panel', { is: LightPanel });
        document.body.appendChild(element);
        await flushPromises();

        await expect(element).toBeAccessible();   // requires the @sa11y/jest setup file
    });
});
```

## Coverage checklist per component shape

| Component shape | Minimum test set |
| --- | --- |
| Presentational | Default render, each variant branch, property change rerender |
| Wire-backed | Config assertion, data render, empty render, error render |
| Imperative Apex | Argument assertion, success render, rejection render |
| Event emitter | Event name, `detail`, propagation flags |
| Event consumer | Reaction to a dispatched child event |
| Form | Submit payload mutation, success handler, error handler |
| Navigation | Page reference shape |
| LMS | Publish payload, subscribe reaction, unsubscribe on disconnect |
| Timer-driven | Tick behaviour and cleanup after removal |
| Light DOM | Absence of `shadowRoot`, light-DOM query |

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" jest --changed` before handing the
slice to wave 3.

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-create-tests.html
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-wire-utility.html
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-jest-patterns.html
- https://github.com/salesforce/wire-service-jest-util
- https://github.com/trailheadapps/lwc-recipes/blob/main/force-app/main/default/lwc/apexWireMethodToProperty/__tests__/apexWireMethodToProperty.test.js
- https://github.com/trailheadapps/lwc-recipes/tree/main/force-app/test/jest-mocks
