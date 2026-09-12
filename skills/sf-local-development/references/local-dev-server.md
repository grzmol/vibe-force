# Live Preview (Local Dev) Server Reference

Command syntax, complete flag tables, supported targets, reload semantics, and documented
limitations for `sf lightning dev app`, `sf lightning dev component`, and `sf lightning dev site`.

Salesforce renamed **Local Dev** to **Live Preview** in Spring '26. Command names are unchanged.

## 1. Commands

| Command | Purpose |
| --- | --- |
| `sf lightning dev app` | Preview a Lightning Experience app locally and in real time, without deploying it |
| `sf lightning dev component` | Preview LWCs in isolation |
| `sf lightning dev site` | Preview an Experience Builder (LWR) site locally and in real time |

All three are part of the Live Preview plugin, which the Salesforce CLI installs automatically.
Run `sf update` before a session to pick up the newest command versions.

## 2. `sf lightning dev app`

| Flag (long) | Short | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `--target-org` | `-o` | value | Yes (unless `target-org` config var is set) | Username or alias of the target org |
| `--name` | `-n` | value | No | Name of the Lightning Experience app; quote names containing spaces |
| `--device-type` | `-t` | value (`desktop`, `ios`, `android`) | No | Device to display the preview on |
| `--device-id` | `-i` | value | No | Mobile device id when `--device-type` is `ios`/`android`; defaults to the first available device |
| `--api-version` | - | value | No | Override the API version used for requests |
| `--flags-dir` | - | value | No | Import flag values from a directory |

```bash
sf lightning dev app --target-org vf-dev
sf lightning dev app --name "SDO - Consumer" --target-org vf-dev
sf lightning dev app --device-type ios --device-id "iPhone 15 Pro Max" --target-org vf-dev
```

Run without flags to get an interactive device and app picker. The command offers to enable Live
Preview in the org when it is not enabled yet.

Mobile previews require the platform tooling: Xcode with downloaded simulators for iOS, Android
Studio with an emulator for Android. The CLI prompts to install the Salesforce mobile app on the
virtual device when needed.

## 3. `sf lightning dev component`

