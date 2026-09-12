# Metadata source-format directory map

Every row is taken from the metadata registry that Salesforce CLI itself uses
(`source-deploy-retrieve/src/registry/metadataRegistry.json`), which currently defines 535 metadata
types. Paths below are relative to a package directory root, normally
`<packageDir>/main/default/`.

Legend:

- **Files on disk** — what a single component looks like. `X-meta.xml` is the metadata wrapper;
  content types additionally have a payload file.
- **strict dir** — `strictDirectoryName`: the component *must* sit in exactly this directory name or
  the CLI cannot see it.
- **in folder** — `inFolder`: components live one level deeper, inside a folder component
  (`reports/<Folder>/<Report>.report-meta.xml`).

## Code and UI

| Type | Directory | Files on disk | Notes |
| --- | --- | --- | --- |
| `ApexClass` | `classes/` | `Foo.cls` + `Foo.cls-meta.xml` | Content type — both files always move together |
| `ApexTrigger` | `triggers/` | `Foo.trigger` + `Foo.trigger-meta.xml` | Content type |
| `ApexPage` | `pages/` | `Foo.page` + `Foo.page-meta.xml` | Visualforce page |
| `ApexComponent` | `components/` | `Foo.component` + `Foo.component-meta.xml` | Visualforce component |
| `ApexTestSuite` | `testSuites/` | `Foo.testSuite-meta.xml` | Referenced by `sf apex run test --suite-names` |
| `LightningComponentBundle` | `lwc/<bundle>/` | `foo.js`, `foo.html`, `foo.js-meta.xml`, `foo.css`, `__tests__/foo.test.js` | strict dir; bundle directory name is the component name (camelCase) |
| `AuraDefinitionBundle` | `aura/<bundle>/` | `Foo.cmp`, `FooController.js`, `FooHelper.js`, `Foo.cmp-meta.xml` | strict dir |
| `LightningMessageChannel` | `messageChannels/` | `Foo.messageChannel-meta.xml` | LMS channel used by LWC/Aura/Visualforce |
| `StaticResource` | `staticresources/` | `foo.resource-meta.xml` + payload (`foo.zip`, `foo.png`, expanded `foo/` tree) | strict dir; archives auto-expand on retrieve |
| `ContentAsset` | `contentassets/` | `Foo.asset-meta.xml` + payload | Asset files |
| `Document` | `documents/<Folder>/` | `Foo.document-meta.xml` + payload | in folder, strict dir |
| `DataWeaveResource` | `dw/` | `Foo.dwl-meta.xml` | DataWeave in Apex |
| `Scontrol` | `scontrols/` | `Foo.scf-meta.xml` | Legacy s-control |
| `CanvasMetadata` | `Canvases/` | `Foo.Canvas-meta.xml` | Directory name is capitalised in the registry |

## Objects and schema

| Type | Directory | Files on disk | Notes |
| --- | --- | --- | --- |
| `CustomObject` | `objects/<Object>/` | `<Object>.object-meta.xml` | strict dir; always decomposed (children below) |
| `CustomField` | `objects/<Object>/fields/` | `Field__c.field-meta.xml` | Child of `CustomObject` |
| `RecordType` | `objects/<Object>/recordTypes/` | `Name.recordType-meta.xml` | Child; picklist values are listed inside |
| `ValidationRule` | `objects/<Object>/validationRules/` | `Name.validationRule-meta.xml` | Child |
| `ListView` | `objects/<Object>/listViews/` | `Name.listView-meta.xml` | Child; high-churn, consider `.forceignore` |
| `CompactLayout` | `objects/<Object>/compactLayouts/` | `Name.compactLayout-meta.xml` | Child |
| `FieldSet` | `objects/<Object>/fieldSets/` | `Name.fieldSet-meta.xml` | Child |
| `BusinessProcess` | `objects/<Object>/businessProcesses/` | `Name.businessProcess-meta.xml` | Child; required by some record types |
| `WebLink` | `objects/<Object>/webLinks/` | `Name.webLink-meta.xml` | Child |
| `Index` | `objects/<Object>/indexes/` | `Name.index-meta.xml` | Child; custom index metadata |
| `SharingReason` | `objects/<Object>/sharingReasons/` | `Name.sharingReason-meta.xml` | Child; Apex managed sharing |
| `CustomObjectTranslation` | `objectTranslations/<Object>-<lang>/` | `<Object>-<lang>.objectTranslation-meta.xml` | strict dir; decomposed, child `CustomFieldTranslation` in `fields/` with suffix `.fieldTranslation-meta.xml` |
| `GlobalValueSet` | `globalValueSets/` | `Foo.globalValueSet-meta.xml` | Shared picklist values |
| `StandardValueSet` | `standardValueSets/` | `CaseStatus.standardValueSet-meta.xml` | Standard picklists (`Industry`, `CaseStatus`, ...) |
| `CustomMetadata` | `customMetadata/` | `Type.Record.md-meta.xml` | Records of a custom metadata type |
| `Territory2Model` | `territory2Models/` | `Foo.territory2Model-meta.xml` | Enterprise Territory Management |

