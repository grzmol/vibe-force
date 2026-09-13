# Ingestion reference

How data gets into a data lake object, what each path costs in latency, and what each path implies
for record identity. Sourced from the *Data 360 Integration Guide* Ingestion API reference and the
Data 360 Developer Guide.

## 1. Choosing an ingest path

| Path | Direction | Latency | Identity implication |
| --- | --- | --- | --- |
| Ingestion API - streaming | push | Processed asynchronously about every 3 minutes | Upserts on the DLO primary key. Partial updates possible when the stream's Refresh Mode is Partial and a Record Modified field is set |
| Ingestion API - bulk | push | Job queue; close the job to start processing | Upserts on the primary key. Full replace per row: patch semantics are not supported |
| Packaged connector (S3, SFTP, Azure Blob, Snowflake, BigQuery, Redshift, GCS, Marketing Cloud, Commerce Cloud, Account Engagement, Interaction Studio, Salesforce CRM, web/mobile app) | pull or push | Per data stream schedule and extract method | Determined by `dataExtractMethods` on the data stream |
| Push connector with a staging area | push | Source system initiates a publish to SFTP | Whatever the published file contains; needs an SSH key pair registered in the staging area |
| Zero copy federation | none | Read-through, no ingest | External objects; Data Cloud never stores the rows |
| Flow `dataCloudIngestionApi` action | push | Streaming semantics | Declarative wrapper over the Ingestion API. API 61.0 and later |

The same data stream accepts both bulk and streaming interactions. Use streaming for incremental
updates as they are captured, and bulk for periodic file-based syncs.

## 2. Authentication

Two different token stories, and picking the wrong one wastes an afternoon.

| Calling | Token | Endpoint |
| --- | --- | --- |
| Connect REST API (`/services/data/vXX.X/ssot/...`) | Salesforce access token | The org's My Domain URL - the same OAuth path as any Platform API |
| Data 360 API, including the Ingestion API | Data Cloud access token | The tenant-specific `instance_url` returned by the token exchange |

The Data Cloud path is a two-step exchange:

1. Authenticate to Salesforce with OAuth and receive a Salesforce access token plus an
   `instance_url`.
2. POST that Salesforce access token to the token-exchange endpoint on the org's My Domain. The
   response carries the Data Cloud access token and the tenant-specific endpoint.
3. Call the Data Cloud API against that tenant-specific endpoint.

OAuth scopes to enable on the connected app or external client app:

| Scope | Grants |
| --- | --- |
| `cdp_query_api` | ANSI SQL queries of Data Cloud data on behalf of the user |
| `cdp_profile_api` | Manage Data Cloud profile records |
| `cdp_ingest_api` | Access and manage Ingestion API data |
| `api` | The logged-in user's account through REST API and Bulk API 2.0 |
| `refresh_token` (with `offline_access`) | A refresh token for offline interaction |

The org must be provisioned with Data Cloud licences, and integration users need the
**Minimum Access - API Only Integrations** profile plus the Data Cloud permissions for the objects
they touch. Control the JWT `expires_in` through the connected app's session timeout. Store nothing
in code - endpoints belong in a Named Credential and secrets in an External Credential, per skill
`sf-integration-patterns`.

## 3. Streaming ingestion

Fire-and-forget micro-batches. Object endpoints are downloaded from **Data Cloud Setup ->
Ingestion API**; API field names are not supported in the payload, so the JSON keys must be the
schema field names of the Datasource Object.

| Operation | Method | URI |
| --- | --- | --- |
| Upsert records | `POST` | `/api/v1/ingest/sources/{name}/{object-name}` |
| Delete records | `DELETE` | `/api/v1/ingest/sources/{name}/{object-name}` |
| Validate payload (development only) | `POST` | `/api/v1/ingest/sources/{name}/{object-name}/actions/test` |

