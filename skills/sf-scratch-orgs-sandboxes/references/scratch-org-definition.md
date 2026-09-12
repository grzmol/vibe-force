# Scratch Org Definition File Reference

Authoritative option list for `config/*-scratch-def.json`, plus ready-to-copy definition files.
Source: Salesforce DX Developer Guide, *Build Your Own Scratch Org Definition File*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_def_file.htm>)
and the published JSON schema
(<https://github.com/forcedotcom/schemas/blob/main/project-scratch-def.schema.json>).

The schema declares `additionalProperties: true` and `required: ["edition"]`. Anything not in the
table below that the schema accepts is either a `ScratchOrgInfo` custom field or an option the
docs list separately (`snapshot`, `sourceOrg`, `objectSettings`, `template`).

## Top-level options

| Option | Required | Type | Default if not specified | Notes |
| --- | --- | --- | --- | --- |
| `edition` | Yes | string | none | `Developer`, `Enterprise`, `Group`, `Professional`, `Partner Developer`, `Partner Enterprise`, `Partner Group`, `Partner Professional`. Partner editions require a Dev Hub in a Partner Business Org. Overridden by `--edition` (lowercase, hyphenated: `partner-developer`). |
| `orgName` | No | string | `Company` | Shown in the Dev Hub and in Setup. Overridden by `--name`. |
| `country` | No | string | Dev Hub's country | Two-character upper-case ISO-3166 Alpha-2 code. Sets the org locale. |
| `language` | No | string | default language for the country | Salesforce language code, e.g. `en_US`, `de`. |
| `username` | No | string | `test-<unique>@example.com` | Must be unique across the entire scratch org and sandbox universe; you own the uniqueness logic. Overridden by `--username`. |
| `adminEmail` | No | string | email of the requesting Dev Hub user | Overridden by `--admin-email`. |
| `description` | No | string | none | Up to 2000 characters; visible on Scratch Org Info / Active Scratch Orgs in the Dev Hub. Overridden by `--description`. |
| `hasSampleData` | No | boolean | `false` | `true` seeds the standard Salesforce sample data set. |
| `features` | No | string[] | none | Add-on features. Some take a value: `"AddCustomObjects:1000"`. |
| `settings` | No | object | none | Any Metadata API `*Settings` type, keyed by its camelCase name. |
| `objectSettings` | No | object | none | Per-object `sharingModel` and `defaultRecordType`. |
| `release` | No | string | same release as the Dev Hub | `preview` or `previous`; valid only during a Salesforce release transition window. Overridden by `--release`. |
| `snapshot` | No | string | none | Name of a scratch org snapshot. Use **instead of** `edition`. Overridden by `--snapshot`. |
| `sourceOrg` | No | string | none | 15-character org ID of an org shape. Use **instead of** `edition`. Overridden by `--source-org`. |
| `template` | No | string | none | Template id for the scratch org shape. Pilot feature. |
| `<custom field API name>` | No | any | none | A custom field you created on the `ScratchOrgInfo` object in the Dev Hub, e.g. `"workitem__c": "W-12345678"`. `ScratchOrgInfo` is not available in sandboxes or scratch orgs — create the field in the Dev Hub (often production). |

`edition`, `snapshot`, and `sourceOrg` are mutually exclusive, and so are the matching CLI flags
`--edition`, `--snapshot`, `--source-org`.

## `objectSettings`

Map keyed by the lowercase object name. Required before installing packages that create record
types or assume a specific sharing model.

| Child key | Allowed values |
| --- | --- |
| `sharingModel` | `private`, `read`, `readWrite`, `readWriteTransfer`, `fullAccess`, `controlledByParent`, `controlledByCampaign`, `controlledByLeadOrContent` |
| `defaultRecordType` | Alphanumeric string starting with a lowercase letter |

Not every object supports every sharing model; the create fails with a settings error if the
combination is invalid.

```json
"objectSettings": {
  "opportunity": { "sharingModel": "private", "defaultRecordType": "default" },
  "account": { "defaultRecordType": "default" }
}
```

## Commonly needed features

Feature names are case-sensitive. Full list: *Scratch Org Features* in the DX Developer Guide.

| Feature | Enables |
| --- | --- |
| `EnableSetPasswordInApi` | `sf org generate password` / `System.setPassword` in the scratch org |
| `AuthorApex` | Authoring Apex in a Professional/Group edition scratch org |
| `DebugApex` | Apex debugging support |
| `API` | API access in editions that lack it by default |
| `Communities` | Experience Cloud (pair with `communitiesSettings.enableNetworksEnabled`) |
| `Sites` | Salesforce Sites |
| `ServiceCloud` | Service Cloud features (cases, entitlements groundwork) |
| `Entitlements` | Entitlement management |
| `Knowledge` | Salesforce Knowledge |
| `LiveAgent` | Chat / Live Agent |
| `MarketingUser`, `SalesUser`, `ServiceUser` | Grants the matching user permission to the admin |
| `PersonAccounts` | Person accounts |
| `RecordTypes` | Record types in editions without them |
| `StateAndCountryPicklist` | State/country picklists |
| `ContactsToMultipleAccounts` | Contacts to multiple accounts |
| `MultiLevelMasterDetail` | Deeper master-detail hierarchies |
| `PlatformCache` / `ProviderFreePlatformCache` | Platform Cache partitions |
| `PlatformEncryption` | Shield Platform Encryption |
| `FieldAuditTrail` | Field Audit Trail |
| `ChangeDataCapture` | Change Data Capture events |
| `StreamingAPI`, `GenericStreaming`, `DurableGenericStreamingAPI` | Streaming / generic events |
| `TransactionFinalizers` | `System.Finalizer` for Queueable — see skill `sf-async-apex-patterns` |
| `ProcessBuilder`, `Workflow` | Legacy automation types |
| `CPQ`, `CoreCpq`, `SalesforcePricing` | CPQ / pricing objects |
| `Division`, `DeferSharingCalc`, `CascadeDelete` | Org-level data behaviours |
| `DataMaskUser` | Data Mask user permission |
| `EventLogFile` | Event Monitoring log files |
| `DevelopmentWave`, `WavePlatform`, `AnalyticsAdminPerms` | CRM Analytics |
| `Einstein1AIPlatform`, `AgentforceStandardAgents` | Agentforce / Einstein platform |
| `CustomerDataPlatform`, `CustomerDataPlatformLite` | Data Cloud |

Value-taking features (`Name:<value>`) raise a limit rather than toggle a capability:
`AddCustomApps`, `AddCustomObjects`, `AddCustomRelationships`, `AddCustomTabs`,
`AdditionalFieldHistory`, `CalloutSizeMB`, `ConcStreamingClients`, `FieldService`,
`MaxApexCodeSize`, `MaxCustomLabels`, `NumPlatformEvents`, `PlatformEventsPerDay`,
`StreamingEventsPerDay`, `SubPerStreamingTopic`, and similar.

## Feature-plus-setting pairs that trip people up

| Capability | Feature | Required setting |
| --- | --- | --- |
| Experience Cloud sites | `Communities` | `communitiesSettings.enableNetworksEnabled: true` |
| Omni-Channel | — | `omniChannelSettings.enableOmniChannel: true` |
| Multi-currency | `MultiCurrency` | `currencySettings.enableMultiCurrency: true` |
| Einstein bots | `Chatbot` | `botSettings.enableBots: true` |
| DevOps Center | `DevOpsCenter` | `devHubSettings.enableDevOpsCenterGA: true` |
| Data Cloud | `CustomerDataPlatform` | `customerDataPlatformSettings.enableCustomerDataPlatform: true` |
| Agentforce | `Einstein1AIPlatform` | `agentPlatformSettings.enableAgentPlatform: true` and `einsteinGptSettings.enableEinsteinGptPlatform: true` |
| Field Service (enhanced scheduling) | `FieldService:<n>` | `fieldServiceSettings.fieldServiceOrgPref: true` plus `o2EngineEnabled: true` |
| Lightning Web Security off (debug only) | — | `securitySettings.sessionSettings.lockerServiceNext: false` |

Any Metadata API settings type works. If a preference exists in Metadata API, it can be set here,
which makes `settings` strictly more expressive than `features`.

## Ready definition files

### 1. Base developer org (`config/project-scratch-def.json`)

```json
{
  "orgName": "vibe-force dev",
  "edition": "Developer",
  "hasSampleData": false,
  "features": ["EnableSetPasswordInApi", "AuthorApex", "DebugApex", "TransactionFinalizers"],
  "settings": {
    "lightningExperienceSettings": { "enableS1DesktopEnabled": true },
    "mobileSettings": { "enableS1EncryptedStoragePref2": false },
    "apexSettings": { "enableApexApprovalLockUnlock": true },
    "pathAssistantSettings": { "pathAssistantEnabled": false }
  }
}
```

### 2. CI org (`config/ci-scratch-def.json`) — minimal, fast, disposable

```json
{
  "orgName": "vibe-force ci",
  "edition": "Developer",
  "hasSampleData": false,
  "features": ["EnableSetPasswordInApi", "AuthorApex"],
  "settings": {
    "lightningExperienceSettings": { "enableS1DesktopEnabled": true },
    "securitySettings": { "passwordPolicies": { "minimumPasswordLifetime": false } }
  }
}
```

Pair with `--duration-days 1 --no-track-source`. Keep `features` short: every extra feature adds
provisioning time and one more reason for signup to fail.

### 3. Experience Cloud / community org (`config/community-scratch-def.json`)

```json
{
  "orgName": "vibe-force community",
  "edition": "Enterprise",
  "hasSampleData": false,
  "features": ["Communities", "Sites", "ServiceCloud", "Knowledge", "EnableSetPasswordInApi"],
  "settings": {
    "communitiesSettings": { "enableNetworksEnabled": true },
    "lightningExperienceSettings": { "enableS1DesktopEnabled": true },
    "experienceBundleSettings": { "enableExperienceBundleMetadata": true },
    "knowledgeSettings": { "enableKnowledge": true },
    "omniChannelSettings": { "enableOmniChannel": true },
    "caseSettings": { "systemUserEmail": "support@example.invalid" }
  },
  "objectSettings": {
    "case": { "sharingModel": "private" },
    "account": { "defaultRecordType": "default" }
  }
}
```

### 4. Revenue / CPQ-style org (`config/revenue-scratch-def.json`)

```json
{
  "orgName": "vibe-force revenue",
  "edition": "Enterprise",
  "features": [
    "CPQ",
    "CoreCpq",
    "SalesforcePricing",
    "ProductsAndSchedules",
    "OrderManagement",
    "AddCustomObjects:400",
    "AddCustomRelationships:100",
    "EnableSetPasswordInApi"
  ],
  "settings": {
    "orderSettings": { "enableOrders": true, "enableNegativeQuantity": true },
    "quoteSettings": { "enableQuote": true },
    "lightningExperienceSettings": { "enableS1DesktopEnabled": true }
  },
  "objectSettings": {
    "opportunity": { "sharingModel": "private", "defaultRecordType": "default" },
    "order": { "sharingModel": "controlledByParent" }
  }
}
```

CPQ-family features vary by contract; if `sf org create scratch` reports a feature is not
available to your Dev Hub, drop it and record the gap rather than guessing an alias.

### 5. Multi-currency + translation org (`config/intl-scratch-def.json`)

```json
{
  "orgName": "vibe-force intl",
  "edition": "Enterprise",
  "country": "DE",
  "language": "de",
  "features": [
    "MultiCurrency",
    "EntityTranslation",
    "CustomFieldDataTranslation",
    "StateAndCountryPicklist",
    "EnableSetPasswordInApi"
  ],
  "settings": {
    "currencySettings": { "enableMultiCurrency": true },
    "languageSettings": { "enableTranslationWorkbench": true, "enableEndUserLanguages": true },
    "addressSettings": { "countriesAndStates": { "countries": [] } },
    "lightningExperienceSettings": { "enableS1DesktopEnabled": true }
  }
}
```

Enabling multi-currency is irreversible in a real org; that is exactly why it belongs in a
scratch org definition rather than a sandbox you plan to keep.

### 6. Snapshot-based org (`config/snapshot-scratch-def.json`)

```json
{
  "orgName": "vibe-force from snapshot",
  "snapshot": "VFBase",
  "hasSampleData": false
}
```

No `edition`, no `features`, no `settings` — the snapshot already carries them. Create with a
generous wait: `sf org create scratch -f config/snapshot-scratch-def.json -v vf-devhub -w 20`.

### 7. Org-shape-based org (`config/shape-scratch-def.json`)

```json
{
  "orgName": "vibe-force from shape",
  "sourceOrg": "00DB1230000Ifx5",
  "features": ["Chatbot", "MultiCurrency", "PersonAccounts"],
  "settings": {
    "botSettings": { "enableBots": true },
    "currencySettings": { "enableMultiCurrency": true }
  }
}
```

`Chatbot`, `DevOpsCenter`, `MultiCurrency`, and `PersonAccounts` are deliberately excluded from
org shapes and must be re-declared.

## User definition file (extra scratch org users)

`sf org create user` takes its own definition file — a different schema from the scratch org
definition.

```json
{
  "Email": "vf-tester@example.invalid",
  "Username": "vf-tester@example.invalid",
  "LastName": "Tester",
  "profileName": "Standard User",
  "permsets": ["VF_App_User"],
  "generatePassword": true
}
```

```bash
sf org create user --definition-file config/user-def.json --set-alias vf-user \
  --set-unique-username --target-org vf-dev
sf org generate password --target-org vf-dev --length 25 --complexity 5
sf org generate password --target-org vf-dev --on-behalf-of vf-tester@example.invalid
```

`generatePassword` requires the `EnableSetPasswordInApi` feature in the scratch org definition.
`--complexity` accepts 3–5 (default 5); `--length` accepts 20–1000 (default 20).

## Naming and placement

| Constraint | Rule |
| --- | --- |
| Location | Anywhere the CLI can read. Salesforce Extensions for VS Code require `config/` |
| Name | Must end in `scratch-def.json` for the VS Code extensions to offer it |
| Version control | Check in the team file; keep personal overrides out of the repo or pass CLI flags |
| Convention in this harness | `config/project-scratch-def.json` (dev), `config/ci-scratch-def.json` (CI), `config/<purpose>-scratch-def.json` (everything else) |

## Validation before you commit

```bash
# JSON well-formedness and schema-shaped keys
node -e 'const d=require("./config/project-scratch-def.json"); if(!d.edition && !d.snapshot && !d.sourceOrg) throw new Error("need edition | snapshot | sourceOrg"); console.log("ok")'

# Real proof: provision a one-day org from it and throw it away
sf org create scratch -f config/project-scratch-def.json -v vf-devhub -a vf-defcheck -y 1 -w 15
sf org delete scratch -o vf-defcheck -p
```

A definition file is only verified by a successful `sf org create scratch`. Feature names that do
not exist, or that your Dev Hub is not entitled to, fail at signup time and nowhere earlier.
