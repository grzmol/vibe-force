# Per-Metadata-Type Deployment Gotchas

Types that do not behave like Apex classes. Each row states the trap, the observable symptom, and
the workaround.

Grounded in the Metadata API Developer Guide (`FlowDefinition`,
*Deleting Components from an Organization*, *Special Behavior in Metadata API Deployments*), the
Salesforce DX Developer Guide (profile retrieval with source tracking, `scopeProfiles`), the 2GP
guide (`How We Handle Profile Settings`), and the CLI command reference. Where a behaviour is
widely relied upon but not confirmable from a document fetched this session it is marked
`[unverified]`.

## Quick index

| Type | Severity | Core trap |
| --- | --- | --- |
| Profile | high | Content is relative to the rest of the payload |
| PermissionSet / PermissionSetGroup | medium | Groups need recalculation; licences must exist |
| Flow / FlowDefinition | high | `FlowDefinition.activeVersionNumber` overrides the flow's `status` |
| CustomField (delete) | high | Data loss; roll-up summary deletes bypass the Recycle Bin |
| Picklist / GlobalValueSet | high | Values are additive; removal needs explicit destructive changes |
| RecordType | medium | Requires picklist values and profile visibility to exist first |
| CustomSettings (hierarchy) | medium | Metadata deploys the definition, never the data |
| CustomMetadata records | low | Records are deployable metadata, protected records are invisible to subscribers |
| SharingRules / SharingReason | high | Recalculation is asynchronous; org-wide defaults must match |
| Layout / CompactLayout | medium | Layout assignments live in Profiles |
| Translations | medium | Requires Translation Workbench and the target language enabled |
| StandardValueSet | medium | Not created by a package; needs `seedMetadata` for 2GP |
| ConnectedApp / NamedCredential / ExternalCredential | high | Secrets never travel |
| Queue / Group | medium | Referenced users and objects must exist |
| ApexClass version | medium | `<apiVersion>` in `-meta.xml` pins behaviour |
| EmailTemplate / Folder | low | Folder must exist before the template |
| Territory2 | medium | Model state machine |
| Custom Object (delete) | high | Cannot delete objects referenced by an active Lightning page |

## Profiles and Permission Sets

| Trap | Symptom | Workaround |
| --- | --- | --- |
| Profile content retrieved from an org is filtered by what else is in the manifest | Retrieved profile is missing field permissions, then the deploy strips them in the target | Always retrieve profiles together with the objects, fields, classes, pages, and layouts they reference, or drive profiles entirely from source |
| Source tracking treats a profile as changed whenever a referenced component changes | Endless profile churn in diffs | Use the documented profile retrieval behaviour for tracked orgs; prefer permission sets for grants and keep profiles minimal |
| Deploying a profile removes permissions absent from the file | Users silently lose access | Treat the profile file as the complete desired state and review its diff every release |
| `Profile:My Profile` with a space | CLI parses the space as a new value | Quote it: `--metadata "Profile:My Profile"` |
| `<userLicense>` noise in diffs | Profile files differ per org | `includeProfileUserLicenses` in `sfdx-project.json` controls whether `<userLicense>` is emitted (default `false`) |
| Packaged profile settings pull in unrelated package directories | 2GP/unlocked package version contains permissions it should not | Set `scopeProfiles: true` on the package directory so only that directory's profile settings are included |
| Permission set group not usable right after deploy | "Permission set group is being recalculated" | Wait for recalculation; in tests call `Test.calculatePermissionSetGroup()` `[unverified]` |
| Permission set references a permission set licence the target org lacks | Deploy fails on the licence reference | Confirm licence availability first; skill `sf-security-model` |

Rule for this harness: grants go in permission sets, assigned with
`sf org assign permset --name <n> --target-org <o>`. Profiles carry only what cannot live in a
permission set (login hours/IP ranges, default record types, layout assignments, page and app
defaults).

## Flows

