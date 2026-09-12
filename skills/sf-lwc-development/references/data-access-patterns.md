# LWC Data Access Patterns

Decision matrix and complete code for every supported way an LWC reads and writes Salesforce data:
Lightning Data Service wire adapters, the GraphQL wire adapter, Apex wires, imperative Apex, and the
record-form base components.

## 1. Selection matrix

| Requirement | Mechanism | Server round trip | Respects FLS/sharing automatically | Refresh |
| --- | --- | --- | --- | --- |
| One record, fixed field list | `@wire(getRecord, {recordId, fields})` | Cached by LDS | Yes | LDS, or `notifyRecordUpdateAvailable` |
| One record, optional fields that may be inaccessible | `@wire(getRecord, {recordId, optionalFields})` | Cached by LDS | Yes | Same |
| Several records by id | `@wire(getRecords, {records:[...]})` | Cached by LDS | Yes | Same |
| Object metadata, record types, child relationships | `@wire(getObjectInfo, {objectApiName})` | Cached by LDS | Yes | n/a |
| Picklist values for a record type | `@wire(getPicklistValues, {recordTypeId, fieldApiName})` | Cached by LDS | Yes | n/a |
| Related list records | `@wire(getRelatedListRecords, {...})` | Cached by LDS | Yes | LDS |
| Multi-object read, filtered, paginated, no Apex | `@wire(graphql, {query, variables})` | Cached by LDS | Yes | `refreshGraphQL(this.graphqlResult)` |
| Aggregate query, complex logic, callout-derived data | `@wire(apexMethod)` with `cacheable=true` | Cached client-side | Only if Apex enforces it | `refreshApex(this.wiredResult)` |
| The same but triggered by a user gesture | imperative call to a `cacheable=true` method | Cached client-side | Same | Call again with new args |
| Create/update/delete one record with no extra logic | `createRecord` / `updateRecord` / `deleteRecord` | Yes | Yes | LDS updates dependent wires |
| Write with validation, multi-object DML, callouts | imperative Apex, method **not** cacheable | Yes | Only if Apex enforces it | `notifyRecordUpdateAvailable` |
| Whole form, minimal JS | `lightning-record-form` / `lightning-record-edit-form` | Yes | Yes | `onsuccess` |

Hard constraints:

- `@wire` only accepts adapters. An Apex method is a valid adapter only when it is `static`,
  `public` or `global`, and annotated `@AuraEnabled(cacheable=true)`.
- A `cacheable=true` method must not perform DML and must not make callouts that mutate state.
- `@wire` configuration is evaluated eagerly; use `'$field'` syntax to make it reactive, and return
  `undefined` from a getter-backed config to keep the adapter from firing before inputs are ready.

## 2. LDS record read

```javascript
// accountSummary.js
import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue, getFieldDisplayValue } from 'lightning/uiRecordApi';
import NAME_FIELD from '@salesforce/schema/Account.Name';
import REVENUE_FIELD from '@salesforce/schema/Account.AnnualRevenue';
import OWNER_NAME_FIELD from '@salesforce/schema/Account.Owner.Name';

const FIELDS = [NAME_FIELD, OWNER_NAME_FIELD];
const OPTIONAL_FIELDS = [REVENUE_FIELD];

export default class AccountSummary extends LightningElement {
    @api recordId;

    @wire(getRecord, { recordId: '$recordId', fields: FIELDS, optionalFields: OPTIONAL_FIELDS })
    account;

    get name() {
        return getFieldValue(this.account.data, NAME_FIELD);
    }
    get revenue() {
        // display value applies the running user's locale and currency formatting
        return getFieldDisplayValue(this.account.data, REVENUE_FIELD);
    }
    get errorMessage() {
        return this.account.error ? reduceErrors(this.account.error).join(', ') : undefined;
    }
}
```

Use `fields` for values the component cannot work without (an inaccessible field makes the whole
wire error) and `optionalFields` for values that may be hidden by FLS.

## 3. Object info and picklists

