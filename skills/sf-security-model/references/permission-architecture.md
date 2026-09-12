# Permission Architecture Reference

How vibe-force projects model access: permission sets as the unit of delivery, permission set groups
as the unit of assignment, muting permission sets as the subtractive tool, profiles reduced to
license defaults. Sources: Metadata API Developer Guide
([PermissionSet](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_permissionset.htm),
[PermissionSetGroup](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_permissionsetgroup.htm),
[MutingPermissionSet](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_mutingpermissionset.htm),
[Profile](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_profile.htm),
[NamedCredential](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_namedcredential.htm),
[ExternalCredential](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_externalcredential.htm)).

## 1. Container comparison

| Container | Directory / suffix | API since | Grants | Subtracts | Assignable directly | Packageable |
| --- | --- | --- | --- | --- | --- | --- |
| Profile | `profiles/*.profile` | 1.0 era | yes | yes (implicitly, by omission) | one per user | yes, but org-shaped and merge-hostile |
| Permission set | `permissionsets/*.permissionset` | 22.0 | yes | no | yes, many per user | yes |
| Permission set group | `permissionsetgroups/*.permissionsetgroup` | 45.0 | composes permission sets | via muting permission sets | yes | yes |
| Muting permission set | `mutingpermissionsets/*.mutingpermissionset` `[unverified: directory name not stated on the MutingPermissionSet page]` | 46.0 | no | yes, inside one group | no, referenced by a group | yes |

Policy: **ship permission sets, not profiles.** Profiles are a single-valued user attribute, they
merge badly across parallel work streams, and they cannot be composed. Permission sets grant access
only (they can never deny), so they are additive and safe to deploy in parallel by different agents.

## 2. Naming and decomposition

| Layer | Naming | Contents |
| --- | --- | --- |
| Feature access | `<Feature>_Access` (`Expense_App_Access`) | object/field permissions, Apex class access, tab and app visibility for one feature |
| Persona bundle | `<Persona>_PSG` (`Expense_Approver_PSG`) | permission set group referencing feature permission sets |
| Administrative capability | `<Capability>_Admin` (`Expense_Config_Admin`) | setup-level user permissions, custom metadata write |
| Integration identity | `Integration_<System>_Access` | minimum objects/fields for one interface, no `View All Data` |
| Mute | `<Persona>_Mute` | muting permission set referenced by exactly one group |

Rules that keep parallel builds conflict-free (wave 1 ownership in the vibe-force workflow):

- One permission set per feature slice, owned by the agent that owns the metadata slice
  (`sf-metadata-engineer` owns `objects/`, `permissionsets/`, `flows/`).
- Apex class access belongs to the same permission set as the feature it serves, so an Apex change
  and its `classAccesses` entry land in one PR.
- Never edit a shared persona permission set from two slices: compose with a group instead.

## 3. PermissionSet metadata shape

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Expense App Access</label>
    <description>Object, field, and Apex access required to submit expenses.</description>
    <userLicense>Salesforce</userLicense>
    <hasActivationRequired>false</hasActivationRequired>

    <applicationVisibilities>
        <application>Expense_Management</application>
        <visible>true</visible>
    </applicationVisibilities>

    <objectPermissions>
        <object>Expense__c</object>
        <allowCreate>true</allowCreate>
        <allowRead>true</allowRead>
        <allowEdit>true</allowEdit>
        <allowDelete>false</allowDelete>
        <viewAllRecords>false</viewAllRecords>
        <modifyAllRecords>false</modifyAllRecords>
        <viewAllFields>false</viewAllFields>
    </objectPermissions>

    <fieldPermissions>
        <field>Expense__c.Amount__c</field>
        <readable>true</readable>
        <editable>true</editable>
    </fieldPermissions>
    <fieldPermissions>
        <field>Expense__c.Internal_Margin__c</field>
        <readable>false</readable>
        <editable>false</editable>
    </fieldPermissions>

    <classAccesses>
        <apexClass>ExpenseController</apexClass>
        <enabled>true</enabled>
    </classAccesses>

    <tabSettings>
        <tab>Expense__c</tab>
        <visibility>Visible</visibility>
    </tabSettings>

    <recordTypeVisibilities>
        <recordType>Expense__c.Travel</recordType>
        <visible>true</visible>
        <default>true</default>
    </recordTypeVisibilities>

    <userPermissions>
        <name>ApiEnabled</name>
        <enabled>true</enabled>
    </userPermissions>