| Trap | Symptom | Workaround |
| --- | --- | --- |
| `FlowDefinition.activeVersionNumber` overrides the flow's own `status` | You deploy a flow marked `Active` and an older version goes live instead | Either omit `flowDefinitions` from the payload and control status on the `Flow`, or keep `activeVersionNumber` correct. The Metadata API docs are explicit: when flow definitions are present, their active version numbers win |
| Legacy versioned flow file names | Duplicate flow versions appear | From API 44.0 onward use flow metadata file names **without** version numbers and stop using `FlowDefinition` to activate/deactivate; activate through the `Flow` object |
| Deploying an active flow into production requires test coverage of flows in some configurations | Deploy blocked with a flow coverage error | Add `FlowTest` metadata, or deploy inactive and activate afterwards; skill `sf-flow-automation` |
| Deactivating a flow by deleting it | Flow cannot be deleted while active or referenced | Deactivate first (set `status` / `activeVersionNumber`), then delete in a later deploy |
| `masterLabel` on a packaged `FlowDefinition` | Label appears to ignore your value | In managed packages `FlowDefinition.masterLabel` inherits the flow's active version name |

```xml
<!-- force-app/main/default/flowDefinitions/VF_Lead_Router.flowDefinition-meta.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">
    <activeVersionNumber>7</activeVersionNumber>
</FlowDefinition>
```

```bash
# Deploy the new version inactive, verify, then activate in a second deploy.
sf project deploy start --metadata Flow:VF_Lead_Router --target-org vf-prod
# ... verify ...
sf project deploy start --metadata FlowDefinition:VF_Lead_Router --target-org vf-prod
```

## Fields, picklists, and value sets

| Trap | Symptom | Workaround |
| --- | --- | --- |
| Deleting a `CustomField` destroys its data | Irrecoverable data loss | Two-phase removal: stop reading/writing in release N, delete in release N+1 after verifying no dependency remains |
| Roll-up summary field deletion bypasses the Recycle Bin | Field gone even without `--purge-on-delete` | Documented behaviour; treat every roll-up deletion as permanent |
| Picklist values are additive on deploy | Values removed from source stay in the org | Remove values through a destructive change on the picklist value, or manage the list as a `GlobalValueSet` |
| Restricted picklist + record-level data | Deploy fails on values in use | Clean the data first, or widen the value set |
| `StandardValueSet` cannot be packaged | Package install fails on standard picklist values | Use `seedMetadata` on the package directory (skill `sf-packaging-release`) |
| Required field added in one deploy | Existing records fail validation immediately | Add optional -> backfill -> validation rule -> required |
| Field-level formula referencing a field in the same payload | Ordering error | Split into two deploys, or rely on the platform's dependency resolution within a single manifest |
| Changing a field type | Destructive conversion or outright rejection | Add a new field, migrate, delete the old one |
| Master-detail relationship change | Cannot convert once data exists | Rebuild the relationship in a controlled migration; skill `sf-data-management` |

## Record types

| Trap | Symptom | Workaround |
| --- | --- | --- |
| Record type deployed before its picklist values | "Picklist value not found" | Deploy the object (with picklist values) and the record type in the same manifest |
| Record type invisible to users | Visibility lives in Profiles/Permission Sets | Deploy the matching profile/permission set record type visibility |
| Scratch org package install needs a default record type | Install fails on record type requirements | Set `objectSettings.<object>.defaultRecordType` in the scratch org definition (skill `sf-scratch-orgs-sandboxes`) |
| Deleting a record type | Blocked while assigned or referenced | Remove visibility and layout assignments first |

## Custom settings and custom metadata

| Trap | Symptom | Workaround |
| --- | --- | --- |
| Hierarchy custom setting **data** is not metadata | Definition deploys, values are empty in the target | Seed values with `sf data import tree` / anonymous Apex, or migrate to custom metadata types |
| List custom settings are legacy | New orgs cannot create them | Use custom metadata types |
| Custom metadata **records** are deployable | Confusion about what travels | `customMetadata/<Type>.<Record>.md-meta.xml` deploys with the payload — this is the mechanism for environment-specific config in source control |
| Protected custom metadata records | Invisible to subscriber org admins | Intentional for packaged secrets/config; see skill `sf-packaging-release` |
| Environment-specific values in committed custom metadata | Production endpoint deployed to a sandbox | Keep per-environment records in per-environment directories and select with a manifest, or use `replacements` in `sfdx-project.json` |

