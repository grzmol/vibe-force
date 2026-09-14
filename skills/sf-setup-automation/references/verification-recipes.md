# Verifying a Setup change

A Setup change is done when the org says it is. Three sources, in order of authority: the org's audit
trail, a metadata retrieve, and a functional probe.

## SetupAuditTrail

Object Reference, verbatim: "Represents changes you or other admins made in your org's Setup area for
at least the last 180 days. This object is available in API version 15.0 and later." Supported calls
are `query()` and `retrieve()` only.

| Field | Type | Meaning |
| --- | --- | --- |
| `Action` | string, Filter/Sort | The category of the change. A value of `PermSetCreate` means an admin created a permission set |
| `Display` | string, Nillable/Sort | The full sentence, e.g. "Created permission set MAD: with user license Salesforce" |
| `Section` | string, Nillable/Sort | The Setup area, e.g. `Manage Users`, `Company Profile` |
| `CreatedByContext` | string, API 48.0+ | The context of the change; `Einstein` when a cloud-to-cloud service made it |
| `CreatedByIssuer` | string | Reserved for future use |
| `DelegateUser` | string, API 35.0+ | The Login-As user who acted, blank otherwise |
| `CreatedBy.Name` / `CreatedBy.Username` | relationship | Who. "You can use SOQL joins to get the information you need more quickly" |

Aggregates are restricted: `SELECT count() FROM SetupAuditTrail` works, `SELECT count(Id) FROM
SetupAuditTrail` fails. Never build a check on the second form.

### Recipes

```bash
# everything in the last 30 minutes, newest first - what vf-setup audit runs
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" audit -o acme-dev --since 30m

# one Setup area only
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" audit -o acme-dev --since 2h --section "Manage Users"
```

```bash
# by category, when you know the Action prefix you expect
sf data query --target-org acme-dev --result-format json --query \
  "SELECT Action, Section, Display, CreatedDate, CreatedBy.Username FROM SetupAuditTrail \
   WHERE Action LIKE 'PermSet%' AND CreatedDate = LAST_N_DAYS:1 ORDER BY CreatedDate DESC LIMIT 50"

# who has been changing Setup outside the pipeline, over a release
sf data query --target-org acme-uat --result-format json --query \
  "SELECT CreatedBy.Username, Section, Action, Display, CreatedDate FROM SetupAuditTrail \
   WHERE CreatedDate = LAST_N_DAYS:14 ORDER BY CreatedDate DESC LIMIT 500"

# a Login-As session that changed something
sf data query --target-org acme-prod --result-format json --query \
  "SELECT DelegateUser, CreatedBy.Username, Action, Display, CreatedDate FROM SetupAuditTrail \
   WHERE DelegateUser != null AND CreatedDate = LAST_N_DAYS:7 ORDER BY CreatedDate DESC LIMIT 200"
```

`--since` accepts `30m`, `2h`, `3d` and is converted to an ISO datetime, because SOQL has date
literals for days (`LAST_N_DAYS:n`) but not for hours.

## Retrieve after the click

Some settings have a metadata representation even when the UI is the only way to set them. Always
try; a non-empty retrieve turns a manual change into a committable one.

```bash
# the settings area that owns the page, if any
sf project retrieve start --metadata "Settings:Case" --target-org acme-dev
sf project retrieve start --metadata "Settings" --target-org acme-dev        # every area the org exposes

# what changed against the branch
git status --short force-app
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js" outline force-app/main/default/settings/Case.settings-meta.xml
```

`Settings` files are one per area, named `<Area>.settings-meta.xml`; in a manifest the member is the
area name (`<name>Settings</name>` with `<members>Case</members>`). The Metadata API guide notes that
"[n]ot all feature settings are available in the Metadata API", which is exactly the population this
skill exists for - so an empty retrieve is an answer, not a failure.

If the retrieve is empty, record the destination in `.vibeforce/config.json` under
`setup.destinations` and say in the hand-off report that the change has no deployable form. That
sentence is what stops the next person searching for one.

## Functional probe

For a preference that changes runtime behaviour, assert the behaviour rather than the switch:

```bash
# a feature that gates an object or a field: does the describe see it now
sf sobject describe --sobject Account --target-org acme-dev --json | jq '.result.fields | length'

# a preference Apex can read
sf apex run --target-org acme-dev --file /tmp/probe.apex
```

```apex
// /tmp/probe.apex - throws when the preference did not take, so the exit code carries the answer
Organization org = [SELECT Id, IsSandbox, LanguageLocaleKey FROM Organization LIMIT 1];
System.debug(org);
System.assertEquals('en_US', org.LanguageLocaleKey, 'locale preference did not apply');
```

`vf-check smoke --target-org <alias>` runs the same style of probe as a gate, with a report in
`.vibeforce/reports/`.

## State files this feature writes

| File | Written by | Contents | Mode |
| --- | --- | --- | --- |
| `.vibeforce/state/metadata-types-<alias>.json` | `vf-setup check` | `types[]` from `describeMetadata`, `at`, `apiVersion`; 24 h TTL, `--refresh` to re-ask | 0600 |
| `.vibeforce/state/setup-gate.json` | `vf-setup check` | Last 50 `{path, key, alias, verdict, types, at}` records; read by the MCP guard | 0600 |

Neither holds a credential: the frontdoor URL never leaves the `serve` process. `vf-setup clean`
removes both. Both live under `.vibeforce/state/`, which the edit guard treats as generated and the
`.gitignore` template excludes.