```javascript
import { LightningElement, wire } from 'lwc';
import { getObjectInfo, getPicklistValues } from 'lightning/uiObjectInfoApi';
import CASE_OBJECT from '@salesforce/schema/Case';
import STATUS_FIELD from '@salesforce/schema/Case.Status';

export default class CaseStatusPicker extends LightningElement {
    @wire(getObjectInfo, { objectApiName: CASE_OBJECT })
    caseInfo;

    @wire(getPicklistValues, {
        recordTypeId: '$caseInfo.data.defaultRecordTypeId',
        fieldApiName: STATUS_FIELD
    })
    statusValues;

    get options() {
        return this.statusValues.data?.values ?? [];   // [{label, value, validFor, attributes}]
    }
}
```

Chained wires are the supported way to resolve `defaultRecordTypeId` before requesting picklists.

## 4. GraphQL wire adapter

```javascript
import { LightningElement, wire } from 'lwc';
import { gql, graphql, refreshGraphQL } from 'lightning/uiGraphQLApi';

export default class TopAccounts extends LightningElement {
    graphqlResult;
    accounts = [];
    errors;

    @wire(graphql, {
        query: gql`
            query topAccounts($rating: String!) {
                uiapi {
                    query {
                        Account(
                            where: { Rating: { eq: $rating } }
                            orderBy: { AnnualRevenue: { order: DESC } }
                            first: 10
                        ) {
                            edges {
                                node {
                                    Id
                                    Name { value }
                                    AnnualRevenue { value displayValue }
                                }
                            }
                        }
                    }
                }
            }
        `,
        variables: '$variables'
    })
    wiredGraphQL(result) {
        this.graphqlResult = result;
        const { data, errors } = result;
        this.errors = errors;
        this.accounts = data?.uiapi?.query?.Account?.edges?.map((e) => ({
            id: e.node.Id,
            name: e.node.Name.value,
            revenue: e.node.AnnualRevenue.displayValue
        })) ?? [];
    }

    get variables() {
        return { rating: 'Hot' };   // recompute from reactive fields to re-provision
    }

    async refresh() {
        await refreshGraphQL(this.graphqlResult);
    }
}
```

GraphQL removes Apex from read-only multi-object screens: fewer classes to test, no Apex coverage
obligation. It is subject to the same FLS and sharing rules as the UI API.

## 5. Apex wire vs imperative Apex

API version 67.0 and later: Apex runs in user context by default (object permissions and FLS
enforced), a class with no sharing declaration behaves as `with sharing`, and
`WITH SECURITY_ENFORCED` is no longer allowed in an Apex SOQL `SELECT`. Write `WITH USER_MODE`,
`AccessLevel.USER_MODE`, and `insert/update/delete as user`; declare sharing explicitly anyway for
readability. Older official samples that still show `WITH SECURITY_ENFORCED` predate this boundary
and must not be copied. See skill `sf-apex-development`.

```apex
// CaseQueueController.cls - see skill sf-apex-development for the Apex-side rules
public with sharing class CaseQueueController {
    @AuraEnabled(cacheable=true)
    public static List<CaseDto> getQueue(Id ownerId, Integer maxRows) {
        List<CaseDto> result = new List<CaseDto>();
        for (Case c : [
            SELECT Id, CaseNumber, Subject, Priority, Status
            FROM Case
            WHERE OwnerId = :ownerId AND IsClosed = false
            WITH USER_MODE
            ORDER BY Priority, CreatedDate
            LIMIT :maxRows
        ]) {
            result.add(new CaseDto(c));
        }
        return result;
    }

    @AuraEnabled
    public static Id escalate(Id caseId, String reason) {
        Case c = [SELECT Id, Priority FROM Case WHERE Id = :caseId WITH USER_MODE LIMIT 1];
        c.Priority = 'High';
        c.Description = reason;
        update as user c;
        return c.Id;
    }
}
```