```apex
// Reading environment config that arrived as custom metadata.
public with sharing class VFConfig {
    public static String endpoint(String name) {
        VF_Integration_Setting__mdt cfg = VF_Integration_Setting__mdt.getInstance(name);
        if (cfg == null) {
            throw new IllegalArgumentException('Missing VF_Integration_Setting__mdt: ' + name);
        }
        return cfg.Endpoint__c;
    }
}
```

## Sharing rules and org-wide defaults

| Trap | Symptom | Workaround |
| --- | --- | --- |
| Sharing rule deploy triggers asynchronous recalculation | Deploy "succeeds" but access is not yet correct | Wait for recalculation before verification; do not assert sharing immediately after deploy |
| Sharing rule requires a more restrictive org-wide default | Deploy fails on the rule | Deploy the `sharingModel` change (object) and the rule together, or in the right order |
| Changing org-wide defaults recalculates the whole org | Long-running, disruptive | Schedule; consider `DeferSharingCalc` in scratch orgs for test setup |
| `SharingReason` used by Apex managed sharing | Apex fails after deploy if the reason is missing | Deploy the object's sharing reason alongside the class that uses it |
| Criteria-based sharing rule limits | Deploy fails at the rule limit | Consolidate rules; skill `sf-security-model` |

## Layouts, compact layouts, apps

| Trap | Symptom | Workaround |
| --- | --- | --- |
| Layout **assignments** are stored in Profiles | Layout deploys but nobody sees it | Deploy the profile (or permission set where applicable) containing the assignment |
| Layout references a field not in the payload | Deploy fails on the field reference | Include the field, or remove it from the layout |
| Lightning page (`FlexiPage`) overrides the layout | Layout change has no visible effect | Check the Lightning Record Page and its activation |
| Deleting a component referenced by an active Lightning page | Destructive change rejected | Remove the page's action override by deactivating it in Lightning App Builder first, then delete |
| `CustomApplication` navigation items reference missing tabs | Deploy failure | Include the `CustomTab` metadata |

## Translations

| Trap | Symptom | Workaround |
| --- | --- | --- |
| `Translations` deploy requires Translation Workbench enabled | Deploy fails immediately | Enable it (`languageSettings.enableTranslationWorkbench` in a scratch org definition) |
| Target language not enabled in the org | Translated labels silently ignored | Enable the language in Setup / `languageSettings.enableEndUserLanguages` |
| `CustomObjectTranslation` is per object, per language | Partial translations | One `<object>-<lang>.objectTranslation-meta.xml` per pair; deploy the whole set |
| Translation references a label that moved | Deploy failure on the missing key | Deploy `CustomLabels` first or in the same manifest |
| Retrieved translations churn | Files reorder between retrieves | Normalise via the project formatter; do not hand-edit ordering |

## Credentials and integration metadata

| Trap | Symptom | Workaround |
| --- | --- | --- |
| `NamedCredential` / `ExternalCredential` secrets never deploy | Callouts fail with auth errors after deploy | Re-enter principals/secrets per environment; skill `sf-integration-patterns` |
| `ConnectedApp` consumer secret not deployable | OAuth flows break in the target | Recreate the connected app per environment, or store the secret out of band |
| Snapshot/sandbox copies exclude connected apps, named credentials, external credentials | Environment silently non-functional | Part of the post-refresh runbook (skill `sf-scratch-orgs-sandboxes`) |
| `RemoteSiteSetting` / `CspTrustedSite` prompts on package install | Interactive prompt blocks CI | `sf package install --no-prompt` (skill `sf-packaging-release`) |
| `ExternalService` regenerates Apex | Generated classes differ per org | Commit generated artifacts or regenerate as a build step |

## Apex specifics

