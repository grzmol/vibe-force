# Data load recipes

End-to-end recipes. Each one states the goal, the commands, and the check that proves it worked.
Commands assume `<alias>` is an explicit `--target-org`.

## 1. Seed a scratch org from a committed sample

**Goal:** every developer's scratch org starts with the same 20 accounts and their contacts.

Capture once, from a sandbox:

```bash
sf data export tree \
  --query "SELECT Name, Industry, BillingCountry, (SELECT FirstName, LastName, Email, Title FROM Contacts) FROM Account WHERE Industry != null LIMIT 20" \
  --plan --prefix seed --output-dir data/seed \
  --target-org acme-uat
```

Commit `data/seed/`. Replay on every new org:

```bash
sf org create scratch --definition-file config/project-scratch-def.json --alias my-scratch --set-default --duration-days 7
sf project deploy start --target-org my-scratch
sf data import tree --plan data/seed/seed-Account-Contact-plan.json --target-org my-scratch
```

**Check:**

```bash
sf data query --query "SELECT COUNT(Id) c FROM Account" --target-org my-scratch --json | jq '.result.records[0].c'
sf data query --query "SELECT COUNT(Id) c FROM Contact WHERE AccountId = null" --target-org my-scratch --json | jq '.result.records[0].c'
```

The second count must be zero. A non-zero result means the plan loaded Contacts before Accounts, or
a `@ref` did not resolve.

**Do not** export unscrubbed production data into a committed file. Shape the query, limit the rows,
drop the columns that carry personal data.

## 2. Make a load repeatable with an external id

**Goal:** run the same load twice without creating duplicates.

Prerequisite - the field, deployed as metadata:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Legacy_Id__c</fullName>
    <label>Legacy Id</label>
    <type>Text</type>
    <length>64</length>
    <externalId>true</externalId>
    <unique>true</unique>
</CustomField>
```

`externalId` makes it usable as an upsert key and indexes it. `unique` is what makes the match
unambiguous - without it a duplicate key fails the row.

CSV:

```csv
Legacy_Id__c,Name,Industry
LEG-1001,Acme,Manufacturing
LEG-1002,Initech,Technology
```

Load:

```bash
sf data upsert bulk \
  --file data/accounts.csv --sobject Account --external-id Legacy_Id__c \
  --wait 20 --target-org <alias>
```

**Check:** run it a second time. The count must not change.

```bash
sf data query --query "SELECT COUNT(Id) c FROM Account WHERE Legacy_Id__c != null" --target-org <alias> --json
```

## 3. Load parents and children in one pass

**Goal:** load Contacts that point at Accounts without querying for Account ids in between.

Use a **relationship column** keyed on the parent's external id:

```csv
Account.Legacy_Id__c,FirstName,LastName,Email
LEG-1001,Ada,Lovelace,ada@example.com
LEG-1002,Alan,Turing,alan@example.com
```

```bash
sf data upsert bulk --file data/accounts.csv  --sobject Account --external-id Legacy_Id__c --wait 20 --target-org <alias>
sf data upsert bulk --file data/contacts.csv --sobject Contact --external-id Contact_Legacy_Id__c --wait 20 --target-org <alias>
```

The parent load must complete first. The child load resolves `Account.Legacy_Id__c` server-side.

**Check:**

```bash
sf data query --query "SELECT COUNT(Id) c FROM Contact WHERE AccountId = null AND Contact_Legacy_Id__c != null" --target-org <alias> --json
```

Zero, or the parent key did not match.

## 4. Backfill a new field

**Goal:** a new `Region__c` must be populated on 400,000 existing Accounts.

Do **not** write an Apex batch for this if the value is derivable from a column you already have.
Extract, transform locally, upsert back:

```bash
# 1. Extract the key and the source column
sf data export bulk \
  --query "SELECT Id, BillingCountry FROM Account WHERE Region__c = null" \
  --output-file work/accounts-to-fix.csv --result-format csv \
  --wait 30 --target-org <alias>

# 2. Transform locally - any tool. Produce Id,Region__c
#    Keep each output file under 100 MB of raw CSV.

# 3. Write back, keyed on Id
sf data update bulk \
  --file work/accounts-fixed.csv --sobject Account \
  --wait 60 --target-org <alias>
```

**Check:**

```bash
sf data query --query "SELECT COUNT(Id) c FROM Account WHERE Region__c = null" --target-org <alias> --json
```

**Before you start:** review the triggers, flows and validation rules on the object. The backfill
fires all of them, 200 records at a time. A trigger that is not bulk safe turns a 10-minute load
into a day of failure files. See skill `sf-governor-limits`.

## 5. Migrate a large object between orgs

**Goal:** move 5 million records from one org to another.

```bash
# Extract
sf data export bulk \
  --query-file queries/opportunities.soql \
  --output-file work/opps.csv --result-format csv \
  --wait 60 --target-org source-org

# Split to stay under 100 MB of raw CSV per file
split -l 200000 --additional-suffix=.csv work/opps.csv work/opps-part-

# Load each part
for f in work/opps-part-*.csv; do
  sf data upsert bulk --file "$f" --sobject Opportunity --external-id Legacy_Id__c \
    --wait 60 --target-org target-org