</PermissionSet>
```

Shape notes grounded in the Metadata API guide:

- The file name is the permission set API name; `fullName` is implied by the file name in source
  format.
- From API 40.0 onward, retrieving a permission set returns **all** of its content (Apex access,
  CRUD, FLS, and so on). Consequently, when you deploy a permission set you must include all of its
  metadata or you silently overwrite what you omitted.
- `viewAllFields` is an object-level permission that bypasses FLS for reads: treat it like
  `viewAllRecords` and require a written justification.
- Required fields (`readable` on a master-detail or required custom field) cannot be set
  non-readable; the deploy fails.
- Field permissions for standard required fields and formula fields are rejected; omit them.

Retrieval requires the related components in the manifest. To retrieve `objectPermissions` and
`fieldPermissions` for a custom object you must also retrieve the `CustomObject`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types><members>Expense__c</members><name>CustomObject</name></types>
    <types><members>Expense__c</members><name>CustomTab</name></types>
    <types><members>Expense_Management</members><name>CustomApplication</name></types>
    <types><members>*</members><name>PermissionSet</name></types>
    <version>67.0</version>
</Package>
```

## 4. PermissionSetGroup metadata shape

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PermissionSetGroup xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Expense Approver</label>
    <description>Submit plus approve; mutes delete on Expense__c.</description>
    <hasActivationRequired>false</hasActivationRequired>
    <permissionSets>Expense_App_Access</permissionSets>
    <permissionSets>Expense_Approval_Access</permissionSets>
    <mutingPermissionSets>Expense_Approver_Mute</mutingPermissionSets>
</PermissionSetGroup>
```

| Field | Type | Meaning |
| --- | --- | --- |
| `label` | string | required display label |
| `description` | string | free text |
| `hasActivationRequired` | boolean | requires an active session-based activation (API 53.0+), default `false` |
| `permissionSets` | string, repeated | member permission sets |
| `mutingPermissionSets` | string, repeated | muting permission sets applied within this group (API 46.0+) |
| `status` | string | read-only recalculation state: `Updated`, `Outdated`, `Updating`, `Failed` |

Individual permissions live in the member permission sets, never in the group. Retrieve
`PermissionSetGroup` together with its `PermissionSet` members. Access to view the type requires one
of View Setup and Configuration, Manage Session Permission Set Activations, or Assign Permission
Sets; editing requires Manage Profiles and Permission Sets.

Group recalculation is asynchronous. After a deploy, a group can sit at `Outdated` or `Updating`
briefly; post-deploy verification should poll it rather than assume immediate effect:

```bash
sf data query --target-org vf-uat \
  --query "SELECT DeveloperName, Status FROM PermissionSetGroup WHERE DeveloperName = 'Expense_Approver'"
```

## 5. Muting permission sets

`MutingPermissionSet` extends `PermissionSet`, so its file body uses the same element names; the
semantics invert - an entry means "remove this permission inside the group".

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MutingPermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Expense Approver Mute</label>
    <description>Approvers must not delete expenses even though the feature set grants it.</description>
    <objectPermissions>
        <object>Expense__c</object>
        <allowDelete>true</allowDelete>
    </objectPermissions>
</MutingPermissionSet>
```

Use a mute when a persona needs almost all of a reusable permission set. The alternative - forking
the permission set - duplicates FLS entries that then drift. A muting permission set applies only
inside the group that references it and cannot be assigned to a user directly.

## 6. Profiles: what is left

Keep exactly one profile per license type, containing only what a profile can uniquely hold and what
a permission set cannot: login hours and IP ranges, password policies (org-level in practice), default
record types and default app where the platform requires a profile value, and the user license
binding. Everything functional moves to permission sets.

Operational rules:

- Do not retrieve or deploy full profiles in feature PRs; profile files are org-wide and will
  clobber unrelated settings.
- If a profile change is unavoidable, isolate it in its own PR with its own review.
- vibe-force hooks treat writes under `profiles/` as a review-required path in `standard` mode and
  block them in `strict` mode; see skill `sf-deployment-strategies` for the destructive-change and
  approval policy.

## 7. Assignment

```bash
# assign a permission set to the running user in a scratch org
sf org assign permset --name Expense_App_Access --target-org vf-dev

# assign a permission set group
sf org assign permsetlicense --name <license> --target-org vf-dev   # licenses, when required
sf org assign permset --name Expense_Approver --target-org vf-dev   # groups use the same command

# verify in the org
sf data query --target-org vf-dev --query "SELECT PermissionSet.Name, PermissionSetGroup.DeveloperName FROM PermissionSetAssignment WHERE Assignee.Username = 'me@example.com'"
```

`[unverified]` Whether `sf org assign permset --name` accepts a permission set **group** developer
name was not confirmed against the CLI command reference in this session; if it rejects the group,
create the `PermissionSetAssignment` with `PermissionSetGroupId` instead:

```bash
sf data create record --target-org vf-dev --sobject PermissionSetAssignment \
  --values "AssigneeId=005xx000001Sv1PAAS PermissionSetGroupId=0PGxx0000004C93GAA"
```

In Apex tests, assign explicitly rather than relying on the running user:

```apex
PermissionSet ps = [SELECT Id FROM PermissionSet WHERE Name = 'Expense_App_Access' LIMIT 1];
insert new PermissionSetAssignment(AssigneeId = u.Id, PermissionSetId = ps.Id);
```

## 8. Access audit queries

