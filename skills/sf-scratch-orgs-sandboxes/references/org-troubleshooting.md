# Org Troubleshooting Reference

Failure modes for scratch org signup, snapshots, org shapes, sandboxes, and source tracking, with
the diagnostic command and the fix.

Sources: Salesforce DX Developer Guide *Scratch Org Error Codes*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs_error_codes.htm>),
*Troubleshoot Org Shape*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_shape_limitations.htm>),
*Scratch Org Snapshots*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_snapshots_intro.htm>),
*Resolve Conflicts Between Your Local Project and Org*
(<https://developer.salesforce.com/docs/atlas.en-us.262.0.sfdx_dev.meta/sfdx_dev/sfdx_dev_source_tracking_resolve_conflicts.htm>),
and the CLI plugin error messages
(<https://github.com/salesforcecli/plugin-org/tree/main/messages>).

## Scratch org signup error codes

These are the `SignupRequest`/`ScratchOrgInfo` error codes surfaced by `sf org create scratch`.
Read them from the Dev Hub when the CLI output is terse:

```bash
sf data query --target-org vf-devhub --query "
  SELECT Id, Status, ErrorCode, SignupUsername, CreatedDate, Description
  FROM ScratchOrgInfo
  ORDER BY CreatedDate DESC
  LIMIT 10"
```

| Code | Meaning | Action |
| --- | --- | --- |
| `C-1007` | Duplicate username | Stop pinning `username` in the definition file, or add a unique suffix yourself |
| `C-1015` | Error establishing the new org's My Domain (subdomain) settings | Retry; if persistent, Salesforce Support |
| `C-1016` | OAuth connected app for proxy signup misconfigured | Verify the connected app's consumer key, callback URL, and certificate expiry (`--client-id`) |
| `C-1018` | Invalid subdomain value provided during signup | Remove the offending value from the definition file |
| `C-1019` | Subdomain in use | Choose a new subdomain value |
| `C-1020` | Template not found (missing or deleted) | Fix or drop `template` |
| `C-1033` | Template is the wrong version | Recreate the template |
| `C-1034` | Cannot create the org | Salesforce Support |
| `C-9998` | Not a valid scratch org | Salesforce Support |
| `C-9999` | Generic fatal error | Retry once, then Salesforce Support |
| `S-1017` | Namespace is not registered | Link the Developer Edition org that owns the namespace to the Dev Hub |
| `S-2006` | Invalid country | Use a two-character ISO-3166 Alpha-2 code in `country` |
| `SH-0001` | Cannot create from org shape — Dev Hub not authorized by the source org | Source org admin adds your Dev Hub org id under Setup > Org Shape |
| `SH-0002` | No org shape exists for the specified `sourceOrg` | `sf org create shape --target-org <source>` |
| `SH-0003` | Org shape was created on a previous Salesforce release and is outdated | Recreate the shape |
| `SH-9999` | Cannot validate org shape, fatal | Salesforce Support |
| `SN-0001` | Snapshot has expired | Recreate the snapshot (they expire after 90 days) |
| `SN-0002` | Snapshot does not belong to the specified Dev Hub | Pass the Dev Hub that owns the snapshot via `--target-dev-hub` |
| `VR-0001` | Cannot create the scratch org, transient | Retry later |
| `VR-0002` / `VR-0003` | Invalid `release` value | `release` accepts only `preview` or `previous`, and only during a release transition window |

## Scratch org creation troubleshooting table

| Symptom | Likely cause | Diagnostic | Fix |
| --- | --- | --- | --- |
| `No default dev hub found` | No `target-dev-hub` config variable and no `-v` flag | `sf config get target-dev-hub` | `sf config set target-dev-hub=vf-devhub --global` or pass `-v` |
| Create fails naming an unknown feature | Typo, or the feature is not licensed to your Dev Hub | Compare against *Scratch Org Features* in the DX guide | Remove the feature; move the capability into `settings` if a Metadata API setting exists |
| Create fails on a `settings` key | Setting name is not a Metadata API `*Settings` type, or a child field is wrong | Check the type in Metadata API docs; skill `sf-project-structure` | Correct the camelCase type name and field |
| `ActiveScratchOrgs` limit reached | Allocation exhausted by live or abandoned orgs | `sf limits api display --target-org vf-devhub` | Delete unneeded orgs; `sf org list --all` then `sf org delete scratch -p`; or delete `ActiveScratchOrg` records in the Dev Hub |
| `DailyScratchOrgs` limit reached | Rolling 24-hour create budget exhausted | same | Wait; reduce CI matrix width; reuse an org via the idempotent-recreate pattern |
| Duration rejected | `--duration-days` outside 1–30 | — | Use 1–30; default is 7 |
| Command times out with a job id | Provisioning slower than `--wait` | — | `sf org resume scratch --job-id <id> --wait 20`, or `--use-most-recent` |
| Snapshot-based create very slow | Expected: snapshot restore is slower than edition signup | — | Raise `--wait` to 20+ |
| Namespaced org cannot be snapshotted | Documented restriction | — | Create the snapshot from a non-namespaced org, or use an org shape |
| Snapshot lacks named credentials | Connected apps, named credentials, and external credentials are deliberately not copied | — | Deploy them after creation; re-enter secrets |
| `EnableSetPasswordInApi` errors on `sf org generate password` | Feature missing from the definition file | — | Add `EnableSetPasswordInApi` to `features` |
| Package install into a scratch org clashes on namespace | Dev Hub has a namespace and the org inherited it | `sf org display --verbose` | Recreate with `--no-namespace` |
| 2GP ancestor metadata unexpectedly present | Scratch org includes 2GP ancestors by default | — | `sf org create scratch --no-ancestors` |
| Expired trial org breaks `sf org list shape` | `ERROR running org list shape: Error authenticating with the refresh token due to: inactive user` / `expired access/refresh token` | `sf org list --all` | `sf org logout --target-org <expired>` then re-run `sf org list shape` |
| Experience Cloud site missing after shape-based create | `Required fields are missing: [Welcome Email Template, Change Password Email Template, ...]` | — | Add the Experience Cloud feature + `communitiesSettings` to the definition and deploy the templates |
| Field Service features absent from a shape-based org | Known shape gap | — | Add `fieldServiceSettings.fieldServiceOrgPref` plus `o2EngineEnabled` (both features) or `optimizationServiceAccess` (integration only) |
| DevOps Center absent from a shape-based org | Deliberately toggled off for legal reasons | — | Add the `DevOpsCenter` feature and `devHubSettings.enableDevOpsCenterGA: true` |

## Snapshot troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `sf org create snapshot` rejected | Source org is namespaced, or was itself created from a snapshot | Build the seed org without a namespace and not from a snapshot |
| Snapshot stuck in a non-`Active` status | Creation still running, or failed | `sf org get snapshot --snapshot <name> --target-dev-hub vf-devhub`; on `Error`, delete and recreate |
| Snapshot name already exists | Names are unique per Dev Hub | `sf org delete snapshot --snapshot <name> --target-dev-hub vf-devhub --no-prompt` first |
| `ActiveOrgSnapshots` exhausted | Snapshot allocation equals the active scratch org allocation for the edition | `sf org list limits --target-org vf-devhub`; delete stale snapshots |
| Snapshot silently stale | Snapshots are static point-in-time copies | Rebuild nightly from `main` (see `org-lifecycle-scripts.md` §5) |
| Snapshot data missing after 100 days | Snapshot data retention is 100 days from creation; expired snapshots lose data 10 days after expiry | Recreate |
| Cannot see a colleague's snapshot | Non-admins see only their own snapshots | Dev Hub admin grants View All Records (delete needs Modify All Records, Salesforce licence only) |

## Sandbox troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The sandbox name "<n>" should be 10 or fewer characters` | Name too long | Shorten; alphanumeric only |
| `The sandbox name "<n>" could not be found in production org "<o>"` | Wrong name/casing, or wrong production org | `sf org list` to list sandboxes; check `--target-org` points at the licence-holding production org |
| `The poll interval (<n> seconds) can't be larger that wait (<m> in seconds)` | `--poll-interval` exceeds `--wait` | Lower `--poll-interval` or raise `--wait` |
| `The sandbox request configuration isn't acceptable` | Interactive confirmation answered no | Pass `--no-prompt` in scripts |
| `You can't specify both the --source-id and --definition-file flags, and also include the "SourceId" option in the definition file` | Clone source declared twice | Pick one mechanism |
| `You can't specify both 'apexClassId' and 'apexClassName' in the definition file at the same time` | Post-copy class declared twice | Keep `apexClassName` |
| `Unable to find the ID of the Apex class "<n>"` | Post-copy class not present in the source org | Deploy the class to production (or the source sandbox) first |
| `Unable to find the ID of the activation user group "<n>"` | Public group missing in the source org | Create the group first |
| `The org with username: <u> is not known by the CLI to be a sandbox` | Sandbox or its production org not authenticated locally | Re-authenticate both, then retry the delete |
| Command returns before the sandbox is ready | Default `--wait` is 6 minutes; sandboxes are queued | `sf org resume sandbox --name <n> --target-org <prod> --wait 60` |
| `We found multiple sandbox processes for "<n>" in a resumable state` | Several create/refresh jobs for the same name | Resume the specific job: `sf org resume sandbox --job-id <0GR...> --target-org <prod>` |
| Name cannot be reused right after deletion | Deletion still in progress | Wait, or choose a different name |
| Source tracking unavailable | Partial Copy / Full sandbox, or Dev Hub toggle off, or sandbox not refreshed since enabling | Use manifest deploys, or enable on the Sandbox Settings page and refresh |
| Integrations firing against production after a refresh | Post-refresh tasks skipped | Run the post-refresh runbook in `sandbox-operations.md`; automate the deterministic parts in `SandboxPostCopy` |

## Source tracking recovery

Decision order when `deploy`/`retrieve` reports conflicts:

1. `sf project deploy preview --target-org <org>` — see exactly which components conflict, which
   are pending deletion, and which are force-ignored.
2. Inspect the real difference. `sf project retrieve start --metadata <Type>:<Name>` into a
   scratch branch, `git diff`, decide.
3. Overwrite deliberately, one component at a time:
   - keep local: `sf project deploy start --metadata ApexClass:WidgetClass --ignore-conflicts --target-org <org>`
   - keep org: `sf project retrieve start --metadata ApexClass:WidgetClass --ignore-conflicts --target-org <org>`
4. Re-run `sf project deploy preview`; expect no conflicts.
5. Only then deploy the rest: `sf project deploy start --target-org <org>`.

`sf project reset tracking --target-org <org> --no-prompt` is the last resort. It deletes or
overwrites all existing tracking files, after which `sf project deploy preview` returns no results
even where real conflicts exist. Legitimate uses: immediately after a sandbox refresh, or when
adopting an org whose history you are explicitly discarding.

To rewind to a specific revision instead of wiping:

```bash
sf data query --use-tooling-api --target-org vf-dev --query \
  "SELECT MemberName, MemberType, RevisionCounter FROM SourceMember ORDER BY RevisionCounter DESC LIMIT 20"
sf project reset tracking --revision 30 --target-org vf-dev --no-prompt
```

`sf project delete tracking --target-org vf-dev --no-prompt` wipes only local tracking files; the
org's `SourceMember` history is untouched, so the next preview re-derives remote changes.

Performance note from the CLI docs: source tracking costs conflict checks, `SourceMember`
polling, and file system work on every deploy. In orgs that exist only to run a CI job, create
them with `--no-track-source`.

## Release transition (`preview` / `previous`)

`release` is valid only inside a transition window, and its meaning depends on the Dev Hub's own
version:

| Dev Hub version | `preview` | `previous` |
| --- | --- | --- |
| Already upgraded to the latest release | Error — Dev Hub is already latest | Prior Dev Hub version |
| Still on the GA release | The newly released version following the Dev Hub's | Error — previous version unavailable |

Check the Dev Hub's instance at <https://status.salesforce.com> before setting `release`. Omitting
it always yields a scratch org on the Dev Hub's own release. Windows are published in *Select the
Salesforce Release for a Scratch Org*; the Winter '27 window ran 2026-08-30 to 2026-10-10.

## Escalation checklist

Before contacting Salesforce Support, collect:

```bash
sf --version
sf org display --target-org <alias> --verbose --json > /tmp/org.json
sf limits api display --target-org vf-devhub --json > /tmp/limits.json
sf data query --target-org vf-devhub --json --query "
  SELECT Id, Status, ErrorCode, SignupUsername, CreatedDate
  FROM ScratchOrgInfo ORDER BY CreatedDate DESC LIMIT 5" > /tmp/signups.json
SF_LOG_LEVEL=debug sf org create scratch -f config/project-scratch-def.json -v vf-devhub -a probe -y 1 -w 5 2> /tmp/create.log
```

Attach the definition file, the `ErrorCode` from `ScratchOrgInfo`, the Dev Hub org id, and
`/tmp/create.log`. For CLI debugging conventions see skill `sf-debugging-logs`; for auth failures
see skill `sf-cli-operations`.
