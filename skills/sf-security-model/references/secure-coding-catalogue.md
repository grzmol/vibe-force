# Secure Coding Catalogue

One entry per vulnerability class: vulnerable code, fixed code, and the rule that detects it.
Sources: Secure Coding Guide
([SOQL Injection](https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_sql_injection.htm),
[XSS](https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_cross_site_scripting.htm),
[Open Redirect](https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_arbitrary_redirect.htm),
[Storing Sensitive Data](https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_storing_sensitive_data.htm),
[Lightning Security](https://developer.salesforce.com/docs/atlas.en-us.secure_coding_guide.meta/secure_coding_guide/secure_coding_lightning_security.htm)),
Apex Developer Guide [Dynamic SOQL](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_dynamic_soql.htm),
[PMD Apex security rules](https://pmd.github.io/pmd/pmd_rules_apex_security.html),
[Graph Engine rules](https://developer.salesforce.com/docs/platform/salesforce-code-analyzer/guide/rules-sfge.html).

## Index

| # | Class | Primary detecting rule |
| --- | --- | --- |
| 1 | SOQL injection (WHERE clause) | `pmd:ApexSOQLInjection` |
| 2 | SOQL injection (dynamic object/field names) | `pmd:ApexSOQLInjection` |
| 3 | CRUD/FLS bypass on read | `pmd:ApexCRUDViolation`, `sfge:ApexFlsViolation` |
| 4 | CRUD/FLS bypass on write | `pmd:ApexCRUDViolation`, `sfge:ApexFlsViolation` |
| 5 | Sharing bypass through `without sharing` | `pmd:ApexSharingViolations`, `sfge:DatabaseOperationsMustUseWithSharing` |
| 6 | Untrusted parameter selects the object | `pmd:ApexSOQLInjection` + review |
| 7 | XSS via `innerHTML` / `lwc:dom="manual"` | `eslint:@lwc/lwc/no-inner-html` |
| 8 | XSS in Visualforce unescaped output | `pmd:ApexXSSFromURLParam`, `pmd:ApexXSSFromEscapeFalse` |
| 9 | Open redirect | `pmd:ApexOpenRedirect` |
| 10 | CSRF via state change on GET | `pmd:ApexCSRF` |
| 11 | Hardcoded credentials / secrets | `pmd:ApexSuggestUsingNamedCred`, vibe-force hooks |
| 12 | Weak or hardcoded crypto material | `pmd:ApexBadCrypto` |
| 13 | Plain HTTP endpoint | `pmd:ApexInsecureEndpoint` |
| 14 | Hardcoded record Id | `pmd:AvoidHardcodingId` |
| 15 | Sensitive data in debug logs | review + hook policy |
| 16 | Inaccessible `@AuraEnabled` getter | `pmd:InaccessibleAuraEnabledGetter` |
| 17 | Over-privileged integration user | review + permission query |
| 18 | Vulnerable third-party JS in static resources | `retire-js` engine |

---

## 1. SOQL injection in the WHERE clause

Vulnerable:

```apex
public with sharing class PersonnelSearch {
    public static List<Personnel__c> byTitle(String userInputTitle) {
        String query = 'SELECT Name, Role__c, Title__c FROM Personnel__c'
            + ' WHERE Title__c LIKE \'%' + userInputTitle + '%\'';
        return Database.query(query);
    }
}
```

Input `'% OR Performance_rating__c < 2 OR Name LIKE '%` closes the wildcard and appends a filter the
developer never intended, returning rows outside the intended scope.

Fixed (bind variable, user mode):

```apex
public with sharing class PersonnelSearch {
    public static List<Personnel__c> byTitle(String userInputTitle) {
        String pattern = '%' + userInputTitle + '%';
        return [
            SELECT Name, Role__c, Title__c
            FROM Personnel__c
            WHERE Title__c LIKE :pattern
            WITH USER_MODE
            LIMIT 200
        ];
    }
}
```

Fixed (dynamic query that still needs string assembly):

```apex
Map<String, Object> binds = new Map<String, Object>{ 'pattern' => '%' + userInputTitle + '%' };
List<Personnel__c> rows = Database.queryWithBinds(
    'SELECT Name, Role__c, Title__c FROM Personnel__c WHERE Title__c LIKE :pattern',
    binds,
    AccessLevel.USER_MODE
);
```

`String.escapeSingleQuotes` is a fallback only, and only for values inside single quotes: it does
nothing for a boolean, number, or unquoted position, and it does not enforce access. The Secure
Coding Guide explicitly does not recommend it as the primary control.

## 2. SOQL injection through dynamic object or field names

Bind variables cannot parameterize object or field names. Allowlist, then verify accessibility.

```apex
public with sharing class DynamicReport {
    private static final Set<String> ALLOWED_OBJECTS = new Set<String>{
        'Account', 'Contact', 'Expense__c'
    };
    private static final Set<String> ALLOWED_FIELDS = new Set<String>{
        'Name', 'Phone', 'Amount__c'
    };

    public static List<SObject> run(String objectName, List<String> fields) {
        if (!ALLOWED_OBJECTS.contains(objectName)) {
            throw new AuraHandledException('Unsupported object.');
        }
        Schema.SObjectType sot = Schema.getGlobalDescribe().get(objectName);
        if (sot == null || !sot.getDescribe().isAccessible()) {
            throw new AuraHandledException('Unsupported object.');
        }
        Map<String, Schema.SObjectField> fieldMap = sot.getDescribe().fields.getMap();
        List<String> safeFields = new List<String>();
        for (String f : fields) {
            if (!ALLOWED_FIELDS.contains(f)) {
                throw new AuraHandledException('Unsupported field.');
            }
            Schema.SObjectField sof = fieldMap.get(f);
            if (sof == null || !sof.getDescribe().isAccessible()) {
                throw new AuraHandledException('Unsupported field.');
            }
            safeFields.add(f);
        }
        String query = 'SELECT ' + String.join(safeFields, ', ') + ' FROM ' + objectName + ' LIMIT 200';
        return Database.query(query, AccessLevel.USER_MODE);
    }
}
```

The allowlist blocks injection; the describe checks double as the CRUD/FLS control.

## 3. CRUD/FLS bypass on read

```apex
@AuraEnabled(cacheable=true)
public static List<Expense__c> getExpenses() {
    // Vulnerable: explicit elevation (also the pre-67.0 default with no clause at all)
    return [SELECT Id, Amount__c, Internal_Margin__c FROM Expense__c WITH SYSTEM_MODE];
}

@AuraEnabled(cacheable=true)
public static List<Expense__c> getExpensesSafely() {
    return [SELECT Id, Amount__c, Internal_Margin__c FROM Expense__c WITH USER_MODE LIMIT 500];
}
```

Graceful variant with `stripInaccessible`, plus the full matrix: `references/crud-fls-enforcement.md`.

## 4. CRUD/FLS bypass on write

```apex
@AuraEnabled
public static void closeWonUnsafe(Id opportunityId) {
    // Vulnerable at API 66.0 and earlier: statement DML defaulted to system mode
    update new Opportunity(Id = opportunityId, StageName = 'Closed Won');
}

@AuraEnabled
public static void closeWon(Id opportunityId) {
    Opportunity opp = new Opportunity(Id = opportunityId, StageName = 'Closed Won');
    try {
        update as user opp;
    } catch (DmlException e) {
        throw new AuraHandledException('You cannot update this opportunity stage.');
    }
}
```

Never return the raw `DmlException` message to a client: it can disclose field and object names.

## 5. Sharing bypass through `without sharing`

Vulnerable:

```apex
public without sharing class ProjectController {
    @AuraEnabled(cacheable=true)
    public static List<Project__c> all() {
        return [SELECT Id, Name, Status__c FROM Project__c WITH SYSTEM_MODE];
    }
}
```

An `@AuraEnabled` entry point in a `without sharing` class hands every record to any authenticated
user who can call the class.

Fixed:

```apex
public with sharing class ProjectController {
    @AuraEnabled(cacheable=true)
    public static List<Project__c> forCurrentUser() {
        return [SELECT Id, Name, Status__c FROM Project__c WITH USER_MODE LIMIT 500];
    }
}

// Elevation, if genuinely required, is isolated and documented
public without sharing class ProjectReferenceData {
    // Guest users must read the public project catalogue; no PII fields are selected.
    public static List<Project__c> publicCatalogue() {
        return [
            SELECT Id, Name FROM Project__c
            WHERE Is_Public__c = true
            WITH SYSTEM_MODE
            LIMIT 200
        ];
    }
}
```

## 6. Untrusted parameter selecting the object or fields

Every `@AuraEnabled` parameter is attacker-controlled. Per the Secure Coding Guide, method parameters
must not be placed into a SOQL query unsanitized and must not be trusted to specify which fields and
objects a user can access. Use pattern 2. For `sObject` parameters coming from a client or an
integration, run them through `Security.stripInaccessible(AccessType.UPDATABLE, records)` before DML.

## 7. XSS in LWC

Vulnerable:

```javascript
import { LightningElement, api } from 'lwc';

export default class Summary extends LightningElement {
    @api serverHtml;

    renderedCallback() {
        this.template.querySelector('.body').innerHTML = this.serverHtml; // XSS sink
    }
}
```

Fixed, option A - render with the template engine (always preferred):

```html
<template>
    <div class="body">
        <template for:each={paragraphs} for:item="p">
            <p key={p.id}>{p.text}</p>
        </template>
    </div>
</template>
```

Fixed, option B - when raw markup is unavoidable, isolate it with `lwc:dom="manual"` and build nodes
programmatically instead of assigning HTML strings:

```html
<template>
    <div class="body" lwc:dom="manual"></div>
</template>
```

```javascript
renderedCallback() {
    const host = this.template.querySelector('.body');
    host.textContent = '';
    for (const p of this.paragraphs) {
        const el = document.createElement('p');
        el.textContent = p.text;     // text, never HTML
        host.appendChild(el);
    }
}
```

`lwc:dom="manual"` tells LWC that the subtree is managed by hand; it does not sanitize anything. Rich
text that must render markup belongs in `lightning-formatted-rich-text`, which sanitizes, or must be
sanitized server-side against an allowlist. `@lwc/lwc/no-inner-html` flags the `innerHTML` write.

## 8. XSS in Visualforce

Three parser stages (HTML, then JavaScript, then `innerHTML` back into HTML) each need their own
escaping. Payloads against the vulnerable form below: `</script><script>...` breaks the HTML script
block, `'; ...;//` breaks the JavaScript string, `\x3csvg onload=...\x3e` injects a tag through
`innerHTML`.

```html
<apex:page>
  <!-- Vulnerable -->
  <div id="greet"></div>
  <script>
    document.querySelector('#greet').innerHTML =
      'You searched for <b>{!$CurrentPage.parameters.q}</b>';
  </script>

  <!-- Fixed: escaped output, JSENCODE for the JS string context, textContent instead of innerHTML -->
  <apex:outputText value="{!$CurrentPage.parameters.q}" escape="true"/>
  <script>
    var q = '{!JSENCODE($CurrentPage.parameters.q)}';
    document.querySelector('#greet').textContent = 'You searched for ' + q;
  </script>
</apex:page>
```

Apply the escaping function matching each parser pass: `HTMLENCODE` for HTML text and quoted
attributes, `JSENCODE` for JavaScript strings, `URLENCODE` for URL components,
`JSINHTMLENCODE` for JavaScript embedded in HTML attributes. Never disable escaping on
`ApexPages.addMessage` (`ApexXSSFromEscapeFalse`) or pass URL parameters straight through
(`ApexXSSFromURLParam`).

## 9. Open redirect

Vulnerable:

```apex
public PageReference finish() {
    return new PageReference(ApexPages.currentPage().getParameters().get('retURL'));
}
```

Fixed:

```apex
private static final Set<String> ALLOWED_RETURNS = new Set<String>{
    '/lightning/o/Account/home', '/lightning/o/Expense__c/home'
};

public PageReference finish() {
    String retUrl = ApexPages.currentPage().getParameters().get('retURL');
    return new PageReference(ALLOWED_RETURNS.contains(retUrl) ? retUrl : '/');
}
```

Rules: accept relative paths only, compare against an allowlist, reject anything containing `://`,
`//`, or a backslash. `ApexOpenRedirect` flags redirects to user-controlled locations.

## 10. CSRF: state change reachable from a GET

Vulnerable - DML in a constructor or initializer runs when a page or `cacheable=true` method is
merely loaded, so a crafted link mutates data:

```apex
public with sharing class AcceptInviteController {
    public AcceptInviteController() {
        Invite__c inv = new Invite__c(Status__c = 'Accepted');
        insert as user inv;   // ApexCSRF
    }
}
```

Fixed - state change only from an explicit action, with a token the attacker cannot forge:

```apex
public with sharing class AcceptInviteController {
    public String inviteToken { get; set; }

    public PageReference accept() {
        List<Invite__c> invites = [
            SELECT Id, Status__c FROM Invite__c
            WHERE Token__c = :inviteToken AND Status__c = 'Pending'
            WITH USER_MODE LIMIT 1
        ];
        if (invites.isEmpty()) {
            ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.ERROR, 'Invalid invite.'));
            return null;
        }
        invites[0].Status__c = 'Accepted';
        update as user invites;
        return new PageReference('/');
    }
}
```

For Apex REST, put mutations behind `@HttpPost`/`@HttpPatch`/`@HttpDelete`, never `@HttpGet`. For
`@AuraEnabled`, never mark a mutating method `cacheable=true`.

## 11. Hardcoded credentials and secrets

Vulnerable:

```apex
HttpRequest req = new HttpRequest();
req.setEndpoint('https://api.example.com/v1/orders');
req.setHeader('Authorization', 'Bearer sk_live_51H9x0pQ7yTf8');  // ApexSuggestUsingNamedCred
```

Fixed:

```apex
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:Example_API/v1/orders');   // Named Credential + External Credential
req.setMethod('POST');
req.setHeader('Content-Type', 'application/json');
req.setBody(JSON.serialize(payload));
HttpResponse res = new Http().send(req);
```

Storage rules from the Secure Coding Guide:

| Secret | Correct home |
| --- | --- |
| Outbound auth material | External Credential (platform-encrypted with org-specific keys) referenced by a Named Credential |
| Package-level secret | protected custom metadata type inside a namespaced managed package |
| Org-local operational secret | protected custom setting or custom metadata, read only from Apex, access gated by permission set |
| Anything at all | never in source, never in a URL query string, never in a debug log |

Long-term secrets must not travel in GET query strings; short-lived tokens such as CSRF tokens may.
Never put a Salesforce session Id or PII in a URL to an external system. vibe-force hooks reject
writes containing credential-shaped literals when `hooks.mode` is `standard` or `strict`.

## 12. Weak or hardcoded crypto

```apex
// Vulnerable: hardcoded key and fixed IV (ApexBadCrypto)
Blob enc = Crypto.encrypt('AES128', Blob.valueOf('0123456789abcdef'), Blob.valueOf('1111111111111111'), data);

// Fixed: key from protected custom metadata / External Credential, managed random IV
Blob enc = Crypto.encryptWithManagedIV('AES256', EncryptionKeyProvider.currentKey(), data);
```

`ApexBadCrypto` requires randomly generated IVs and keys for `Crypto` calls. Prefer Shield Platform
Encryption or Named Credentials over hand-rolled crypto.

## 13. Plain HTTP endpoint

`req.setEndpoint('http://api.example.com')` triggers `ApexInsecureEndpoint`. Always `https`, and
prefer `callout:` Named Credential references so the endpoint is configuration, not code.

## 14. Hardcoded Id

```apex
// Vulnerable (AvoidHardcodingId)
if (rec.RecordTypeId == '012000000000123AAA') { /* ... */ }

// Fixed
Id enterpriseRt = Schema.SObjectType.Opportunity
    .getRecordTypeInfosByDeveloperName().get('Enterprise').getRecordTypeId();
if (rec.RecordTypeId == enterpriseRt) { /* ... */ }
```

Hardcoded Ids break across sandbox, scratch org, and production, and often smuggle authorization
decisions into source.

## 15. Sensitive data in debug logs

The Secure Coding Guide prohibits usernames, passwords, names, contact data, opportunity data, and
other PII in Apex debug logs, including custom application logs. Two structural risks:

- `APEX_CODE = FINEST` logs **all** Apex variable assignments (`VARIABLE_ASSIGNMENT`), so any string
  variable holding a password or PII lands in the log.
- Logs are visible to administrators (`Location = Monitoring`) for seven days.

Practices: log identifiers and status codes, not payloads; wrap logging in a helper that redacts
known-sensitive fields; keep trace flags scoped to a single user with a short `ExpirationDate`; never
leave `FINEST` active, especially before a deployment. Session Ids are replaced with
`SESSION_ID_REMOVED` automatically, but nothing else is. See skill `sf-debugging-logs`.

## 16. Inaccessible `@AuraEnabled` getter

Since the Summer '21 mandatory security update, access modifiers are enforced on Apex properties in
Lightning component markup. A `private` or `protected` getter on an `@AuraEnabled` return type makes
the value silently unavailable to the component. `pmd:InaccessibleAuraEnabledGetter` detects it;
declare the property `public` (and `@AuraEnabled` where needed) on wrapper classes returned to LWC.

## 17. Over-privileged integration user

Checklist for every integration identity:

1. Dedicated user, never a human's account, never `System Administrator`.
2. Access granted only by a purpose-built permission set (`Integration_<System>_Access`).
3. No `Modify All Data`, `View All Data`, `Author Apex`, or `Manage Users`.
4. Object and field permissions limited to what the interface writes plus its lookups.
5. API-only where possible; login IP ranges restricted; OAuth with refresh token rotation.
6. Verify after deployment:

```bash
sf data query --target-org vf-uat --query "SELECT PermissionSet.Name, PermissionsModifyAllData, PermissionsViewAllData FROM PermissionSetAssignment WHERE Assignee.Username = 'integration@example.com.vfuat'"
```

## 18. Vulnerable third-party JavaScript

Static resources carrying outdated libraries are detected by the `retire-js` engine:

```bash
sf code-analyzer run --workspace . --rule-selector retire-js --view detail
```

Keep vendored libraries in a single static resource folder, record versions, and treat a
`retire-js` finding at severity 1 or 2 as a release blocker (skill `sf-code-analyzer-quality`).

---

## Review sweep commands

```bash
# every security-tagged rule across engines, detailed
sf code-analyzer run --workspace . --rule-selector Security --view detail \
  --output-file .vibeforce/reports/security-detail.json

# Apex path analysis for CRUD/FLS and sharing
sf code-analyzer run --workspace . --rule-selector sfge --view detail

# AppExchange-grade PMD ruleset when packaging
sf code-analyzer run --workspace . --rule-selector AppExchange --view detail

# vibe-force gate
node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" analyzer --changed
```