| Flag (long) | Short | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `--target-org` | `-o` | value | Yes (Winter '26 and later; unless config var set) | Target org for the preview |
| `--name` | `-n` | value | No | Component to preview; quote names containing spaces |
| `--client-select` | `-c` | boolean | No | Launch the preview without preselecting a component |
| `--json` | - | boolean | No | Format output as JSON |
| `--api-version` | - | value | No | Override the API version |
| `--flags-dir` | - | value | No | Import flag values from a directory |

```bash
sf lightning dev component --target-org vf-dev
sf lightning dev component --name accountCard --target-org myscratch
```

The isolated preview supports platform modules: public Lightning Data Service wire adapters,
`@salesforce` scoped modules, and Apex controllers all resolve against the target org. The browser
toolbar offers device-dimension presets and custom resizing, a Performance Mode that hides page
chrome, and a Project Components sidebar listing previewable components.

Hot module replacement applies to component templates, CSS, JavaScript that does not change the
public API, internal component dependencies, and static resources used by the component.

## 4. `sf lightning dev site`

| Flag (long) | Short | Type | Required | Description |
| --- | --- | --- | --- | --- |
| `--target-org` | `-o` | value | Yes (unless config var set) | Target org for the preview |
| `--name` | `-n` | value | No | Experience Cloud LWR site name; must match a site in the org |
| `--get-latest` | - | boolean | No | Refresh the locally cached site bundle from the org |
| `--ssr` | - | boolean | No | **Not supported from Spring '26 - do not use** |
| `--api-version` | - | value | No | Override the API version |
| `--flags-dir` | - | value | No | Import flag values from a directory |

```bash
sf lightning dev site --target-org vf-dev
sf lightning dev site --name "Partner Central" --get-latest --target-org vf-dev
```

The command downloads a static bundle reflecting the current state of the site and caches it
locally; subsequent runs reuse the cache until `--get-latest` is passed. The site must be published
before it can be previewed, and only desktop previews are supported.

## 5. Reload matrix

| Local change | App / site preview | Component preview |
| --- | --- | --- |
| HTML attribute or markup edit | Automatic | Automatic |
| Component CSS edit (including SLDS styling hook values) | Automatic | Automatic |
| Adding `<lightning-button>` or another existing component reference | Automatic | Automatic |
| Importing a new custom LWC | Automatic | Automatic |
| Importing a new CSS-only component | Automatic | Automatic |
| JavaScript change inside a method, new/changed event handler | Automatic | Automatic |
| Adding or deleting a file in an existing bundle | Automatic (Spring '25 and later) | Automatic |
| New `@api` property or method | Deploy + restart server | Browser refresh |
| Wire adapter added/changed, GraphQL query changed | Deploy + restart server | Browser refresh |
| New `@salesforce` scoped module import | Deploy + restart server | Browser refresh |
| `.js-meta.xml` edit | Deploy + restart server | Deploy + browser refresh |
| Service component library revision | Deploy + restart server | Browser refresh |
| Apex, objects, flows, permission sets, layouts | Deploy (+ republish the site for `dev site`) | Deploy |

Only `.js`, `.html`, and `.css` files participate in automatic reload. Everything else needs a
manual step, and that step differs by preview mode: an app or site preview needs a deploy and a
server restart, a single-component preview needs only a browser refresh - except a `.js-meta.xml`
edit, which the documentation calls out as needing a deploy in every mode. For an Experience site
you must also republish the site after deploying, then restart the server.

## 6. Direction of change

| Direction | Behaviour |
| --- | --- |
| Local edit to a hot-reloadable file | Reflected in the preview, and the org reflects it for the duration of the session |
| Local edit to anything else | `sf project deploy start --target-org <alias>`, then restart |
| Change made directly in the org (for example saving component properties in App Builder) | Automatically applied to the live preview; pull it locally with `sf project retrieve start --target-org <alias>` |

## 7. Supported and unsupported

| Item | Status |
| --- | --- |
| Lightning web components | Supported |
| Aura components | Not supported in any preview |
| Lightning Experience apps (desktop) | Supported |
| Lightning Experience apps in iOS simulator / Android emulator | Supported |
| Experience Cloud LWR sites (desktop) | Supported, published sites only |
| Experience Cloud Aura-template sites | Not supported |
| Landing Pages | Not supported |
| Production orgs | Technically allowed; Salesforce recommends sandbox or scratch orgs only |
| Static-resource storage of preview builds | Removed in Spring '25 - builds no longer count against the 250 MB static resource limit |
| VS Code / Code Builder panel preview | Salesforce Live Preview extension: LWC preview GA, React preview beta |

## 8. Permissions and project requirements

| Requirement | Detail |
| --- | --- |
| Org permissions to enable Live Preview | **View Setup** and **Customize Application** |
| Project layout | An `lwc` directory inside a package directory, typically `force-app/main/default/lwc` |
| CLI | Salesforce CLI v2 with the bundled Live Preview plugin; `sf update` to refresh |
| Authentication | The target org must be authorized (`sf org login web --alias vf-dev`) |

## 9. Related commands used in the same loop

| Command | Purpose |
| --- | --- |
| `sf project deploy preview --target-org <alias>` | What would deploy, what conflicts, what is forceignored |
| `sf project deploy start --dry-run --target-org <alias>` | Server-side compile and tests without saving |
| `sf project retrieve preview --target-org <alias>` | What would be retrieved, including conflicts |
| `sf project retrieve start --target-org <alias>` | Pull org changes into the project |
| `sf org open --path <path> --target-org <alias>` | Open a specific page in the org |
| `sf org open --source-file <flexipage/flow path> --target-org <alias>` | Open local metadata in its Builder |
| `sf apex run --file <file.apex> --target-org <alias>` | Anonymous Apex probe |

## 10. vibe-force integration

| Harness element | Relationship to Live Preview |
| --- | --- |
| `vf-check local` | The offline gate (format, lint, analyzer, jest); Live Preview is manual, interactive verification and is not part of any gate |
| `vf-check deploy-validate` | The next step once the preview and the offline gate look right |
| Hook protection | Production aliases listed in `productionAliases` are blocked for deploys; run previews against `orgs.dev` |
| `.vibeforce/state/contract.md` | Apex method signatures the previewed component calls, fixed in wave 0 |

## Sources

- https://developer.salesforce.com/docs/platform/lwc/guide/get-started-test-components.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_lightning.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_lightning_dev_app.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_lightning_dev_component.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_lightning_dev_site.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_project_deploy_preview.html
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_org_open.html
