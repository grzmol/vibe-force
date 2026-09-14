# The browser loop

Everything in this file is checked against `@playwright/mcp` 0.0.80 (`playwright-core`
1.63.0-alpha-2026-08-31), started as vibe-force starts it: `--headless --isolated`. Tool names are
the ones the server reports over `tools/list` - 24 tools with the default capability set.

## Tools, and what they cost you

| Tool | Read or write | Use it for |
| --- | --- | --- |
| `browser_navigate` | write | The hand-off URL, and nothing that carries a session id |
| `browser_navigate_back` | write | Leaving a Setup detail page |
| `browser_snapshot` | read | The accessibility tree. This is the input to every decision |
| `browser_find` | read | Locating an element by text when the snapshot is large |
| `browser_click` | write | Buttons, links, tabs, tree nodes |
| `browser_type` | write | One field, when `fill_form` is too blunt |
| `browser_fill_form` | write | Several fields in one call; `textbox` and `slider` values resolve `--secrets` names |
| `browser_select_option` | write | `<select>`; a Lightning combobox is a listbox, so click it instead |
| `browser_press_key` | write | `Escape` to dismiss a modal, `Enter` to submit |
| `browser_wait_for` | read | Text appearing or disappearing - the only correct way to wait |
| `browser_take_screenshot` | read | Evidence of the saved state |
| `browser_console_messages`, `browser_network_requests` | read | Why a save silently failed |
| `browser_evaluate`, `browser_run_code_unsafe` | write | Nothing, in a Setup session. The guard asks first |
| `browser_tabs`, `browser_close` | write | Closing releases the isolated profile and its cookies |

`--isolated` means the profile is in memory: when the browser closes, the Salesforce session is
gone. That is the intended lifecycle - one hand-off, one change, one close.

## Refs are snapshot-scoped

A `ref` such as `e42` belongs to the snapshot that produced it. Lightning re-renders on nearly every
interaction, so:

```text
browser_snapshot            -> ref=e17 for "Edit"
browser_click  ref=e17      -> page re-renders
browser_click  ref=e23      # WRONG: e23 came from the pre-click snapshot
browser_snapshot            # RIGHT: re-read, then act
```

Symptom of using a stale ref is an error naming the ref, not a wrong click. Re-snapshot and retry
once; if the ref is stable and the action still fails, the element is disabled or covered by a modal.

## Waiting

| Situation | Do | Never |
| --- | --- | --- |
| Page still loading | `browser_wait_for` on text that only the loaded page has | Fixed sleep |
| Save in flight | `browser_wait_for` on the toast text, then snapshot | Screenshot immediately |
| Spinner | Wait for the spinner text to disappear (`textGone`) | Poll the snapshot in a loop |
| Slow org | Raise `--timeout-navigation` when starting the server | Retry `browser_navigate` |

Lightning shows a saved-looking page while a save is still validating server-side. The toast is the
earliest honest signal, and `SetupAuditTrail` is the only conclusive one.

## Classic Setup pages are in an iframe

Lightning Experience renders many Setup nodes as a Visualforce page inside an iframe. The snapshot
shows the frame and its contents together, and refs inside it work without switching context. Two
consequences:

- The heading you see in the tab bar may come from the outer Lightning shell, while the fields come
  from the inner frame. Assert on a field label, not on the page title.
- A modal opened by the inner page can be behind the outer shell's overlay. `browser_press_key`
  `Escape` clears a stuck overlay more reliably than clicking a close button.

## Tables and long forms

Setup lists paginate and virtualise. Do not scroll looking for a row: use the list's own filter box,
then `browser_find` the row text. For a form, `browser_fill_form` with every field in one call, then
one snapshot - each separate `browser_type` gives Lightning another chance to re-render.

## What the guards do

`scripts/lib/mcp-guards.js`, matcher `mcp__.*`, handler `scripts/hooks/pre-mcp-guard.js`.

| Rule | Trigger | Decision |
| --- | --- | --- |
| `browser-credential-url` | Any `browser_*` argument containing `sid=`, `secur/frontdoor.jsp`, `/services/oauth2/singleaccess`, `access_token=` or a `force://` URL | **deny**, with the `vf-setup serve` replacement; the denial prints the URL redacted |
| `browser-prod-target` | A production alias anywhere in the arguments, at any nesting depth | **deny**; `ask` when `hooks.blockProductionDeploy` is off |
| `browser-setup-ungated` | A `lightning/setup/` URL on an org host with no matching record in `.vibeforce/state/setup-gate.json` | note: run `vf-setup check` first |
| `browser-page-script` | `browser_run_code_unsafe` always; `browser_evaluate` while a Setup gate record exists | ask |

Org hosts are `*.my.salesforce.com` (sandboxes included), `*.lightning.force.com`, `*.my.site.com`
and `*.visualforce.com`. `developer.salesforce.com` is documentation, not an org, and passes.

`hooks.mode` applies as everywhere else: `off` disables the guard, `minimal` keeps denials and drops
notes.

## A complete change, end to end

```text
# 1. gate
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" check --path lightning/setup/<Node>/home -o acme-dev
# 2. hand-off, in the background; it exits when the browser spends it
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" serve --path lightning/setup/<Node>/home -o acme-dev --ttl 180 --json
# 3. drive
browser_navigate      <handoff>
browser_snapshot
browser_click         ref=<the Edit button>
browser_snapshot
browser_fill_form     [{name: "...", type: "textbox", target: "ref=<field>", value: "..."}]
browser_click         ref=<Save>
browser_wait_for      text: "was saved"
browser_take_screenshot
browser_close
# 4. prove
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-setup.js" audit -o acme-dev --since 10m
# 5. try to make it a deploy next time
sf project retrieve start --metadata <Type> --target-org acme-dev
```

If step 4 is empty, the change did not happen. Report that, do not re-run step 3 blindly - a save
that silently failed usually failed on a validation rule or a missing permission, and
`browser_console_messages` says which.