```javascript
import { LightningElement, api, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import getQueue from '@salesforce/apex/CaseQueueController.getQueue';
import escalate from '@salesforce/apex/CaseQueueController.escalate';

export default class CaseQueue extends LightningElement {
    @api ownerId;
    maxRows = 25;
    wiredQueue;
    rows = [];
    error;

    @wire(getQueue, { ownerId: '$ownerId', maxRows: '$maxRows' })
    handleQueue(result) {
        this.wiredQueue = result;                   // store the provisioned value, not result.data
        this.rows = result.data ?? [];
        this.error = result.error ? reduceErrors(result.error).join(', ') : undefined;
    }

    async handleEscalate(event) {
        const caseId = event.detail.recordId;
        try {
            await escalate({ caseId, reason: 'SLA breach' });   // named params match Apex signature
            await notifyRecordUpdateAvailable([{ recordId: caseId }]);
            await refreshApex(this.wiredQueue);
        } catch (error) {
            this.error = reduceErrors(error).join(', ');
        }
    }
}
```

Key details:

- Imperative Apex arguments are passed as a **single object** whose keys match the Apex parameter
  names exactly.
- `refreshApex(value)` requires the object the Apex wire service provisioned: the field decorated by
  `@wire`, or the argument a wired function received.
- `refreshApex` only refreshes Apex wires. LDS wires are refreshed by `notifyRecordUpdateAvailable`.
- Cached `cacheable=true` results are served from the client cache; after an out-of-band write the
  cache is stale until you refresh.

## 6. Writing with Lightning Data Service

```javascript
import { LightningElement, api } from 'lwc';
import { createRecord, updateRecord, deleteRecord } from 'lightning/uiRecordApi';
import CONTACT_OBJECT from '@salesforce/schema/Contact';
import ID_FIELD from '@salesforce/schema/Contact.Id';
import LAST_NAME from '@salesforce/schema/Contact.LastName';
import ACCOUNT_ID from '@salesforce/schema/Contact.AccountId';

export default class ContactEditor extends LightningElement {
    @api recordId;
    @api accountId;

    async create(lastName) {
        const fields = {
            [LAST_NAME.fieldApiName]: lastName,
            [ACCOUNT_ID.fieldApiName]: this.accountId
        };
        const recordInput = { apiName: CONTACT_OBJECT.objectApiName, fields };
        const contact = await createRecord(recordInput);
        return contact.id;
    }

    async rename(newLastName) {
        const fields = { [ID_FIELD.fieldApiName]: this.recordId, [LAST_NAME.fieldApiName]: newLastName };
        await updateRecord({ fields });          // update takes { fields }, no apiName
    }

    async remove() {
        await deleteRecord(this.recordId);       // delete takes the bare id
    }
}
```

| Function | Input shape |
| --- | --- |
| `createRecord(recordInput)` | `{ apiName, fields }` |
| `updateRecord(recordInput, clientOptions?)` | `{ fields: { Id, ... } }` |
| `deleteRecord(recordId)` | id string |
| `generateRecordInputForCreate(record, objectInfo)` | Builds a creatable-fields-only input from a `getRecordCreateDefaults` record |
| `generateRecordInputForUpdate(record, objectInfo)` | Builds an updatable-fields-only input |
| `createRecordInputFilteredByEditedFields(recordInput, originalRecord)` | Trims unchanged fields before update |

LDS write functions return promises and automatically update every wire that holds the record.

## 7. Keeping LDS in sync after Apex writes

```javascript
import { notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';

async handler() {
    await apexUpdateRecord(this.recordId);
    // Notify LDS that the record changed outside its mechanisms; await the returned Promise so the
    // spinner only stops once dependent wires have been refreshed.
    await notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
}
```

`notifyRecordUpdateAvailable(items)` takes an array of `{recordId}` (15 or 18 characters) and
resolves when LDS has updated all affected wire adapters. `getRecordNotifyChange(items)` is the
deprecated predecessor: it is synchronous, returns `void`, and must be replaced in new code.

## 8. Record form components

```html
<!-- zero-JS create/edit form, uses the object's compact/full layout -->
<lightning-record-form
    record-id={recordId}
    object-api-name="Contact"
    layout-type="Full"
    mode="edit"
    onsuccess={handleSuccess}
    onerror={handleError}>
</lightning-record-form>

<!-- custom arrangement, still FLS and validation aware -->
<lightning-record-edit-form
    record-id={recordId}
    object-api-name="Case"
    onsubmit={handleSubmit}
    onsuccess={handleSuccess}
    onerror={handleError}>
    <lightning-messages></lightning-messages>
    <lightning-input-field field-name="Subject"></lightning-input-field>
    <lightning-input-field field-name="Priority"></lightning-input-field>
    <lightning-button type="submit" label="Save" variant="brand"></lightning-button>
</lightning-record-edit-form>
```

