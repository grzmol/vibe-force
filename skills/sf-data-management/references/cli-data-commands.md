# `sf data` command reference

Source: Salesforce CLI command reference (`salesforcecli/cli` README) and the `@salesforce/plugin-data`
plugin, current at Summer '26 / API version 67.0. Flags marked required are required.

Every command accepts `--json` (format output as JSON), `--flags-dir` (import flag values from a
directory) and, where it talks to an org, `--api-version` (override the API version for that
command's requests).

vibe-force rule: always pass `--target-org <alias>` explicitly. Relying on the configured default
org is how a load lands in the wrong place.

## Bulk ingest - Bulk API 2.0

| Command | Purpose | Required flags |
| --- | --- | --- |
| `sf data import bulk` | Insert records from a CSV | `--file`, `--sobject`, `--target-org` |
| `sf data update bulk` | Update records from a CSV | `--file`, `--sobject`, `--target-org` |
| `sf data upsert bulk` | Insert or update, keyed on an external id | `--file`, `--sobject`, `--external-id`, `--target-org` |
| `sf data delete bulk` | Delete records listed by id in a CSV | `--file`, `--sobject`, `--target-org` |

Shared optional flags:

| Flag | Meaning |
| --- | --- |
| `-w, --wait <minutes>` | Wait for completion. **Default 0**: the command returns immediately with a job id |
| `--column-delimiter` | `BACKQUOTE`, `CARET`, `COMMA`, `PIPE`, `SEMICOLON`, `TAB` |
| `--line-ending` | `CRLF` or `LF`. Default `CRLF` on Windows, `LF` on macOS and Linux |

Command-specific:

| Flag | Command | Meaning |
| --- | --- | --- |
| `-i, --external-id` | `upsert bulk` | Name of the external id field, or `Id` |
| `--hard-delete` | `delete bulk` | Mark records immediately eligible for deletion instead of sending them to the Recycle Bin. **Not reversible** |

`delete bulk` requires a CSV with exactly one column, `Id`, and one record id per line.

Each of these starts a job, prints the id and returns control unless `--wait` is set. If `--wait`
times out, the command still outputs the ids.

## Bulk query - Bulk API 2.0

| Command | Purpose | Required flags |
| --- | --- | --- |
| `sf data export bulk` | Export records matching a SOQL query to a file | `--target-org`, `--output-file`, `--result-format` |

| Flag | Meaning |
| --- | --- |
| `-q, --query` | The SOQL query |
| `--query-file` | A file containing the query - avoids shell quoting problems |
| `-r, --result-format` | `csv` or `json`. Default `csv` |
| `--all-rows` | Include soft-deleted records |
| `-w, --wait <minutes>` | Wait for completion |
| `--column-delimiter`, `--line-ending` | As above; default delimiter `COMMA` |

## Resume and inspect

| Command | Purpose | Key flags |
| --- | --- | --- |
| `sf data import resume` | Resume a bulk import | `--job-id` or `--use-most-recent`, `--wait` (default 5) |
| `sf data update resume` | Resume a bulk update | `--job-id` or `--use-most-recent` |
| `sf data upsert resume` | Resume a bulk upsert | `--job-id` or `--use-most-recent` |
| `sf data delete resume` | Resume a bulk delete | `--job-id` |
| `sf data export resume` | Resume a bulk export | `--job-id` |
| `sf data resume` | View the status of a job, or of one batch within it | `--job-id` (required), `--batch-id`, `--target-org` |
| `sf data bulk results` | Retrieve the success, failure and unprocessed records of a finished job | `--job-id` (required), `--target-org` (required) |

Results are retrievable for **7 days** after job completion.

## Tree format - seeding

| Command | Purpose | Key flags |
| --- | --- | --- |
| `sf data export tree` | Export records to sObject tree JSON | `--query` (required), `--target-org` (required), `--output-dir`, `--plan`, `--prefix` |
| `sf data import tree` | Import sObject tree JSON | `--target-org` (required), `--files` or `--plan` |

`sf data import tree` is aliased as `sf force data tree import`.

Two behaviours that decide which flag you use:

- Files listed in a **plan definition file** may contain **more than 200 records**. The CLI batches
  them automatically to comply with the API's 200-record limit. Files passed with `--files` may not.
- **Order matters.** Records with lookups into another file must be listed **after** that file.
  Accounts before Contacts.

Plan definition schema:

| Key | Type | Meaning |
| --- | --- | --- |
| `items` | object[] | One definition per sObject type |
| `items[].sobject` | string | Name of the sObject. Child file references must have roots of this type |
| `items[].files` | string[] | Array of file paths to load, in order |

## Single records

| Command | Purpose | Required flags |
| --- | --- | --- |
| `sf data create record` | Insert one record | `--sobject`, `--values`, `--target-org` |
| `sf data get record` | Display one record | `--sobject`, `--target-org`, plus `--record-id` or `--where` |
| `sf data update record` | Update one record | `--sobject`, `--values`, `--target-org`, plus `--record-id` or `--where` |
| `sf data delete record` | Delete one record | `--sobject`, `--target-org`, plus `--record-id` or `--where` |

| Flag | Meaning |
| --- | --- |
| `-v, --values` | `<fieldName>=<value>` pairs. Quote values containing spaces |
| `-w, --where` | `<fieldName>=<value>` pairs identifying the record, as an alternative to `--record-id` |
| `-t, --use-tooling-api` | Operate on a Tooling API object instead |
| `--skip-assignment-rules` | `create record` only: do not apply active assignment rules |

Examples:

```bash
sf data create record --sobject Account --values "Name=Acme" --target-org my-scratch
sf data create record --sobject Account \
  --values "Name='Universal Containers' Website=www.example.com" --target-org my-scratch
sf data update record --sobject Account --where "Name=Acme" --values "Industry=Manufacturing" --target-org my-scratch
```

## Query and search

| Command | Purpose | Key flags |
| --- | --- | --- |
| `sf data query` | Run a SOQL query | `--query` or `--file`, `--target-org` (required), `--result-format`, `--use-tooling-api`, `--output-file` |
| `sf data search` | Run a SOSL query | `--query` or `--file`, `--target-org` (required), `--result-format` |

`--result-format` defaults to `human`; `csv` and `json` are available, and `--json` overrides the
flag. The CLI's own guidance: **if your query returns more than 10,000 records, prefer
`sf data export bulk`** - it runs the Bulk API 2.0 path instead.

```bash
sf data query --query "SELECT Id, Name FROM Account LIMIT 5" --target-org my-scratch
sf data query --file query.txt --output-file output.csv --result-format csv --target-org my-scratch
sf data query --query "SELECT Id FROM ApexClass" --use-tooling-api --target-org my-scratch
```

## Files

| Command | Purpose | Key flags |
| --- | --- | --- |
| `sf data create file` | Upload a file as a `ContentDocument`, optionally attached to a record | `--file` (required), `--target-org` (required), `--parent-id`, `--title` |

## Legacy - Bulk API 1.0

`sf force data bulk delete` and its siblings use **Bulk API 1.0**. They still work, but Bulk API 1.0
consumes the shared 15,000-batch daily allocation faster because you size the batches yourself.
Prefer the `sf data * bulk` commands. The vibe-force Bash guard treats retired `sfdx force:*`
syntax as a hard denial; `sf force data bulk *` is a different, still-supported surface, but new
scripts should not use it.

## Scripting patterns

Capture and check a job:

```bash
job=$(sf data import bulk --file data/accounts.csv --sobject Account \
        --target-org acme-uat --json | jq -r '.result.jobId')
sf data import resume --job-id "$job" --wait 30 --target-org acme-uat
sf data bulk results --job-id "$job" --target-org acme-uat
```

Fail a script on a bad count:

```bash
before=$(sf data query --query "SELECT COUNT(Id) c FROM Account" \
           --target-org acme-uat --json | jq '.result.records[0].c')
sf data import bulk --file data/accounts.csv --sobject Account --wait 20 --target-org acme-uat
after=$(sf data query --query "SELECT COUNT(Id) c FROM Account" \
          --target-org acme-uat --json | jq '.result.records[0].c')
test "$after" -gt "$before" || { echo "load changed nothing" >&2; exit 1; }
```

JSON output conventions and exit codes for the CLI as a whole: skill `sf-cli-operations`.