## Page layout and app UI

| Type | Directory | Files on disk | Notes |
| --- | --- | --- | --- |
| `Layout` | `layouts/` | `Object-Layout Name.layout-meta.xml` | Filename encodes object and layout name; spaces are literal |
| `FlexiPage` | `flexipages/` | `Foo.flexipage-meta.xml` | Lightning record/app/home pages |
| `QuickAction` | `quickActions/` | `Object.Action.quickAction-meta.xml` | Object-specific actions are dotted |
| `CustomTab` | `tabs/` | `Foo.tab-meta.xml` | |
| `CustomApplication` | `applications/` | `Foo.app-meta.xml` | Lightning app; also holds utility bar |
| `PathAssistant` | `pathAssistants/` | `Foo.pathAssistant-meta.xml` | |
| `HomePageLayout` | `homePageLayouts/` | `Foo.homePageLayout-meta.xml` | Classic home page |
| `RecordActionDeployment` | `recordActionDeployments/` | `Foo.deployment-meta.xml` | Actions & Recommendations |
| `UIObjectRelationConfig` | `uiObjectRelationConfigs/` | `Foo.uiObjectRelationConfig-meta.xml` | Related-record UI config |
| `LightningTypeBundle` | `lightningTypes/<bundle>/` | bundle of JSON/HTML files | strict dir |

## Automation

| Type | Directory | Files on disk | Notes |
| --- | --- | --- | --- |
| `Flow` | `flows/` | `Foo.flow-meta.xml` | Versioned in the org; the file is the active definition (skill `sf-flow-automation`) |
| `FlowDefinition` | `flowDefinitions/` | `Foo.flowDefinition-meta.xml` | Only needed to set the active version number |
| `Workflow` | `workflows/` | `Object.workflow-meta.xml` | One file per object; optional decomposition creates `workflowAlerts/`, `workflowFieldUpdates/`, `workflowRules/`, `workflowTasks/`, `workflowSends/`, `workflowOutboundMessages/`, `workflowFlowActions/`, `workflowKnowledgePublishs/` |
| `AssignmentRules` | `assignmentRules/` | `Object.assignmentRules-meta.xml` | Child `AssignmentRule` (`.assignmentRule-meta.xml`) |
| `AutoResponseRules` | `autoResponseRules/` | `Object.autoResponseRules-meta.xml` | Container type |
| `EscalationRules` | `escalationRules/` | `Case.escalationRules-meta.xml` | Container type |
| `DuplicateRule` | `duplicateRules/` | `Object.Name.duplicateRule-meta.xml` | Pairs with `MatchingRules` |
| `MatchingRules` | `matchingRules/` | `Object.matchingRule-meta.xml` | Container type; child `MatchingRule` |
| `EventSubscription` | `eventSubscriptions/` | `Foo.subscription-meta.xml` | Platform event subscription |
| `PlatformEventChannel` | `platformEventChannels/` | `Foo.platformEventChannel-meta.xml` | Change Data Capture / custom channels |
| `PlatformEventChannelMember` | `platformEventChannelMembers/` | `Foo.platformEventChannelMember-meta.xml` | Entity added to a channel |
| `Bot` | `bots/<Bot>/` | `Foo.bot-meta.xml` + `botVersions/` | strict dir; child `BotVersion` |
| `GenAiFunction` | `genAiFunctions/<fn>/` | bundle | strict dir; Agentforce action |
| `AIApplication` | `aiApplications/` | `Foo.ai-meta.xml` | Einstein app config |

## Security and access