| Question | Query |
| --- | --- |
| What object access does a permission set grant? | `SELECT SobjectType, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId IN (SELECT Id FROM PermissionSet WHERE Name = 'Expense_App_Access')` |
| Which fields are editable? | `SELECT Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId IN (SELECT Id FROM PermissionSet WHERE Name = 'Expense_App_Access')` |
| Who holds a dangerous permission? | `SELECT Assignee.Username FROM PermissionSetAssignment WHERE PermissionSet.PermissionsModifyAllData = true` |
| Who can run an Apex class? | `SELECT Parent.Name FROM SetupEntityAccess WHERE SetupEntityType = 'ApexClass' AND SetupEntityId IN (SELECT Id FROM ApexClass WHERE Name = 'ExpenseController')` |
| Is a group recalculated? | `SELECT DeveloperName, Status FROM PermissionSetGroup` |

Run them with `sf data query --target-org <alias>`; `vf-check smoke` includes the permission-set and
group-status probes for the feature under verification (skill `sf-post-deploy-verification`).

## 9. Secrets as metadata

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ExternalCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Example API</label>
    <authenticationProtocol>Oauth</authenticationProtocol>
    <description>OAuth client credentials for api.example.com.</description>
</ExternalCredential>
```

- `ExternalCredential` (API 56.0+, `externalCredentials/*.externalCredential`) describes **how**
  Salesforce authenticates; `NamedCredential` describes **where**. Apex references the pair as
  `callout:Example_API/path`.
- `authenticationProtocol` values: `AwsSv4`, `Basic`, `Custom`, `Jwt` (reserved), `JwtExchange`
  (reserved), `NoAuthentication` (reserved), `Oauth`, `Password` (reserved).
- All credentials stored in `ExternalCredential` are encrypted with auto-created org-specific keys.
- Principals need a permission set to use an external credential: add the principal access in the
  relevant `Integration_<System>_Access` permission set so the grant is versioned with the interface.
- Secret **values** never live in the repository. Deploy the credential shells, then set the secret
  once per org through Setup or an authenticated CLI call, and record in the release notes which orgs
  need it (skill `sf-integration-patterns`).

## 10. Shield Platform Encryption: code-level consequences

Encrypting a field with Shield Platform Encryption changes how code can use it. `[unverified]` These
constraints are widely documented in Salesforce Help, which was not reachable through the doc reader
in this session; confirm each one against the current Shield Platform Encryption implementation guide
before relying on it:

| Area | Consequence |
| --- | --- |
| SOQL filtering | encrypted fields generally cannot be used in `WHERE`, `ORDER BY`, `GROUP BY` (deterministic encryption relaxes some filtering) |
| Indexing / SOSL | encrypted fields are not indexed the same way; text searches may not match |
| Formula and roll-up | encrypted fields are restricted in formulas, roll-up summaries, and some criteria-based logic |
| External Id / unique | probabilistic encryption is incompatible with unique and external Id semantics |
| Apex reads | values decrypt transparently for users with the View Encrypted Data permission model in force; code must not assume filterability |

Design rule: never make an encrypted field a query filter, a sort key, or a join key. Keep a separate
non-sensitive key (tokenized external Id) for lookups, and assert the behaviour with an integration
test in a sandbox that has Shield enabled.

## 11. Monitoring and audit

| Signal | Where | Use |
| --- | --- | --- |
| Setup Audit Trail | Setup, downloadable CSV `[unverified: SetupAuditTrail object queryability not verified this session]` | who changed permissions, profiles, or sharing settings |
| `EventLogFile` (Event Monitoring) | `SELECT EventType, LogDate, LogFile FROM EventLogFile` | API usage, Apex execution, report exports, login anomalies |
| `PermissionSetAssignment` snapshots | `sf data query` in `vf-check smoke` | drift detection between environments |
| `PermissionSetGroup.Status` | query above | catch `Failed` recalculations after a deploy |

`EventLogFile` requires the View Event Log Files and API Enabled user permissions (users with View
All Data can also view them); Shield and Event Monitoring customers get one year of event log file
storage by default. Event log files do not count against data or file storage. Correlate related log
rows by setting the `X-SFDC-REQUEST-ID` header on API calls and querying the resulting request
identifier. Log data schema per `EventType` can change between releases; validate with
`LogFileFieldNames` and `LogFileFieldTypes`.

## 12. Checklist for a permission PR

1. New object, field, tab, app, record type, Apex class, or page is reflected in exactly one feature
   permission set.
2. No `viewAllRecords`, `modifyAllRecords`, `viewAllFields`, `ModifyAllData`, or `ViewAllData`
   without a comment in the PR description naming the business need.
3. No profile file in the diff (unless the PR is profile-only).
4. Personas assembled with permission set groups; subtraction done with a muting permission set.
5. Manifest includes the related components when permission sets are retrieved or deployed.
6. Assignment path documented: which group each persona receives.
7. `PermissionSetGroup.Status` verified `Updated` after deployment.
8. `vf-check smoke --target-org <alias>` includes the access-audit query for the new access.