```javascript
handleSubmit(event) {
    event.preventDefault();                       // intercept to adjust values
    const fields = { ...event.detail.fields, Origin: 'Web' };
    this.refs.form.submit(fields);                // form has lwc:ref="form"
}
handleSuccess(event) {
    const recordId = event.detail.id;             // onsuccess detail carries the saved record
}
handleError(event) {
    // event.detail: { message, detail, output: { errors: [], fieldErrors: {} } }
}
```

Prefer these over hand-rolled forms: they honour field-level security, layout assignment, dependent
picklists, and record types without any JavaScript.

## 9. Error shapes and a reducer

| Source | Shape |
| --- | --- |
| `AuraHandledException` from imperative Apex | `{ body: { message: 'text' }, status: 400, statusText: 'Bad Request' }` |
| Unhandled Apex exception | `{ body: { message, exceptionType, stackTrace }, ... }` |
| LDS wire error | `{ body: [{ errorCode, message }], ok: false, status: 404, statusText: 'NOT_FOUND' }` |
| LDS DML error (`createRecord`/`updateRecord`) | `{ body: { message, output: { errors: [{message}], fieldErrors: { Field: [{message}] } } } }` |
| `lightning-record-edit-form` `onerror` | `event.detail = { message, detail, output: { errors, fieldErrors } }` |
| Page-level validation from Apex DML | `{ body: { pageErrors: [{ message }], fieldErrors: {} } }` |

```javascript
// ldsUtils.js - shared error reducer (one copy per project, imported by every component)
export function reduceErrors(errors) {
    if (!Array.isArray(errors)) {
        errors = [errors];
    }
    return errors
        .filter((error) => !!error)
        .map((error) => {
            if (Array.isArray(error.body)) {
                return error.body.map((e) => e.message);            // LDS wire error list
            }
            if (error.body?.output) {
                const messages = [];
                if (Array.isArray(error.body.output.errors)) {
                    messages.push(...error.body.output.errors.map((e) => e.message));
                }
                Object.values(error.body.output.fieldErrors ?? {}).forEach((fieldErrors) => {
                    messages.push(...fieldErrors.map((e) => e.message));
                });
                if (messages.length) {
                    return messages;
                }
            }
            if (Array.isArray(error.body?.pageErrors)) {
                const messages = error.body.pageErrors.map((e) => e.message);
                if (messages.length) {
                    return messages;
                }
            }
            if (typeof error.body?.message === 'string') {
                return error.body.message;                          // AuraHandledException
            }
            if (typeof error.message === 'string') {
                return error.message;                               // plain JS error
            }
            return error.statusText ?? 'Unknown error';
        })
        .reduce((flat, next) => flat.concat(next), [])
        .filter((message) => !!message);
}
```

## 10. Caching behaviour

| Layer | What is cached | Invalidated by |
| --- | --- | --- |
| LDS record cache | Records fetched by `getRecord`/`getRecords`/forms | LDS writes, `notifyRecordUpdateAvailable`, server push |
| LDS metadata cache | `getObjectInfo`, `getPicklistValues` | Metadata changes, page reload |
| Apex client cache | Results of `cacheable=true` methods, keyed by method + arguments | `refreshApex`, page reload, cache expiry |
| No cache | Non-cacheable `@AuraEnabled` calls | n/a |

Consequences for tests and verification: a stale-looking UI after a write almost always means a
missing `refreshApex` or `notifyRecordUpdateAvailable`. Prove the refresh path in Jest by emitting
new wire data after the imperative mock resolves (skill `sf-lwc-jest-testing`), and in the org with
`vf-check smoke` (skill `sf-post-deploy-verification`).

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/apex-wire-method.html
- https://developer.salesforce.com/docs/platform/lwc/guide/apex-call-imperative.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-salesforce-modules.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-notify-record-update.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-get-record-notify.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-create-record.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-ui-api-record.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-wire-service-about.html
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_security_sharing_chapter.htm (API 67.0 user-mode default, WITH SECURITY_ENFORCED removal)