`{name}` is the Ingestion API data connector name; `{object-name}` is the object configured inside
it. All three are available from Data 360 v1.0 / Salesforce v51.0 and return `202 Accepted` on
success, meaning the request was accepted and will be processed asynchronously.

```bash
curl -X POST "$DC_INSTANCE/api/v1/ingest/sources/Ecom_Connector/Ecom_Order" \
  -H "Authorization: Bearer $DC_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "data": [
          {
            "order_id": "SO-10231",
            "account_id": "ACC-88120",
            "order_total": 77506,
            "record_modified": "2026-09-13T08:57:08.118Z"
          }
        ]
      }'
```

Delete takes the primary keys, either as query parameters or in the body:

```bash
curl -X DELETE "$DC_INSTANCE/api/v1/ingest/sources/Ecom_Connector/Ecom_Order" \
  -H "Authorization: Bearer $DC_TOKEN" -H 'Content-Type: application/json' \
  -d '{"ids": ["SO-10231", "SO-10232"]}'
```

Streaming rules that decide correctness:

- **Every field defined in the schema must be present in the request payload**, whether or not Value
  Required is set. Send a blank value when there is no data. This applies to the upsert and to the
  synchronous validation endpoint.
- **Partial updates** are possible: include the record's primary key, provide a value for the Record
  Modified field, and send only the fields to change. Data Cloud updates just those fields and leaves
  the rest alone, provided the Record Modified value is more recent than the stored one. Enable it by
  choosing **Partial** in the Refresh Mode menu when creating a data stream of type Profile or Other.
- **Deletes respect the Record Modified field**: if the stream has one, the record is deleted only
  when the field's value is lower than the current timestamp.
- A delete request handles at most 200 records. Above that, use a bulk delete job.
- Validate first. `/actions/test` returns a `validationReport` naming the records that failed and
  why, and persists nothing downstream. It is documented for the development phase only.

## 4. Bulk ingestion

A job is created, filled with CSV files, then closed. Creating a data stream in Data Cloud is a
prerequisite for creating a job.

| Step | Method | URI | Notes |
| --- | --- | --- | --- |
| Create a job | `POST` | `/api/v1/ingest/jobs` | Body: `object`, `operation` (`upsert` or `delete`), `sourceName`. Response carries the job `id` and `state: open` |
| Upload job data | `PUT` | `/api/v1/ingest/jobs/{id}/batches` | CSV body. Returns `202` |
| Close or abort | `PATCH` | `/api/v1/ingest/jobs/{id}` | `{"state":"UploadComplete"}` to process, `{"state":"Aborted"}` to discard |
| Get job info | `GET` | `/api/v1/ingest/jobs/{id}` | |
| Get all jobs | `GET` | `/api/v1/ingest/jobs` | |
| Delete a job | `DELETE` | `/api/v1/ingest/jobs/{id}` | Allowed from `UploadComplete`, `JobComplete`, `Aborted` or `Failed`. Removes the stored job data and its metadata |

Job states:

| State | Meaning |
| --- | --- |
| `Open` | Created and ready to accept data uploads |
| `UploadComplete` | All data uploaded, job closed and queued |
| `InProgress` | The system is actively processing the uploaded data |
| `JobComplete` | Processing completed successfully; data is available |
| `Failed` | Processing failed. Check error details |
| `Aborted` | Manually aborted. Uploaded data is deleted |

```bash
JOB=$(curl -s -X POST "$DC_INSTANCE/api/v1/ingest/jobs" \
  -H "Authorization: Bearer $DC_TOKEN" -H 'Content-Type: application/json' \
  -d '{"object":"Ecom_Order","sourceName":"Ecom_Connector","operation":"upsert"}' \
  | jq -r .id)

curl -X PUT "$DC_INSTANCE/api/v1/ingest/jobs/$JOB/batches" \
  -H "Authorization: Bearer $DC_TOKEN" -H 'Content-Type: text/csv' \
  --data-binary @orders.csv

curl -X PATCH "$DC_INSTANCE/api/v1/ingest/jobs/$JOB" \
  -H "Authorization: Bearer $DC_TOKEN" -H 'Content-Type: application/json' \
  -d '{"state":"UploadComplete"}'

curl -s "$DC_INSTANCE/api/v1/ingest/jobs/$JOB" -H "Authorization: Bearer $DC_TOKEN"
```

