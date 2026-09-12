# Sandbox Operations Reference

Sandbox types, CLI flag tables, definition file options, and the post-refresh runbook.

Sources: Salesforce DX Developer Guide *Sandboxes* /
*Create a Sandbox Definition File* /
*Create, Clone, or Refresh a Sandbox*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_sandboxes.htm>),
*Enable Source Tracking in Sandboxes*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_setup_enable_source_tracking_sandboxes.htm>),
and the CLI command reference
(<https://github.com/salesforcecli/plugin-org/tree/main/messages>).

## Sandbox type comparison

| | Developer | Developer Pro | Partial Copy | Full |
| --- | --- | --- | --- | --- |
| `licenseType` value | `Developer` | `Developer_Pro` | `Partial` | `Full` |
| Data copied | metadata only | metadata only | metadata + template-selected sample data | metadata + all data |
| Data storage | 200 MB (400 MB with `SandboxStorage` feature) | 1 GB (2 GB with `SandboxStorage` feature) | 5 GB | same as production |
| File storage | 200 MB | 1 GB | 5 GB | same as production |
| Records per selected object | n/a | n/a | 10,000 (template-driven) `[unverified]` | all |
| `templateId` | not available | not available | required | optional |
| Minimum refresh interval | 1 day `[unverified]` | 1 day `[unverified]` | 5 days `[unverified]` | 29 days `[unverified]` |
| Source tracking | supported (default on) | supported (default on) | **not supported** | **not supported** |
| `historyDays` | n/a | n/a | n/a | supported |
| `copyArchivedActivities` | n/a | n/a | n/a | supported (purchased option) |
| `copyChatter` | supported | supported | supported | supported |
| Typical harness role | per-developer workspace, org-dependent unlocked package dev | workspace with seeded volume | UAT | release staging, performance, final validate rehearsal |

Storage figures and the source-tracking matrix come from the DX Developer Guide pages cited
above. The minimum refresh intervals and the Partial Copy per-object record cap are documented in
Salesforce Help ("Sandbox Licenses and Storage Limits by Type",
<https://help.salesforce.com/s/articleView?id=platform.create_test_instance.htm&type=5>), which
blocks automated retrieval; they are marked `[unverified]` above and must be re-checked in the
Help article before being quoted to a customer.

## Permissions

| Action | Permission required |
| --- | --- |
| View a sandbox | View Setup and Configuration |
| Create, refresh, activate, delete a Developer or Developer Pro sandbox | Manage Dev Sandboxes |
| Create, refresh, activate, delete any sandbox type | Manage Sandboxes |
| Enable source tracking for all Dev/Dev Pro sandboxes | access to the Dev Hub Setup page in the production org |

Source tracking for *all* Developer and Developer Pro sandboxes is a toggle on the production
org's Dev Hub Setup page and is available in Enterprise, Performance, and Unlimited editions;
Professional and Database.com editions can only enable it per sandbox. Existing sandboxes do not
gain tracking until they are refreshed. Disabling the toggle deletes all source tracking
information when the sandbox is next refreshed.

## `sf org create sandbox`

```
sf org create sandbox -o <prod> [-f <def.json>] [-n <name>] [-l Developer|Developer_Pro|Partial|Full]
  [-a <alias>] [-s] [-w <minutes> | --async] [-i <seconds>] [--no-prompt] [--no-track-source]
  [--source-sandbox-name <name> | --source-id <0GQ...>] [--json]
```

| Flag | Short | Meaning |
| --- | --- | --- |
| `--target-org` | `-o` | **Required.** Username or alias of the **production org that holds the sandbox licenses** |
| `--definition-file` | `-f` | Path to the sandbox definition file |
| `--name` | `-n` | Sandbox name; unique alphanumeric, 10 or fewer characters; cannot be reused while a same-named sandbox is being deleted |
| `--license-type` | `-l` | `Developer`, `Developer_Pro`, `Partial`, `Full` |
| `--alias` | `-a` | Alias assigned to the resulting username of the user running the command |
| `--set-default` | `-s` | Make the sandbox the default target org |
| `--wait` | `-w` | Minutes to poll. Default 6, which is usually too low; use 30–60 |
| `--poll-interval` | `-i` | Seconds between status polls; must be smaller than `--wait` in seconds |
| `--async` | | Return the job id immediately |
| `--no-prompt` | | Skip the interactive "Is the configuration correct?" confirmation — required in CI |
| `--no-track-source` | | Disable source tracking (performance win for CI-only sandboxes) |
| `--source-sandbox-name` | | Clone from this existing sandbox (mutually exclusive with `--source-id` and `--license-type`) |
| `--source-id` | | Clone from this `SandboxInfo.Id` |

Either a definition file, or `--name` plus `--license-type`, is required. Anything beyond name and
license type (`apexClassName`, `templateId`, `activationUserGroupName`, …) requires a definition
file.

Username derivation: production `user@example.com` becomes `user@example.com.<sandboxname>`. If
that is not unique, Salesforce prepends characters, producing e.g.
`00x7Vquser@example.com.dev1` — which is exactly why `--alias` is mandatory in practice.

## `sf org refresh sandbox`

```
sf org refresh sandbox -o <prod> [-n <name>] [-f <def.json>] [--no-auto-activate]
  [-w <minutes> | --async] [-i <seconds>] [--no-prompt]
  [--source-sandbox-name <name> | --source-id <0GQ...>] [--json]
```

| Flag | Meaning |
| --- | --- |
| `--name` / `-n` | The existing sandbox to refresh. Required unless the definition file supplies `sandboxName` |
| `--definition-file` / `-f` | Override configuration during refresh (license type, template id, post-copy class) |
| `--no-auto-activate` | Sandboxes auto-activate after a successful refresh; this defers activation to manual control |
| `--source-sandbox-name` / `--source-id` | Change the refreshed sandbox's source org to another sandbox; its metadata is updated from that new source |

You cannot rename a sandbox on refresh. To rename: `sf org delete sandbox`, then
`sf org create sandbox` with the new name. If `--name` and the definition file disagree, the CLI
warns and uses `--name`.

## `sf org resume sandbox` / `sf org delete sandbox`

```
sf org resume sandbox [-n <name> | -i <jobid>] [-l] [-o <prod>] [-w <minutes>] [--json]
sf org delete sandbox -o <sandbox-alias> [-p] [--json]
```

- `sf org resume sandbox` checks status and, once ready, authorizes the sandbox for CLI use. The
  create job id is valid for 24 hours; `--use-most-recent` (`-l`) skips the id.
- `sf org delete sandbox --target-org` takes the **sandbox** alias/username (unlike create and
  refresh). Both the sandbox and its production org must already be authenticated with the CLI.
  `--no-prompt` (`-p`) is required in scripts.

## Sandbox definition file options

| Option | Required | Notes |
| --- | --- | --- |
| `sandboxName` | Yes | Unique alphanumeric, 10 or fewer characters |
| `licenseType` | Yes for creation | `Developer`, `Developer_Pro`, `Partial`, `Full`. Mutually exclusive with `sourceSandboxName` and `sourceId` |
| `sourceId` | Yes for cloning | `SandboxInfo.Id` of the sandbox being cloned |
| `sourceSandboxName` | Yes for cloning | Name of the sandbox being cloned |
| `templateId` | Yes for Partial, optional for Full | 15-character id starting `1ps`, taken from the sandbox template URL. Not available for Developer / Developer Pro |
| `apexClassId` | No | Id of the post-copy Apex class. Mutually exclusive with `apexClassName` |
| `apexClassName` | No | Name of the post-copy Apex class (implements `SandboxPostCopy`) |
| `activationUserGroupId` | No | Public group id whose members may access the sandbox. Mutually exclusive with `activationUserGroupName` |
| `activationUserGroupName` | No | Public group name. The creating user is added automatically |
| `autoActivate` | No | `true` activates a refresh immediately |
| `description` | No | 1000 or fewer characters |
| `features` | No | Only valid value today is `['SandboxStorage']`: raises Developer 200 MB → 400 MB and Developer Pro 1 GB → 2 GB. Not usable with Partial or Full. Not needed when cloning |
| `historyDays` | No | Full sandboxes only. `-1` (all), `0` (default), `10`, `20`, `30`, `60`, `90`, `120`, `150`, `180` |
| `copyArchivedActivities` | No | Full sandboxes only; requires a purchased option |
| `copyChatter` | No | `true` copies archived Chatter data |

### Example definition files

`config/dev-sandbox-def.json` — per-developer workspace with post-copy automation:

```json
{
  "sandboxName": "vfdev1",
  "licenseType": "Developer",
  "description": "vibe-force developer workspace",
  "apexClassName": "VFSandboxPostCopy",
  "activationUserGroupName": "VF Developers",
  "features": "['SandboxStorage']",
  "copyChatter": false
}
```

`config/int-sandbox-def.json` — integration sandbox:

```json
{
  "sandboxName": "vfint",
  "licenseType": "Developer_Pro",
  "description": "vibe-force integration",
  "apexClassName": "VFSandboxPostCopy"
}
```

`config/uat-sandbox-def.json` — Partial Copy driven by a template:

```json
{
  "sandboxName": "vfuat",
  "licenseType": "Partial",
  "templateId": "1ps1Q000000XXXXX",
  "description": "vibe-force UAT",
  "apexClassName": "VFSandboxPostCopy",
  "copyChatter": true
}
```

`config/full-sandbox-def.json` — release staging:

```json
{
  "sandboxName": "vffull",
  "licenseType": "Full",
  "description": "vibe-force release staging",
  "historyDays": 30,
  "copyArchivedActivities": false,
  "apexClassName": "VFSandboxPostCopy"
}
```

`config/clone-sandbox-def.json` — clone an existing sandbox:

```json
{
  "sandboxName": "vfdev1c",
  "sourceSandboxName": "vfdev1",
  "description": "clone of vfdev1 for a spike"
}
```

Definition-file conflict rules the CLI enforces: you cannot set both `apexClassId` and
`apexClassName`, both `activationUserGroupId` and `activationUserGroupName`, both `SourceId` and
`SourceSandboxName`, or combine `SourceId`/`SourceSandboxName` with `LicenseType`. Passing
`--source-id`/`--source-sandbox-name` **and** a definition file that also carries the option is
rejected.

## Post-copy Apex class

```apex
public with sharing class VFSandboxPostCopy implements SandboxPostCopy {
    public void runApexClass(SandboxContext ctx) {
        neutralizeIntegrations();
        scrubEmails();
        System.debug(LoggingLevel.INFO, String.format(
            'VF post-copy complete: org={0} sandbox={1}',
            new List<Object>{ ctx.organizationId(), ctx.sandboxName() }));
    }

    private void neutralizeIntegrations() {
        List<VF_Integration_Setting__c> rows = [
            SELECT Id, Endpoint__c, Active__c
            FROM VF_Integration_Setting__c
            WITH USER_MODE
            LIMIT 1000
        ];
        for (VF_Integration_Setting__c row : rows) {
            row.Endpoint__c = 'https://sandbox.example.invalid/api';
            row.Active__c = false;
        }
        if (!rows.isEmpty()) {
            update as user rows;
        }
    }

    private void scrubEmails() {
        List<Contact> contacts = [
            SELECT Id, Email
            FROM Contact
            WHERE Email != NULL
            WITH USER_MODE
            LIMIT 10000
        ];
        for (Contact c : contacts) {
            c.Email = c.Id + '@sandbox.example.invalid';
        }
        if (!contacts.isEmpty()) {
            Database.update(contacts, false, AccessLevel.USER_MODE);
        }
    }
}
```

```apex
@IsTest
private class VFSandboxPostCopyTest {
    @IsTest
    static void runsWithoutSandboxContext() {
        // SandboxPostCopy runs asynchronously in a real copy; in tests, invoke it directly.
        insert new VF_Integration_Setting__c(
            Name = 'Billing', Endpoint__c = 'https://prod.example.com', Active__c = true);

        Test.startTest();
        new VFSandboxPostCopy().runApexClass(null);
        Test.stopTest();

        VF_Integration_Setting__c s = [
            SELECT Endpoint__c, Active__c FROM VF_Integration_Setting__c LIMIT 1];
        System.assertEquals(false, s.Active__c, 'integration must be disabled after post-copy');
        System.assert(s.Endpoint__c.contains('example.invalid'), 'endpoint must be neutralized');
    }
}
```

The post-copy class must exist and be deployed in the **source** org (production for a create,
the source sandbox for a clone) before it can be referenced by `apexClassName`. It runs on every
create, clone, and refresh. Keep it bulkified and under governor limits — see skills
`sf-governor-limits` and `sf-apex-testing`.

## Post-refresh runbook

A refresh resets the sandbox to the source org's metadata and (for Partial/Full) data. Everything
environment-specific has to be reapplied.

| # | Task | Command / location | Automatable in post-copy? |
| --- | --- | --- | --- |
| 1 | Re-authorize the CLI | `sf org login web --alias vf-int --instance-url https://test.salesforce.com` | no |
| 2 | Reset the alias to the new username | `sf alias set vf-int=user@example.com.vfint` | no (script it) |
| 3 | Deactivate integration users / scheduled jobs | post-copy class or `sf apex run` | yes |
| 4 | Rewrite integration endpoints | custom settings / custom metadata via post-copy | yes for custom settings; custom metadata needs a deploy |
| 5 | Re-point named credentials and external credentials | `sf project deploy start --metadata NamedCredential ExternalCredential` | no — secrets are not copied |
| 6 | Re-enter secrets (external credential principals, connected app consumer secrets) | Setup UI or a secure deploy | no |
| 7 | Mask or scrub PII | Salesforce Data Mask (`DataMaskUser` permission) or post-copy Apex | partly |
| 8 | Fix user emails and email deliverability | Setup > Deliverability = System email only; post-copy email rewrite | yes for records |
| 9 | Reassign permission sets / permission set groups | `sf org assign permset --name ... --target-org vf-int` | yes |
| 10 | Reactivate required flows / scheduled paths | deploy `FlowDefinition` with `activeVersionNumber`; see skill `sf-deployment-strategies` | no |
| 11 | Re-enable source tracking if it was toggled | Sandbox Settings page, then `sf org enable tracking --target-org vf-int` | no |
| 12 | Reset tracking baseline | `sf project reset tracking --target-org vf-int --no-prompt` | no |
| 13 | Redeploy in-flight feature branches | `sf project deploy start --source-dir force-app --target-org vf-int` | no |
| 14 | Verify | `node "$VF_ROOT/scripts/checks/vf-check.mjs" smoke --target-org vf-int` | n/a |

Sandbox email deliverability defaults to "System email only" after a refresh, which is the safe
default — do not widen it without an explicit reason.

## Source tracking in sandboxes

```bash
sf org enable tracking  --target-org vf-int     # allow CLI tracking for this org
sf org disable tracking --target-org vf-int
sf project deploy preview   --target-org vf-int
sf project retrieve preview --target-org vf-int
sf project reset tracking  --target-org vf-int --no-prompt
sf project delete tracking --target-org vf-int --no-prompt
```

`sf project reset tracking` deletes or overwrites all existing source tracking files; afterwards
`sf project deploy preview` returns no results even if real conflicts exist. Use it only when the
baseline is known-bad (post-refresh, or after a manual org change you deliberately accept).

`sf project delete tracking` removes only the local tracking files, leaving the org's
`SourceMember` history intact.

Source tracking is not available in Partial Copy or Full sandboxes. In those orgs use
manifest-driven deploys (`--manifest package.xml`) and `sf project deploy start --dry-run` for
drift detection; conflict detection is your pipeline's job, not the CLI's.

## Cost and quota management

| Lever | Effect |
| --- | --- |
| Prefer scratch orgs for feature work | Sandbox licences are finite and per-contract; scratch orgs draw on Dev Hub allocations that reset daily |
| One Developer sandbox per developer, refreshed on demand | Avoids Full-sandbox contention |
| `SandboxStorage` feature instead of upgrading the licence type | Doubles Developer / Developer Pro data storage without a Partial licence |
| `--no-track-source` on CI sandboxes | Removes `SourceMember` polling overhead from every deploy |
| Delete unused sandboxes promptly | Frees the licence for a new sandbox of the same type |
| `historyDays: 0` on Full sandboxes | Shortest copy time when object history is not under test |
| Template-scoped Partial Copy | Copies only the objects UAT actually exercises |

## Sandbox vs scratch org, decided

Use a **scratch org** when the shape can be expressed declaratively and the org is disposable:
feature branches, CI, package installation tests, upgrade rehearsals.

Use a **Developer or Developer Pro sandbox** when the work depends on production configuration
you have not (yet) captured in source — the canonical case being org-dependent unlocked packages,
where dependency validation happens at install time in an org that already carries the
unpackaged metadata (skill `sf-packaging-release`).

Use a **Partial Copy or Full sandbox** when the question under test is about production *data* or
production *scale*, not about metadata. Neither supports source tracking, so treat them as deploy
targets in the promotion pipeline rather than development environments.