done
```

**Arithmetic before you start:**

| Question | Number |
| --- | --- |
| Records per 24 hours | 150,000,000 - not the constraint here |
| Batches per 24 hours | 15,000, shared with Bulk API 1.0 |
| Batch size in Bulk API 2.0 | Automatic, chunked at 200 records |
| Batches this load will consume | roughly `5,000,000 / 200` = 25,000 - **over the daily allocation** |

That last row is the point of doing the arithmetic. Five million records in 200-record chunks
exceeds the 15,000-batch daily allocation. Split the migration across two days, or reduce the row
count with a tighter `WHERE`.

**Check:** counts on both sides, and a spot check of a known record.

```bash
sf data query --query "SELECT COUNT(Id) c FROM Opportunity" --target-org source-org --json
sf data query --query "SELECT COUNT(Id) c FROM Opportunity" --target-org target-org --json
sf data get record --sobject Opportunity --where "Legacy_Id__c=LEG-1" --target-org target-org
```

## 6. Delete safely

**Goal:** remove 50,000 test records created by a bad load.

```bash
# 1. Capture exactly what will go, as your rollback record
sf data export bulk \
  --query "SELECT Id, Name, CreatedDate FROM Account WHERE Legacy_Id__c LIKE 'TEST-%'" \
  --output-file work/to-delete.csv --result-format csv --wait 30 --target-org <alias>

# 2. Reduce to the single Id column the delete command requires
cut -d, -f1 work/to-delete.csv > work/delete-ids.csv

# 3. Delete, leaving them in the Recycle Bin
sf data delete bulk --file work/delete-ids.csv --sobject Account --wait 30 --target-org <alias>
```

Leave `--hard-delete` off unless you have a reason. Records in the Recycle Bin can be restored;
hard-deleted records cannot.

Against a production alias, the vibe-force Bash guard blocks this. Setting `VF_ALLOW_PROD=1` is a
deliberate act, and it should be one.

**Check:**

```bash
sf data query --query "SELECT COUNT(Id) c FROM Account WHERE Legacy_Id__c LIKE 'TEST-%'" --target-org <alias> --json
```

## 7. Extract a production-shaped sample for testing

**Goal:** realistic test data without real personal data.

```bash
sf data export bulk \
  --query "SELECT Id, Name, Industry, AnnualRevenue, NumberOfEmployees, BillingCountry FROM Account WHERE Industry != null LIMIT 500" \
  --output-file work/sample.csv --result-format csv --wait 10 --target-org acme-prod
```

Select only the columns the tests need. Leave out names, emails, phone numbers and addresses, or
replace them locally before the file is committed. The shape of the data - the distribution of
industries, the revenue ranges, the country mix - is what makes a test realistic; the identities are
not.

Then load into a scratch org as in recipe 1.

## 8. Roll back a load

There is no undo button. Build the rollback before the load:

| Load type | Rollback artefact to capture first |
| --- | --- |
| Insert | The generated ids, from `sf data bulk results` - feed them to `sf data delete bulk` |
| Update | An export of the prior values of every column you are about to change |
| Upsert | Both: the prior values, and a list of which keys did not exist before |
| Delete | A full export of the rows, including every column you might need to recreate them |

```bash
# Before an update: capture prior state
sf data export bulk \
  --query "SELECT Id, Region__c FROM Account WHERE Region__c != null" \
  --output-file work/rollback-region.csv --result-format csv --wait 30 --target-org <alias>
```

Restoring is then `sf data update bulk --file work/rollback-region.csv --sobject Account`.

## 9. A load script that fails loudly

```bash
#!/usr/bin/env bash
set -euo pipefail

ORG="${1:?usage: load.sh <target-org-alias>}"
FILE="data/accounts.csv"

before=$(sf data query --query "SELECT COUNT(Id) c FROM Account" \
           --target-org "$ORG" --json | jq '.result.records[0].c')

job=$(sf data upsert bulk --file "$FILE" --sobject Account --external-id Legacy_Id__c \
        --target-org "$ORG" --json | jq -r '.result.jobId')

echo "job $job"
sf data upsert resume --job-id "$job" --wait 60 --target-org "$ORG"
sf data bulk results --job-id "$job" --target-org "$ORG"

after=$(sf data query --query "SELECT COUNT(Id) c FROM Account" \
          --target-org "$ORG" --json | jq '.result.records[0].c')

echo "accounts: $before -> $after"
[ "$after" -ge "$before" ] || { echo "record count went down" >&2; exit 1; }
```

`set -euo pipefail` is doing real work here: without it, a failed `sf` call leaves the script
happily printing "done".

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every child row has a null lookup | Parent file loaded second, or the key column is misnamed | Load parents first; the column must be `Parent.External_Id__c`, not `ParentId` |
| Second run duplicates everything | Insert instead of upsert, or no external id | Add a unique external id and use `upsert bulk` |
| "Retried more than 20 times" | Upload file too large | Split the file; stay under 100 MB raw |
| "Retried more than 15 times" on a query | Query too broad | Add filter criteria |
| `QUERY_TIMEOUT` | Query over 2 minutes to process | Narrow it, or add a selective indexed filter - skill `sf-soql-sosl-optimization` |
| Job accepted, zero records processed | CSV header does not match API field names | Compare headers against `sf sobject describe` output |
| Rows fail with a validation error | The load fires validation rules like any save | Fix the data, or gate the rule for the load user |
| Load times out for no clear reason | A non-bulk-safe trigger on the object | Skill `sf-governor-limits` |
| Daily batch allocation exhausted | Bulk API 1.0 elsewhere, or too many small jobs | Consolidate files; move remaining 1.0 usage to 2.0 |