## 5. The CSV contract

| Rule | Detail |
| --- | --- |
| Header row | First row lists the field names for the object; each subsequent row is one record |
| Header names | Must match the Datasource Object's field names. Results only include columns that match |
| One object per file | All records in a CSV must be for the object named when the job was created |
| Required fields | Include every required field when creating a record |
| Update semantics | A full replace. Patch semantics are not supported |
| Encoding | UTF-8 |
| Size | Upload data must not exceed 150 MB |
| Format | RFC 4180 |
| Delimiter | Comma only |
| Empty values | Set to null |

Delete jobs use a different shape: **no header row**, up to 2 columns. Column 1 is the primary key of
each record to delete. Column 2 is only needed for Profile-type or Other-category data where the data
stream has a record version column; it must contain datetime values greater than the original record
so the system treats the deletion as superseding the earlier upsert.

Date and dateTime values use ISO 8601 UTC with Zulu format:

| Kind | Format | Example |
| --- | --- | --- |
| Date | `yyyy-MM-dd` | `2021-07-05` |
| DateTime | `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'` | `2021-07-05'T'09:31:44.457'Z'` |

`SSS` (milliseconds, 000-999) is optional; `Z` is the UTC reference.

## 6. Consistency, retries and failure handling

- **Eventual consistency.** After bulk or streaming ingest, allow a minimum of **30 seconds** for
  internal caches to refresh before the data is queryable. Any test that ingests and immediately
  asserts is flaky by construction.
- **Check the response code after every request.** `HTTP 429 Too Many Requests` means the app must
  reduce its request frequency; implement a back-off policy rather than retrying immediately.
- **`202` is not success.** It means the request was accepted for asynchronous processing. Confirm
  bulk outcomes with Get Job Info and streaming outcomes by querying the DLO after the latency
  window.

| Code | Meaning |
| --- | --- |
| `200 OK` | Request succeeded |
| `201 Created` | Resource successfully created |
| `202 Accepted` | Accepted; data will be processed asynchronously |
| `204 No Content` | Job successfully deleted |
| `400 Bad Request` | Malformed request syntax or invalid request body |
| `401 Unauthorized` | JWT invalid or expired. Refresh the token |
| `404 Not Found` | Requested resource does not exist |
| `409 Conflict` | Unable to update the job state given its status |
| `429` | Too many requests in a given time. Back off |
| `500 Internal Server Error` | Retry the request |

Retry and dead-letter engineering for the calling side - bounded attempts, exponential backoff,
correlation ids - is skill `sf-integration-patterns`, `references/callout-and-retry.md`. Nothing
about Data Cloud changes that discipline.

## 7. Connector-side identity: the extract method

For connector-driven data streams, `DataStreamDefinition.dataExtractMethods` decides both latency and
what "the same record" means.

| Method | What it sends | Requires | Identity effect |
| --- | --- | --- | --- |
| `FULL_REFRESH` | Everything, every run | Nothing extra | The DLO reflects the source exactly as of the last run. Deletes in the source disappear |
| `DATETIME_CDC` | Rows changed since the watermark | `dataExtractField` pointing at a datetime transport field | Only changed rows arrive. A non-monotonic or nullable watermark silently skips rows |
| `NUMERIC_CDC` | Rows above the numeric watermark | `dataExtractField` pointing at a numeric transport field | Same trade-off with a sequence or version number |
| `BINARY_CDC` | - | - | Reserved for future use |