| Type | Directory | Files on disk | Notes |
| --- | --- | --- | --- |
| `PermissionSet` | `permissionsets/` | `Foo.permissionset-meta.xml` | Preferred access mechanism; optional decomposition via `decomposePermissionSetBeta2` |
| `PermissionSetGroup` | `permissionsetgroups/` | `Foo.permissionsetgroup-meta.xml` | Composes permission sets |
| `Profile` | `profiles/` | `Foo.profile-meta.xml` | Org-wide, merge-hostile; see `references/repo-conventions.md` for the policy |
| `CustomPermission` | `customPermissions/` | `Foo.customPermission-meta.xml` | The right way to gate a bypass or feature flag in Apex/Flow |
| `SharingRules` | `sharingRules/` | `Object.sharingRules-meta.xml` | Container; children `SharingCriteriaRule`, `SharingOwnerRule`, `SharingGuestRule`, `SharingTerritoryRule` all live in `sharingRules/` with their own suffixes |
| `SharingSet` | `sharingSets/` | `Foo.sharingSet-meta.xml` | Experience Cloud sharing |
| `RestrictionRule` | `restrictionRules/` | `Foo.rule-meta.xml` | strict dir |
| `Queue` | `queues/` | `Foo.queue-meta.xml` | |
| `Group` | `groups/` | `Foo.group-meta.xml` | Public groups |
| `Role` | `roles/` | `Foo.role-meta.xml` | Role hierarchy |
| `Certificate` | `certs/` | `Foo.crt-meta.xml` + `Foo.crt` | |
| `ConnectedApp` | `connectedApps/` | `Foo.connectedApp-meta.xml` | Consumer secret is not retrieved |

## Integration

| Type | Directory | Files on disk | Notes |
| --- | --- | --- | --- |
| `NamedCredential` | `namedCredentials/` | `Foo.namedCredential-meta.xml` | Pairs with `ExternalCredential` in modern setups |
| `ExternalCredential` | `externalCredentials/` | `Foo.externalCredential-meta.xml` | Principals and auth protocol |
| `RemoteSiteSetting` | `remoteSiteSettings/` | `Foo.remoteSite-meta.xml` | Legacy endpoint allowlist |
| `CspTrustedSite` | `cspTrustedSites/` | `Foo.cspTrustedSite-meta.xml` | CSP for LWC/Aura |
| `ExternalServiceRegistration` | `externalServiceRegistrations/` | `Foo.externalServiceRegistration-meta.xml` | Optional decomposition via `decomposeExternalServiceRegistrationBeta` |
| `EmailServicesFunction` | `emailservices/` | `Foo.xml-meta.xml` | strict dir; suffix in the registry is literally `xml` |
| `InstalledPackage` | `installedPackages/` | `Namespace.installedPackage-meta.xml` | Declares a package dependency for a scratch org |

## Content, reporting, experience

| Type | Directory | Files on disk | Notes |
| --- | --- | --- | --- |
| `Report` | `reports/<Folder>/` | `Foo.report-meta.xml` | in folder; the folder itself is a `ReportFolder` component |
| `ReportType` | `reportTypes/` | `Foo.reportType-meta.xml` | |
| `Dashboard` | `dashboards/<Folder>/` | `Foo.dashboard-meta.xml` | in folder |
| `EmailTemplate` | `email/<Folder>/` | `Foo.email` + `Foo.email-meta.xml` | in folder; content type |
| `Letterhead` | `letterhead/` | `Foo.letter-meta.xml` | |
| `CustomLabels` | `labels/` | `CustomLabels.labels-meta.xml` | Single file for the whole org by default; child `CustomLabel`. Optional decomposition via `decomposeCustomLabelsBeta2` splits it per label |
| `Translations` | `translations/` | `en_US.translation-meta.xml` | One per language |
| `ManagedContentType` | `managedContentTypes/` | `Foo.managedContentType-meta.xml` | CMS content type |
| `WaveTemplateBundle` | `waveTemplates/<bundle>/` | bundle of JSON files | strict dir |
| `CustomNotificationType` | `notificationtypes/` | `Foo.notiftype-meta.xml` | Custom notifications |
| `ApexEmailNotifications` | `apexEmailNotifications/` | `Foo.notifications-meta.xml` | Recipients of Apex exception emails |
| `Network` | `networks/` | `Foo.network-meta.xml` | Experience Cloud site settings |
| `Community` | `communities/` | `Foo.community-meta.xml` | Legacy community |
| `ExperienceBundle` | `experiences/<site>/` | bundle of JSON view files | strict dir |
| `DigitalExperienceBundle` | `digitalExperiences/<type>/<site>/` | `Foo.digitalExperience-meta.xml` + nested content | Child `DigitalExperience` |
| `CustomSite` | `sites/` | `Foo.site-meta.xml` | strict dir |
| `Settings` | `settings/` | `Case.settings-meta.xml` | One file per settings area; in a manifest, `<name>Settings</name>` with `<members>Case</members>` |