| Trap | Symptom | Workaround |
| --- | --- | --- |
| `<apiVersion>` in `*.cls-meta.xml` pins versioned behaviour | Same code behaves differently across classes | Keep all classes on the project's `sourceApiVersion` (`67.0`) unless a legacy behaviour is deliberately retained |
| Version boundary at 67.0 | `WITH SECURITY_ENFORCED` is **not allowed** in an Apex SOQL `SELECT` at 67.0 and later | Use `WITH USER_MODE` in SOQL, `AccessLevel.USER_MODE` in `Database` methods, and `insert as user` / `update as user` for DML. Only mention `WITH SECURITY_ENFORCED` as pre-67.0 legacy |
| Default execution context at 67.0 | Apex runs in **user** context by default — object permissions and FLS are enforced unless you opt into system mode | Opt out explicitly and deliberately with `WITH SYSTEM_MODE`, `AccessLevel.SYSTEM_MODE`, or `as system` |
| Implicit sharing at 67.0 | A class with no sharing declaration behaves as `with sharing` | Still declare `with sharing` explicitly for readability; justify any `without sharing` in a comment |
| Deleting a class that a trigger or another class references | Dependency error | Deploy the dereferencing change and the deletion together using `--post-destructive-changes` |
| Test classes counted in coverage | Coverage math surprises | Test classes are excluded from coverage; skill `sf-apex-testing` |
| `@IsTest(SeeAllData=true)` in a package payload | Fragile in a subscriber org | Avoid; build data in the test |

```apex
// 67.0-correct data access in a deployable service class.
public with sharing class VFAccountService {
    public static List<Account> activeByIndustry(String industry) {
        return [
            SELECT Id, Name, Industry, VF_Score__c
            FROM Account
            WHERE Industry = :industry AND VF_Active__c = TRUE
            WITH USER_MODE
            ORDER BY Name
            LIMIT 200
        ];
    }

    public static void rescore(List<Account> accounts) {
        // Bulkified, user-mode DML: FLS and sharing are enforced.
        for (Account a : accounts) {
            a.VF_Score__c = a.VF_Score__c == null ? 1 : a.VF_Score__c + 1;
        }
        if (!accounts.isEmpty()) {
            update as user accounts;
        }
    }
}
```

## Queues, groups, territories

| Trap | Symptom | Workaround |
| --- | --- | --- |
| `Queue` references users or objects missing in the target | Deploy failure on the member reference | Deploy supported objects first; avoid per-user membership in source |
| `Group` (public group) membership is environment-specific | Groups deploy with the wrong members | Keep membership out of source; assign per environment |
| `Territory2Model` has an activation state machine | Deploy rejected in the wrong state | Deploy the model in `Planning`, then activate |

## Email templates and folders

| Trap | Symptom | Workaround |
| --- | --- | --- |
| Template deployed before its folder | "Folder does not exist" | Include `EmailFolder` / `Folder` metadata in the same manifest |
| Templates reference merge fields on missing objects | Deploy failure | Include the referenced fields |
| Letterhead dependency | Template deploy fails | Deploy `Letterhead` first |

## Destructive change mechanics (applies to every type)

- Wildcards (`*`) are **not** supported in destructive manifests; list every member.
- A `package.xml` must accompany a destructive manifest, even for a delete-only deploy. For a
  delete-only deploy it contains only `<version>67.0</version>`.
- By default deletions are processed before additions. `destructiveChangesPre.xml` and
  `destructiveChangesPost.xml` let you choose (API 33.0 and later).
- Use `destructiveChangesPost.xml` when the additions remove the dependency that blocks the
  delete — for example, deploy the updated Apex class that no longer references a custom object,
  then delete the object in the same deploy.
- `--purge-on-delete` bypasses the Recycle Bin.
- Attempting to delete components that do not exist still attempts the remaining deletions, and
  raises a warning — pair with `--ignore-warnings` in CI.
- You cannot delete items associated with an active Lightning page (a custom object, a component
  on the page, or the page itself) until the page's action override is deactivated in Lightning
  App Builder.

```bash
sf project deploy start \
  --manifest manifest/package.xml \
  --pre-destructive-changes manifest/destructiveChangesPre.xml \
  --post-destructive-changes manifest/destructiveChangesPost.xml \
  --purge-on-delete --ignore-warnings \
  --test-level RunLocalTests --target-org vf-int --wait 60
```

## Ordering heuristic

When a deploy fails on a dependency and you do not want to reason about it, put everything in one
manifest and let the platform order it. Manifest-scoped deploys resolve intra-payload
dependencies; hand-split deploys do not. Split only when you intentionally need two phases
(inactive-then-activate, add-then-delete).
