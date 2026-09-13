# Metadata XML without the token bill

Salesforce metadata is the most expensive thing an agent session reads. Apex is written by humans
and stays small; metadata is written by the platform and does not. A single profile is routinely
larger than every Apex class it grants access to. This reference is the method for touching that
metadata without paying to load it, and the ordering is deliberate: the cheapest lever first.

## 0. Measure before optimising

Rank the sinks, then decide. One command answers it:

```bash
git ls-files -z '*.xml' | xargs -0 node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js" stats | tail -20
```

Bytes divided by roughly 3.5 is the token count for metadata XML. The usual ranking, largest first,
is profiles, permission set groups, layouts, flows, translations, objects. If your ranking differs,
follow yours.

| Metadata | Why it grows | What to do instead of reading it |
|---|---|---|
| `profiles/*.profile-meta.xml` | one element per field, object, tab, page, class | `get '//fieldPermissions[field=X]'`; prefer permission sets |
| `permissionsets/*` | same shape, smaller blast radius | same, and this is the file you should be editing |
| `layouts/*.layout-meta.xml` | every field on every section | `outline` then `get '//layoutSections[label=X]'` |
| `flows/*.flow-meta.xml` | every element carries canvas coordinates | `outline`; never hand-edit the canvas |
| `objects/*/fields/*` | one small file per field | read the one field; never the directory |
| `translations/*` | one element per translated label | patch by selector |

## 1. Do not bring it into the session at all

| Instead of | Do |
|---|---|
| `sf project retrieve start` | `sf project retrieve start --metadata Flow:My_Flow --target-org <alias>` |
| retrieving to see what exists | `sf org list metadata -m WorkflowRule --target-org <alias>` — names only |
| retrieving metadata you will never edit | add it to `.forceignore` (see `forceignore-and-manifests.md`) |
| reading a file to find one value | `vf-xml get <file> '<selector>'` |
| reading a file to learn its shape | `vf-xml outline <file>` |
| `sf ... ` and reading the raw output | `sf ... --json` and project the fields you need |

## 2. Let a subagent hold the bytes

A subagent's context dies when it finishes. Work that must look at a large file belongs there, and
what comes back is a table of `(file, node path, before -> after)` — never XML bodies. In the wave
workflow that is `sf-metadata-engineer`'s job, and its hand-off contract forbids returning XML.

## 3. Read structurally, not linearly

```bash
vf-xml outline force-app/main/default/profiles/Admin.profile-meta.xml
# Profile  110658 B  ~31617 tok
#   fieldPermissions x900  [Account.F0__c, Account.F1__c, ..., +897 more]

vf-xml get force-app/main/default/profiles/Admin.profile-meta.xml \
  '//fieldPermissions[field=Account.Rating]'
```

31 617 tokens become about 40 for the outline plus 25 for the node. The outline is not a summary
the model wrote — it is generated from the byte index, so it cannot drift from the file.

## 4. Patch by byte range, never by rewrite

`vf-xml set / replace / insert / remove` splice the byte range the selector addresses. Everything
outside it is untouched, which matters for three reasons:

- the diff stays reviewable, so a two-line permission change reads as two lines;
- no reformatting churn, so `vf-check format` stays green and source tracking does not report drift;
- flow canvas coordinates and element order survive, and the Metadata API enforces element order.

A parse-to-object-and-re-emit round trip loses all three. So does asking a model to retype a file.

## 5. The guard that makes it stick

`xml-bulk-read` denies both a `Read` and a shell dump (`cat`, `less`, unbounded `sed`) of metadata
XML over `xml.readMaxBytes` — 20 kB by default, set in `config/vibe-force.defaults.json`. The denial
carries the `vf-xml` command that replaces it. Bounded reads (`head -50`, `Read` with a `limit`) are
never blocked, because they cost what they say they cost.

Escape hatches, in order of preference: a narrower selector, a bounded read, `VF_XML_READ=1` for one
call, then raising `xml.readMaxBytes`. Reaching for the last one first is the wrong move: it hides
the cost rather than removing it.

## Anti-patterns

| Anti-pattern | Why it hurts | Fix |
|---|---|---|
| `cat` a profile to find one field permission | tens of thousands of tokens for one line | `get '//fieldPermissions[field=X]'` |
| Asking the model to rewrite a metadata file | pays the read and the write, and reformats | `set` / `replace` by selector |
| Retrieving a whole package directory to "have context" | pays for metadata nobody will touch | targeted `--metadata`, plus `.forceignore` |
| Reading a flow to understand automation | canvas coordinates and metadata values dominate the file | `outline`, then `get` the element |
| Raising `xml.readMaxBytes` to silence the guard | the cost is still paid, just unreported | narrower selector |
| Editing a profile at all | merge-hostile and deploy-fragile | a permission set (`repo-conventions.md`) |

## Verification

```bash
git ls-files -z '*.xml' | xargs -0 node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js" stats | tail -5
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js" outline <file>
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js" get <file> '<selector>'      # exit 1 = no match
node "$CLAUDE_PLUGIN_ROOT/scripts/checks/vf-check.mjs" format --files <file>
sf project deploy start --dry-run --source-dir <file> --target-org <alias>
```

`vf-xml` re-checks well-formedness before it writes and refuses a patch that would break the file.
It does not validate against the metadata schema: only a deploy does that.