File-based connectors add `fileNameWildcard` (for example `profiles*.csv`), `bulkIngest` to aggregate
matching files before ingest, `areHeadersIncludedInFile`, `isLimitedToNewFiles` and
`isMissingFileFailure`. A stream with `isMissingFileFailure` false will succeed silently on a night
when the source produced nothing - decide deliberately which behaviour you want alerting on.

## 8. Staging area for push connectors

Some connectors are driven by the source tool, which pushes content into Data Cloud. Those require a
staging area:

1. Generate an SSH key pair. The public key goes to Data Cloud; the private key stays with the
   publishing tool. On macOS or Linux the default private key path is `~/.ssh/id_rsa` and the public
   key is `id_rsa.pub`; on Windows the default is `C:\Users\<YourUsername>\.ssh\id_rsa`. No
   passphrase is required.
2. In Data Cloud Setup, open **Staging Area**, click **New**, name it, choose **SFTP** as the
   connection type.
3. Paste the SSH public key and name it. Multiple keys are allowed. Include the trailing `==` but
   omit the comment or email address at the end of the key string.
4. Save.

## 9. Ingestion API metadata in the project

The connector itself is source-tracked:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<DataConnectorIngestApi xmlns="http://soap.sforce.com/2006/04/metadata">
    <sourceName>Ecom_Connector</sourceName>
    <masterLabel>Ecommerce Connector</masterLabel>
</DataConnectorIngestApi>
```

`DataConnectorIngestApi` lives in `dataConnectorIngestApis/` with the suffix
`.dataConnectorIngestApi`, is available from API 54.0, requires the CustomizeApplication permission,
and **does not** support the `*` wildcard in `package.xml`. Name every member explicitly:

```xml
<types>
    <members>Ecom_Connector</members>
    <name>DataConnectorIngestApi</name>
</types>
<types>
    <members>Ecom_Order_Stream</members>
    <name>DataStreamDefinition</name>
</types>
```

Deploy and verify from the CLI:

```bash
sf project deploy start --manifest package.xml --target-org vf-dev
sf project retrieve start --metadata DataConnectorIngestApi:Ecom_Connector --target-org vf-dev
```

## 10. Pre-flight checklist for a new stream

1. Datasource Object schema agreed with the source team, field by field, including data types and
   date formats.
2. Primary key chosen and expressed with `primaryIndexOrder`; compound keys ordered.
3. Record Modified field identified and mapped - required for partial updates, for delete
   supersession, and for reconciliation ranking.
4. Extract method chosen; `dataExtractField` set if CDC.
5. Ingestion API connector created and object endpoints downloaded.
6. External client app or connected app configured with `cdp_ingest_api` and the OAuth flow the
   caller will use.
7. Payload validated through `/actions/test` before the first real POST.
8. Bulk sizing checked against the limits in `limits-and-quotas.md`: 150 MB per file, 100 files per
   job, 20 jobs per hour, 5 concurrent.
9. Downstream query written and its 30-second consistency window accounted for in any test.
10. Data stream, connector and mappings added to a data kit and retrieved into the project.

## Sources

- Ingestion API - https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-ingestion-api.html
- Get Started with Ingestion API - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-get-started.html
- Bulk Ingestion - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-bulk-ingestion.html
- Create a Job - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-create-a-job.html
- Upload Job Data - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-upload-job-data.html
- Streaming Ingestion - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-streaming-ingestion.html
- Upsert Records - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-insert-records.html
- Delete Records - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-delete-records.html
- Synchronous Record Validation - https://developer.salesforce.com/docs/data/data-cloud-int/references/data-cloud-ingestionapi-ref/c360-a-api-synchronous-record-validation.html
- Data 360 Integrations (staging area) - https://developer.salesforce.com/docs/data/data-cloud-int/guide/c360-a-data-cloud-integrations.html
- Quick Start (OAuth scopes, token exchange) - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-quick-start.html
- DataStreamDefinition - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_datastreamdefinition.htm
- DataConnectorIngestApi - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_dataconnectoringestapi.htm
