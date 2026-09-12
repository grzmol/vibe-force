# Base Components and Lightning Data Service First

Rung 4 of the ladder in `SKILL.md`, UI half. The documented Salesforce order of preference is:
base components built on Lightning Data Service, then LDS wire adapters, then the GraphQL wire
adapter, then Apex ([Data Guidelines](https://developer.salesforce.com/docs/platform/lwc/guide/data-guidelines.html)).
This file records what each shipped component already does, where the escape hatches are, and the
exact point at which a custom component becomes justified.

## Why the base component wins by default

Lightning Data Service caches records and shares them across components on the page, loads data
progressively, deduplicates and bulkifies server calls, invalidates cache entries when the
underlying data changes, consumes no API calls, and respects CRUD access, field-level security,
and sharing because it is built on User Interface API
([Lightning Data Service](https://developer.salesforce.com/docs/platform/lwc/guide/data-ui-api.html)).

Apex has none of that for free: "Apex doesn't share a data cache or data store with LDS", and
Apex-provisioned data is not managed - you refresh it yourself with `refreshApex()` or
`notifyRecordUpdateAvailable()`
([Data Guidelines](https://developer.salesforce.com/docs/platform/lwc/guide/data-guidelines.html)).

| Capability | `lightning-record-*-form` / LDS wire adapter | Custom LWC + `@AuraEnabled` Apex |
| --- | --- | --- |
| FLS and sharing enforcement | Handled by the component/UI API | You write and test it (`WITH USER_MODE`, `Security.stripInaccessible`) |
| Validation rule errors surfaced | Automatic, with `lightning-messages` | You parse `DmlException` and render it |
| Field labels, help text, localisation | From field metadata | You hard-code or fetch it |
| Record type aware picklists | `record-type-id` attribute | You query and filter |
| Shared client cache, auto refresh | Yes | No - manual refresh |
| API call consumption | None (LDS) | Apex call per invocation |
| Tests you must write | None for the platform behaviour | Apex tests plus Jest tests |

## Component catalogue

| Need | Component | Out of the box | Documented boundary |
| --- | --- | --- | --- |
| Create/view/edit a record, least effort | `lightning-record-form` | Auto Cancel/Save buttons in edit forms, uses the object's default record layout with multi-column support, loads compact or full layout or only listed fields, switches view/edit automatically | No prepopulated values; no cross-object spanning fields; cannot nest inside other record forms; multiple currencies unsupported in edit mode |
| Custom form layout, prepopulated values | `lightning-record-edit-form` + `lightning-input-field` | LDS-backed create/update with no Apex, field-level validation, validation-rule errors, `onsubmit`/`onsuccess`/`onerror` hooks | Form element customisation for submission unsupported; nesting unsupported; `Id` always read-only; formula fields always read-only |
| Read-only record display | `lightning-record-view-form`, or `lightning-record-form` with `mode="readonly"` | Output fields, no buttons | Same object support constraints |
| Tabular data | `lightning-datatable` | Typed column formatting, infinite scrolling, inline edit for some types, header actions, header wrapping, row-level actions, column resize, row selection, sorting, text wrap/clip, row numbering, cell alignment, SLDS icons in cells, hideable header and borders | Not supported on mobile devices; custom CSS classes on cells unsupported (use a custom data type) |
| Hierarchical data | `lightning-tree-grid` | Nested rows via the `_children` key, `expanded-rows`, expand/collapse methods, row selection that does not cascade to nested rows | Same typed-column model as datatable |
| File attachment | `lightning-file-upload` | Multi-file upload, drag-and-drop, `accept` filter, association to a record via `record-id`, `uploadfinished` event returning name and `documentId` | Default 10 files at once (org range 1-25), max file size 10 GB; Experience Builder sites cap at 128 MB on `my.site.com` and 500 MB on a custom domain; guest uploads need an org preference plus guest sharing rules |
| Single field input | `lightning-input` | Native types, `required`, `pattern` with `message-when-pattern-mismatch`, `checkValidity()` / `reportValidity()` | Client-side validation is not a substitute for validation rules |
| Record metadata | `getObjectInfo` wire adapter | Object info including `defaultRecordTypeId` and record type IDs | - |
| Picklist values | `getPicklistValues` wire adapter | Values for a field and `recordTypeId` | Needs a record type ID; use `getObjectInfo.defaultRecordTypeId` |
| Related list | `getRelatedListRecords` wire adapter | Related list records via the UI API related-list resource | UI API object support applies |
| Simple record list | `getListUi` | List of field values, for example contact names | - |
| Multi-object / parent-child read | `graphql` wire adapter | One operation for multiple queries, parent and child relationships, filtering, ordering, pagination, mutations; returns only queried fields | LDS/UI API object support applies |
| One-record write from JS | `createRecord` / `updateRecord` / `deleteRecord` | LDS-managed writes that refresh dependent wires | Each call is an independent transaction - multi-record atomicity needs Apex |

Sources: [Record Form](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-form.html),
[Record Edit Form](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-edit-form.html),
[Datatable](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable.html),
[Tree Grid](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-tree-grid.html),
[File Upload](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-file-upload.html),
[getPicklistValues](https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-picklist-values.html),
[getRelatedListRecords](https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-get-related-list-records.html),
[Data Guidelines](https://developer.salesforce.com/docs/platform/lwc/guide/data-guidelines.html).

## Escape hatches before you fork

Use these before deciding the base component "cannot do it".

| Requirement | Escape hatch |
| --- | --- |
| Custom field order and grouping in a form | `lightning-record-edit-form` with `lightning-input-field` children in your own markup |
| Multi-column form | SLDS grid utility classes around the input fields |
| Read-only field inside an editable form | `lightning-output-field`, or plain HTML and `lightning-formatted-*` components |
| Prepopulated values | `value` attribute on `lightning-input-field`; reassign the property to change it later |
| Reset to initial values | `reset()` on each `lightning-input-field` |
| Conditional fields | `lwc:if` around the input fields |
| Label placement / density | `density` attribute (`comfy`, `compact`, `auto`); a `variant` on an individual field overrides the form density |
| Custom cell formatting in a datatable | `typeAttributes` for the underlying base component, `cellAttributes` for alignment, SLDS classes and icons |
| Icon instead of a column label | `iconName` + `hideLabel`, keeping `label` set for assistive technology |
| Column with no built-in type | Custom data type registered for the datatable, which also unlocks custom CSS |
| Fewer default header actions | `hideDefaultActions` per column, with `wrapText` set explicitly |
| Paging over large data | `enable-infinite-loading`, `onloadmore`, `load-more-offset`, container with a fixed height |
| Programmatic access to selection or scroll | `getSelectedRows()`, `scrollToTop()` via `lwc:ref` |
| Object not supported by UI API (for example Task or Event specifics) | Apex - this is the documented reason to leave LDS |

## When a custom component is justified

Justified only when one of these is true, and the reason is written into the decision log:

1. **The object is not supported by User Interface API** - documented as an Apex use case.
2. **The records must be selected by criteria** - "load the first 200 Accounts with Amount > $1M"
   is the documented example that UI API does not support.
3. **The operation must be transactional across records** - create an Account and its Opportunity
   atomically, rolling back both on failure.
4. **The interaction must be imperative** - triggered by a button or deliberately deferred out of
   the critical path.
5. **The UI is genuinely not a record form or a table** - a canvas, a chart, a wizard step that has
   no record shape. Wrapping a base component in a component of your own is not this case.

Everything else - "the designer wants different spacing", "we need a save button in another place",
"the table should look different" - is handled by the escape hatches above.

## Side by side: a contact form

### Base component version (complete)

`contactQuickEdit.html`

```html
<template>
    <lightning-card title="Contact">
        <lightning-record-edit-form
            object-api-name="Contact"
            record-id={recordId}
            onsuccess={handleSuccess}
            onerror={handleError}
        >
            <lightning-messages></lightning-messages>
            <div class="slds-grid slds-gutters slds-wrap">
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input-field field-name="FirstName"></lightning-input-field>
                    <lightning-input-field field-name="LastName" required></lightning-input-field>
                </div>
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input-field field-name="Email"></lightning-input-field>
                    <lightning-input-field field-name="Phone"></lightning-input-field>
                </div>
            </div>
            <div class="slds-m-top_small">
                <lightning-button type="submit" variant="brand" label="Save"></lightning-button>
            </div>
        </lightning-record-edit-form>
    </lightning-card>
</template>
```

`contactQuickEdit.js`

```javascript
import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class ContactQuickEdit extends LightningElement {
    @api recordId;

    handleSuccess(event) {
        this.dispatchEvent(
            new ShowToastEvent({
                title: 'Saved',
                message: `Contact ${event.detail.id} updated`,
                variant: 'success'
            })
        );
    }

    handleError(event) {
        // lightning-messages already renders the message; this is only for telemetry or logging.
        console.error(event.detail.message, event.detail.output);
    }
}
```

Server code: none. Tests: the Jest test asserts the toast, not the platform's save behaviour.
FLS, sharing, field labels, help text, validation-rule errors, and the record-type-aware picklists
are all handled by the component.

### Custom version (what you are choosing to own)

```html
<template>
    <lightning-input label="First Name" value={contact.FirstName} onchange={handleChange}
        data-field="FirstName"></lightning-input>
    <lightning-input label="Last Name" value={contact.LastName} required onchange={handleChange}
        data-field="LastName"></lightning-input>
    <lightning-input label="Email" type="email" value={contact.Email} onchange={handleChange}
        data-field="Email"></lightning-input>
    <lightning-button label="Save" onclick={handleSave}></lightning-button>
    <template lwc:if={errorMessage}>
        <p class="slds-text-color_error">{errorMessage}</p>
    </template>
</template>
```

```javascript
import { LightningElement, api, wire } from 'lwc';
import getContact from '@salesforce/apex/ContactController.getContact';
import saveContact from '@salesforce/apex/ContactController.saveContact';
import { refreshApex } from '@salesforce/apex';

export default class ContactCustomEdit extends LightningElement {
    @api recordId;
    contact = {};
    errorMessage;
    wiredResult;

    @wire(getContact, { contactId: '$recordId' })
    handleWire(result) {
        this.wiredResult = result;
        if (result.data) {
            this.contact = { ...result.data };
        }
    }

    handleChange(event) {
        this.contact = { ...this.contact, [event.target.dataset.field]: event.target.value };
    }

    async handleSave() {
        this.errorMessage = undefined;
        try {
            await saveContact({ contact: this.contact });
            await refreshApex(this.wiredResult);
        } catch (error) {
            this.errorMessage = error?.body?.message ?? 'Save failed';
        }
    }
}
```

```apex
public with sharing class ContactController {
    @AuraEnabled(cacheable=true)
    public static Contact getContact(Id contactId) {
        return [
            SELECT Id, FirstName, LastName, Email, Phone
            FROM Contact
            WHERE Id = :contactId
            WITH USER_MODE
            LIMIT 1
        ];
    }

    @AuraEnabled
    public static void saveContact(Contact contact) {
        // FLS on write must be enforced explicitly; the base component would have done this.
        SObjectAccessDecision decision = Security.stripInaccessible(
            AccessType.UPDATABLE,
            new List<Contact>{ contact }
        );
        update as user decision.getRecords();
    }
}
```

Additional cost of the custom version: two Apex methods, Apex tests for both, FLS enforcement code,
manual refresh handling, localisation of labels, validation-rule error parsing, and accessibility
review of the markup. All of it to reproduce behaviour the base component already ships. Note that
`WITH USER_MODE` and `update as user` are the API 67.0 enforcement forms;
`WITH SECURITY_ENFORCED` is not allowed in Apex SOQL at 67.0+.

## Side by side: a contact list

### Base component version

```html
<template>
    <lightning-datatable
        key-field="Id"
        data={contacts}
        columns={columns}
        sorted-by={sortedBy}
        sorted-direction={sortedDirection}
        onsort={handleSort}
        onrowaction={handleRowAction}
        hide-checkbox-column
    ></lightning-datatable>
</template>
```

```javascript
import { LightningElement, wire } from 'lwc';
import { gql, graphql } from 'lightning/uiGraphQLApi';

const COLUMNS = [
    { label: 'Name', fieldName: 'name', type: 'text', sortable: true },
    { label: 'Email', fieldName: 'email', type: 'email' },
    { label: 'Phone', fieldName: 'phone', type: 'phone' },
    {
        type: 'action',
        typeAttributes: { rowActions: [{ label: 'Open', name: 'open' }] }
    }
];

export default class ContactList extends LightningElement {
    columns = COLUMNS;
    contacts = [];
    sortedBy = 'name';
    sortedDirection = 'asc';

    @wire(graphql, {
        query: gql`
            query contacts {
                uiapi {
                    query {
                        Contact(first: 50, orderBy: { Name: { order: ASC } }) {
                            edges {
                                node {
                                    Id
                                    Name {
                                        value
                                    }
                                    Email {
                                        value
                                    }
                                    Phone {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `
    })
    handleContacts({ data, errors }) {
        if (errors) {
            this.contacts = [];
            return;
        }
        this.contacts = (data?.uiapi?.query?.Contact?.edges ?? []).map(({ node }) => ({
            Id: node.Id,
            name: node.Name?.value,
            email: node.Email?.value,
            phone: node.Phone?.value
        }));
    }

    handleSort(event) {
        this.sortedBy = event.detail.fieldName;
        this.sortedDirection = event.detail.sortDirection;
        const factor = this.sortedDirection === 'asc' ? 1 : -1;
        this.contacts = [...this.contacts].sort(
            (a, b) => factor * String(a[this.sortedBy] ?? '').localeCompare(String(b[this.sortedBy] ?? ''))
        );
    }

    handleRowAction(event) {
        if (event.detail.action.name === 'open') {
            this.dispatchEvent(new CustomEvent('open', { detail: event.detail.row.Id }));
        }
    }
}
```

No Apex. Typed column formatting, locale-aware phone and email rendering, header actions, and
selection semantics come from the component. The GraphQL wire adapter returns only the queried
fields and shares the LDS cache.

### What the hand-rolled table costs

| Feature the base component gives you | What you write instead |
| --- | --- |
| Typed columns with locale formatting | Per-type formatting code and tests |
| Sorting UI and events | Header markup, `aria-sort`, click handlers |
| Inline edit for supported types | Edit state machine, draft values, save path |
| Row selection and `getSelectedRows()` | Selection model, select-all semantics |
| Infinite scroll (`enable-infinite-loading`) | Scroll listeners, offset tracking, spinner |
| Header actions (wrap/clip text) | Menu markup and state |
| Accessibility of table semantics | Roles, labels, keyboard navigation |
| `scrollToTop()` | DOM measurement code |

If only one of those features is required, the base component is still smaller. If none of them is
required, the requirement is probably a list view or a related list - rung 3.

## Datatable quick reference

| Column property | Purpose |
| --- | --- |
| `fieldName` (required) | Binds the column to a key in the `data` array |
| `label` (required) | Header text; used for `aria-label` when `hideLabel` is set |
| `type` (required) | Data type driving formatting: `action`, `boolean`, `button`, `button-icon`, `currency`, `date`, `date-local`, `email`, `location`, `number`, `percent`, `phone`, `text`, `url` |
| `typeAttributes` | Attributes forwarded to the underlying base component, in camelCase (`currencyCode`, not `currency-code`) |
| `cellAttributes` | `alignment`, `class`, and `icon*` properties |
| `editable` | Enables inline editing for supported types |
| `sortable` | Enables the sort affordance for the column |
| `initialWidth` / `fixedWidth` | Width control; `fixedWidth` also disables resizing |
| `hideDefaultActions` | Removes the wrap/clip header actions |
| `wrapText` | Wraps content; pair with `wrap-text-max-lines` |
| `columnKey` | Unique key when two columns share a `fieldName` |

Salesforce date types map as `DateTime` to `date` and `Date` to `date-local`; passing a date into a
`text` column shows the raw string. Number, currency, and percent columns align right by default;
`action` columns align centre and cannot be overridden with `alignment`.

## Accessibility notes (floor item, not optional)

| Rule | Base component behaviour | Your obligation in a custom component |
| --- | --- | --- |
| Every control has a label | `lightning-input-field` derives the field label from metadata | Provide `label`, or `aria-label` where visually hidden |
| Icon-only headers remain announced | `label` still feeds `title`, `alternativeText`, and `aria-label` when `hideLabel` is set | Provide the equivalent text yourself |
| Error messages are associated with their field | `lightning-messages` plus field-level validation | Wire `aria-describedby` and live regions |
| Keyboard reachable actions | Base buttons and menus are focusable | Manage focus order and key handling |

Details and testing: skill `sf-lwc-development`; Jest assertions: skill `sf-lwc-jest-testing`.

## Verification

```bash
# Did this change add a component that duplicates a base component?
grep -rln "lightning-datatable\|lightning-record-edit-form\|lightning-record-form" force-app/main/default/lwc

# New @AuraEnabled read methods are a rung-4 smell: could a wire adapter have done it?
grep -rn "@AuraEnabled(cacheable=true)" force-app/main/default/classes

# Any @AuraEnabled method with no caller in JS is dead code
grep -rn "@salesforce/apex/" force-app/main/default/lwc | sed 's/.*apex\///' | sort -u

node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" local
```

Review question for every new component: which base component was tried, and which documented
boundary did it hit? If the answer is a styling preference, the component goes back to the escape
hatches.

## Sources

- [Data Guidelines](https://developer.salesforce.com/docs/platform/lwc/guide/data-guidelines.html) - the base component / wire adapter / GraphQL / Apex order, the four documented Apex use cases, refresh semantics, Apex-versus-LDS cache warning.
- [Lightning Data Service](https://developer.salesforce.com/docs/platform/lwc/guide/data-ui-api.html) - caching, dedupe, bulkification, CRUD/FLS/sharing enforcement, no API usage, custom metadata types unsupported.
- [lightning-record-form](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-form.html) - modes, `fields` versus `layout-type`, required-field rendering, spanning-field and prepopulation limits, density.
- [lightning-record-edit-form](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-edit-form.html) - LDS backing, FLS and sharing handling, validation-rule error behaviour, event order, `reset()`, recommendation to use validation rules over client-side validation.
- [lightning-datatable](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable.html) - feature list, mobile limitation, column properties, data types, infinite loading, header actions, custom data types for styling.
- [lightning-tree-grid](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-tree-grid.html) - `_children`, `expanded-rows`, selection behaviour.
- [lightning-file-upload](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-file-upload.html) - file count and size limits, Experience site caps, guest-user prerequisites, `uploadfinished`.
- [getPicklistValues](https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-picklist-values.html), [getRelatedListRecords](https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-get-related-list-records.html).
- [AuraEnabled Annotation](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation_AuraEnabled.htm) - `cacheable=true` is for read-only methods.