## Decomposed types at a glance

| Type | Decomposed | How |
| --- | --- | --- |
| `CustomObject` | Always | Built-in — 10 child directories under `objects/<Object>/` |
| `CustomObjectTranslation` | Always | Built-in — one subdirectory per translation under `objectTranslations/`; field translations become `<field>.fieldTranslation-meta.xml`, the remainder `<name>.objectTranslation-meta.xml` |
| `CustomLabels` | Optional (Beta) | `sf project convert source-behavior --behavior decomposeCustomLabelsBeta2` → one `*.label-meta.xml` per label, named after the label's fullName, anywhere under a `labels` directory (subdirectories allowed, one per package directory) |
| `PermissionSet` | Optional (Beta) | `--behavior decomposePermissionSetBeta2` → `permissionsets/<Name>/` containing `<Name>.permissionset-meta.xml` (label, description, license), one `<Object>.objectSettings-meta.xml` per object under `objectSettings/`, and category files such as `<Name>.applicationVisibilities-meta.xml`, `<Name>.flowAccesses-meta.xml` |
| `SharingRules` | Optional (Beta) | `--behavior decomposeSharingRulesBeta` |
| `Workflow` | Optional (Beta) | `--behavior decomposeWorkflowBeta` → per-subtype directories (`workflowAlerts/`, `workflowRules/`, ...) |
| `ExternalServiceRegistration` | Optional (Beta) | `--behavior decomposeExternalServiceRegistrationBeta` → `<Name>.yaml` holding the OpenAPI `schema` field (always YAML in the project, even when the org stores JSON) plus `<Name>.externalServiceRegistration-meta.xml` for every other field |

```bash
# Always dry-run first; commit everything before converting.
sf project convert source-behavior --behavior decomposePermissionSetBeta2 --dry-run
sf project convert source-behavior --behavior decomposePermissionSetBeta2
```

The command rewrites `sfdx-project.json` (`sourceBehaviorOptions`) **and** splits the existing XML.
If the default org has source tracking, it errors out first because decomposition desynchronises
tracking — follow the message, then recreate or reset the tracked org.

## Resolving an unknown type

```bash
# What does the org support, and what is actually there?
sf org list metadata-types --target-org vf-dev --json \
  | jq -r '.result.metadataObjects[] | "\(.xmlName)\t\(.directoryName)\t\(.suffix)\t\(.inFolder)"' | sort
# result mirrors the Metadata API DescribeMetadataResult; the exact JSON envelope for this command
# has no published schema file `[unverified]` — inspect once with `--json | jq 'paths(scalars)'`.

sf org list metadata --metadata-type FlexiPage --target-org vf-dev --json \
  | jq -r '.result[].fullName'

# What will the CLI do with a local path?
sf project deploy preview --source-dir force-app/main/default/objects --target-org vf-dev
sf project list ignored --source-dir force-app/main/default/flows
```

`sf org list metadata-types` is the authoritative per-org answer (it is `describeMetadata`), and the
Metadata Coverage Report is the authoritative cross-channel answer for source tracking, unlocked
packages, and 2GP support.

## Naming rules that bite

| Situation | Rule |
| --- | --- |
| Special characters in a component name | URL-encoded on disk: `Custom: Marketing Profile` → `Custom%3A Marketing Profile.profile-meta.xml`. Use the encoded form in `.forceignore` |
| Layout names | `Object-Layout Name.layout-meta.xml` — the hyphen separates object and layout, spaces are preserved |
| Object-specific quick actions, duplicate rules, custom metadata records | Dotted `Parent.Child` filenames |
| Folder components | The folder is its own component (`ReportFolder`, `DashboardFolder`, `DocumentFolder`, `EmailFolder`) and must be deployed with its contents |
| LWC bundle names | camelCase directory; the `js`, `html`, and `js-meta.xml` basenames must match the directory |
| Files the commands always skip | dot-files/directories, `*.dup`, `package2-descriptor.json`, `package2-manifest.json` |

## Sources

- Metadata registry used by Salesforce CLI: <https://github.com/forcedotcom/source-deploy-retrieve/blob/main/src/registry/metadataRegistry.json>
- Salesforce DX Project Structure and Source Format: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_source_file_format.htm>
- Decomposed Metadata Types: <https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_ws_decomposed_md_types.htm>
- Metadata Types reference (per-type directory, suffix, wildcard support): <https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_types_list.htm>
- Metadata Coverage Report: <https://developer.salesforce.com/docs/metadata-coverage>
