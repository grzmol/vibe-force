---
description: 'Read and patch Salesforce metadata XML without loading whole files into the session. `outline` prints structure only, `get` returns one subtree by selector, `set` / `replace` / `insert` / `remove` splice byte ranges so the file stays byte-identical outside the range addressed, and `stats` ranks files by their token cost.'
argument-hint: "[outline|get|set|replace|insert|remove|stats] <file> [selector]"
allowed-tools: Glob, Grep, Bash(node:*)
---

# vf-xml - metadata XML without the token bill

Raw arguments: `$ARGUMENTS`

First bare token = the subcommand (`outline` when omitted), second = the file, third = the selector.
Everything else is passed through untouched.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/vf-xml.js" <subcommand> <file> [selector] [options]
```

## Which subcommand

| Question | Command |
|---|---|
| What is in this file? | `outline <file>` |
| Which files cost the most to read? | `stats <file...>`, fed by `git ls-files -z '*.xml' \| xargs -0` |
| What does this one node say? | `get <file> '<selector>'` |
| Change a value | `set <file> '<selector>' --value <text>` |
| Swap a whole element | `replace <file> '<selector>' --xml '<x>'` |
| Add an element | `insert <file> '<selector>' --xml '<x>' [--where before\|after\|firstChild\|lastChild]` |
| Delete an element | `remove <file> '<selector>'` |

## Selectors

| Form | Matches |
|---|---|
| `Flow/status` | anchored path from the document root |
| `//fieldPermissions` | that element at any depth |
| `Workflow/rules[2]` | the third same-name sibling, 0-based |
| `//fieldUpdates[fullName=SetHigh]/field` | predicate on any step: address by identity, then take one field |

## Method

1. `stats` on the metadata you are about to touch, so you know what reading it would cost.
2. `outline` the file. Tens of tokens, and it names every child and its identity.
3. `get` only the node the task is about.
4. Patch with `set` / `replace` / `insert` / `remove`. The result is re-checked for
   well-formedness before anything is written, and nothing outside the addressed range moves.
5. `vf-check format --files <file>` then a dry-run deploy is the proof the edit is valid.

## Exit codes

`0` done, `1` the selector matched nothing or the patch would leave the file malformed and was not
written, `2` misuse or unreadable file.

## Hard rules

- Never `cat`, `Read` or otherwise dump a metadata file over `xml.readMaxBytes` (20 kB by default);
  the `xml-bulk-read` guard denies it and hands back the `vf-xml` command to use instead.
- One selector per edit. A `set` that matches more nodes than intended is a silent bug: run `get`
  with the same selector first and count the matches.
- This tool does not validate against the metadata schema. Only a deploy does that.
