# Data Cloud object model and metadata reference

Everything on this page is taken from the Salesforce Object Reference, the Metadata API Developer
Guide and the Data 360 Developer Guide. Sources are listed at the bottom; a claim that could not be
verified against a fetched page is tagged `[unverified]`.

## 1. The pipeline in one pass

```text
source system
   -> connector / Ingestion API        (transport: MktDataTranObject, ExternalDataTranObject)
   -> data stream                      (DataStreamDefinition)
   -> data lake object (DLO)           native source schema, stores rows
   -> mapping                          (ObjectSourceTargetMap + DataSrcDataModelFieldMap)
   -> data model object (DMO)          C360 Data Model, stores references only
   -> identity resolution              match rules + reconciliation rules -> link tables
   -> unified DMO                      UnifiedIndividual__dlm and friends
   -> calculated insight (CIO)         aggregation over DMOs
   -> data graph (DG)                  precalculated JSON for real-time lookup
   -> segment / activation / grounding
```

DLOs store data. DMOs do not: they hold information on where the data is stored in the DLOs, and
Data Cloud APIs and features use DMOs to reach it.

## 2. Object types

| Type | Object suffix | Stores data | Customisable | Packaging |
| --- | --- | --- | --- | --- |
| Data lake object (DLO) | `__dlo` | Yes | Yes | Data kits; the ingesting data stream can also be packaged |
| Unstructured data lake object (UDLO) | `__dlo` | Yes (blob references) | Yes | Not packageable; the ingest connection can be |
| Data model object (DMO) | `__dlm` | No | Yes | Data kits (recommended); unmanaged packages or CSV import |
| Unstructured data model object (UDMO) | `__dlm` | No | Yes | Data kits (recommended) |
| Unified DMO | `__dlm` | No | - | Produced by identity resolution |
| Calculated insight object (CIO) | - | Yes (computed) | Yes; no standard CIOs | Data kits |
| Data graph (DG) | - | Yes (JSON materialisation) | Yes; no standard DGs | Added to data kits, not packageable directly |
| External object (zero copy) | - | No | Yes | Defined when an external source is shared with Data Cloud |

All API names for DMO fields end in `__c`, standard and custom alike. Standard DMOs and their fields
carry the `ssot__` namespace: `ssot__Account__dlm.ssot__LastModifiedDate__c`,
`ssot__Individual__dlm.ssot__Id__c`.

In query text, data lake objects appear with a `__dll` suffix. Both the REST SOQL samples
(`sfmc_email_engagement_click_{EID}__dll`) and the Apex `querySql` sample (`test__dll`) use it, while
the Object Reference documents the DLO object suffix as `__dlo`. Treat `__dll` as the query-time form
and confirm the exact string from the metadata call before hardcoding it.

## 3. Identity resolution and the unified profile

Identity resolution applies **match rules** to group records of the same DMO type, then
**reconciliation rules** to pick the best value per attribute from that group, producing a gold
standard unified profile. Match criteria can be fuzzy, exact or normalised, and reconciliation can
rank on frequency, last-updated attribute or trusted data source. Behind the scenes Data Cloud writes
**link tables** that tie related data to the unified individual; the original attributes and records
remain intact.

Consequences for a developer:

| Fact | Consequence |
| --- | --- |
| Source rows are never rewritten | Querying a non-unified DMO still returns per-source duplicates |
| Link tables carry the mapping | `IndividualIdentityLink__dlm.SourceRecordID__c -> UnifiedRecordId__c` is the hop from a source id to a unified id |
| Unified DMOs have no `KQ_Id__c` | There are no duplicate record ids to disambiguate, so joins need no fully qualified key |
| Unification is optional | The unified DMO is usually created before data graphs and calculated insights, but it is not mandatory |
| Reconciliation needs a recency signal | Map a record-modified field into the DMO or rules have nothing to rank on |

Standard unified and link objects seen in the REST samples: `UnifiedIndividual__dlm`,
`UnifiedContactPointEmail__dlm`, `UnifiedContactPointPhone__dlm`, `IndividualIdentityLink__dlm`.
Non-unified profile objects: `Individual__dlm`, `ContactPointEmail__dlm`, `ContactPointPhone__dlm`,
`ContactPointAddress__dlm`.

Rulesets are manipulated programmatically with `ConnectApi.CdpIdentityResolution` (API 57.0+):
`createIdentityResolution`, `getIdentityResolution`, `getIdentityResolutions`,
`updateIdentityResolution`, `deleteIdentityResolution`, `runIdentityResolutionNow`. Flow calls the
`cdpRunIdentityResolution` invocable action.

## 4. Metadata types with a verified folder and suffix

Retrieve and deploy these like any other source-tracked metadata.

| Type | File suffix | Folder | API version | Access |
| --- | --- | --- | --- | --- |
| `DataStreamDefinition` | `.dataStreamDefinition` | `dataStreamDefinitions` | 50.0+ | CustomizeApplication |
| `MktDataTranObject` | `.mktDataTranObject` | `mktDataTranObjects` | 50.0+ | CustomizeApplication |
| `DataSourceObject` | `.dataSourceObject` | `mktDataSourceObjects` | 50.0+ | Customize Application |
| `ObjectSourceTargetMap` | `.objectSourceTargetMap` | `objectSourceTargetMaps` | 51.0+ | Customize Application |
| `MktCalcInsightObjectDef` | `.mktCalcInsightObjectDef` | `mktCalcInsightObjectDefs` | 52.0+ | CustomizeApplication |
| `DataSrcDataModelFieldMap` | `.dataSrcDataModelFieldMap` | `dataSrcDataModelFieldMaps` | 53.0+ | Data 360 permissions |
| `DataConnectorIngestApi` | `.dataConnectorIngestApi` | `dataConnectorIngestApis` | 54.0+ | CustomizeApplication |
| `ExternalDataTranObject` | `.externalDataTranObject` | `externalDataTranObjects` | 55.0+ | Data 360 provisioned |

Wildcard support in `package.xml`: `DataSrcDataModelFieldMap` and `MktCalcInsightObjectDef` support
`*`; `DataConnectorIngestApi` does not.

## 5. Every Data Cloud metadata type

From *Data 360 Metadata Types* in the Metadata API Developer Guide.

| Type | Represents |
| --- | --- |
| `ActivationPlatform` | Activation platform configuration: name, delivery schedule, output format, destination folder |
| `ActivationPlatformActvAttr` | Activation attributes. Reserved for future use |
| `ActivationPlatformField` | Fields used in `ActivationPlatform` |
| `ActvPfrmDataConnectorS3` | Amazon S3 bucket name and export directory |
| `ActvPlatformAdncIdentifier` | Identifiers to activate: email, phone, MAID, OTT id |
| `ActvPlatformFieldValue` | Field values for `ActivationPlatformField` |
| `AiPluginUtteranceDef` | An utterance used to pick a topic at runtime |
| `CustomerDataPlatformSettings` | The org's Data 360 settings |
| `DataConnector` | White-labelled metadata configuration for an external connector |
| `DataConnectorIngestApi` | Connection information specific to the Ingestion API |
| `DataConnectorS3` | Connection information specific to Amazon S3 |
| `DataKitObjectTemplate` | An object template inside a data kit |
| `DataKitObjectDependency` | Dependency between two data kit objects |
| `DataObjectBuildOrgTemplate` | Derived object template for data objects in a build org |
| `DataPackageKitDefinition` | Top-level data kit container definition |
| `DataPackageKitObject` | An object in the data kit content |
| `DataSource` | The system where the data was sourced. Always required when creating a data stream definition |
| `DataSourceBundleDefinition` | Bundle of streams added to a data kit |
| `DataSourceField` | Details of a data source field |
| `DataSourceObject` | The object from where the data was sourced |
| `DataSourceTenant` | Internal use only |
| `DataSrcDataModelFieldMap` | Mappings between source DLO fields and target DMO fields |
| `DataStreamDefinition` | Data ingestion information: connection, API and file retrieval settings |
| `DataStreamTemplate` | A data stream added to a data kit |
| `ExternalDataConnector` | The object where the data was sourced |
| `ExternalDataSource` | Connection details for data stored outside the org |
| `ExternalDataTransportFieldTemplate` | Internal use only |
| `ExternalDataTranObject` | Definition of a Data 360 schema object |
| `ExternalDataTransportObjectTemplate` | Internal use only |
| `FieldSrcTrgtRelationship` | Relationships between a DMO and its fields, for example `Individual.Id` 1:M `ContactPointEmail.PartyId` |
| `InternalDataConnector` | Internal use only |
| `MarketSegmentDefinition` | Exportable segment metadata: criteria and attributes |
| `MktCalcInsightObjectDef` | Calculated insight definition, including the SQL expression |
| `MktDataTranObject` | Entity that transports information from source to landing entity |
| `ObjectSourceTargetMap` | Object-level mappings between source and target objects |
| `StreamingAppDataConnector` | Connection information for web and mobile connectors |

Metadata API support for Data Cloud is **partial**. The documented areas are AWS data streams,
Ingestion API data streams, mobile and web data streams, the data lake, and the data model.

## 6. `DataStreamDefinition` fields that matter

| Field | Type | Notes |
| --- | --- | --- |
| `masterLabel` | string | Required. UI label |
| `description` | string | Required |
| `dataSource` | string | Required. API name or unique system id, for example `MC_12345` |
| `dataConnector` | string | Required |
| `dataConnectorType` | enum | `ACCOUNTENGAGEMENT`, `AwsS3`, `AzureBlob`, `BIG_QUERY`, `CuratedEntity`, `DataCloud`, `ExternalPlatform`, `GoogleCloudStorage`, `IngestApi`, `REDSHIFT`, `SalesforceCommerceCloud`, `SalesforceDotCom`, `SalesforceInteractionStudio`, `SalesforceMarketingCloud`, `SFTP`, `Snowflake`, `StreamingApp`, `UPLOAD` |
| `mktDataLakeObject` | string | Required. The landing entity (target) where data is stored |
| `mktDataTranObject` | string | The transport object from source to landing entity |
| `dataExtractMethods` | enum | `DATETIME_CDC`, `FULL_REFRESH`, `NUMERIC_CDC`; `BINARY_CDC` is reserved for future use |
| `dataExtractField` | string | Transport field used when the extract method is CDC |
| `bulkIngest` | boolean | Aggregate files before ingest when the file name contains a wildcard |
| `fileNameWildcard` | string | File or wildcard used when finding files, for example `profiles*.csv` |
| `areHeadersIncludedInFile` | boolean | Single-file streams only |
| `isLimitedToNewFiles` | boolean | Restrict retrieval to new files |
| `isMissingFileFailure` | boolean | Treat a missing file as a failure |
| `definitionCreationType` | enum | `Custom`, `Standard`, plus values added in API 62.0 and 67.0 |

`dataExtractMethods` is the latency and identity decision in one field. `FULL_REFRESH` replaces the
DLO contents each run and tolerates a source with no watermark. `DATETIME_CDC` and `NUMERIC_CDC`
carry only changed rows and require `dataExtractField`; if that field is not monotonic in the source,
rows are silently skipped.

## 7. Transport fields and the primary key

Both `MktDataTranField` (under `MktDataTranObject`) and `ExternalDataTranField` (under
`ExternalDataTranObject`) expose the same key-bearing shape.

| Field | Type | Notes |
| --- | --- | --- |
| `primaryIndexOrder` | int | Part of the primary key when supplied. The value, starting at 1, orders the attributes of a compound key. Missing means the field is not part of the key |
| `datatype` | string | Required. Phone, currency, number or other assigned type |
| `isDataRequired` | boolean | Data required for this field |
| `dateFormat` | string | Date format for date, time and date/time fields |
| `externalName` | string | Name in the external system, when it differs from the developer name |
| `length` / `precision` / `scale` | int | String length; currency and numeric accuracy |
| `sequence` | int | Sequence of this source schema |
| `masterLabel` | string | Field label |
| `creationType` | enum | `Custom`, `Standard`, `System`, `Derived`, `Bridge`, `Curated`, `Segment_Membership`, plus values added in 62.0 and 67.0 |

Key selection rules:

1. Choose an identifier the **source system** owns and never reuses.
2. Compound keys get `primaryIndexOrder` 1, 2, 3 … in the order that makes the key selective.
3. Do not key on an ingest timestamp, a load batch id, or a hash of the whole row - any of these
   turns every re-send into a new row.
4. If the grain is an event rather than an entity, include the event id in the key.
5. Whatever you pick, it is also the upsert key: sending the same key again **replaces** the row.

## 8. Mapping metadata

### `ObjectSourceTargetMap`

Object-level mapping. Source and target can each be an `MktDataLakeObject` or an
`MktDataModelObject`; for example an `Email` source object maps to `ContactPointEmail`.

| Field | Type | Notes |
| --- | --- | --- |
| `masterLabel` | string | Required. UI name for the target map |
| `sourceObjectName` | string | Required. For example `Email`, `SfmcEnt1_Subscriber` |
| `targetObjectName` | string | Required. For example `ContactPointEmail`, `Individual` |
| `fieldSourceTargetMaps` | FieldSourceTargetMap[] | Field-level mappings for this object mapping |
| `sequenceNbr` | int | Orders multiple mappings between the same two objects |
| `creationType` | enum | `Custom`, `Standard`, `Derived`, `Bridge`, `Curated`, `Calculated_Insight`, `Segment_Membership`, `Transform`, `Semantic`, `Vector_Embedding`, `Chunk`, `Directory_Table`, `External`, `ADG`, `CG_Audience` (62.0+), `Activation_Audience`, `System`, plus `Ad_Audience_Insights`, `Auxiliary`, `Clean_Room`, `Deletion_Records`, `Problem_Records` (67.0+) |

### `FieldSourceTargetMap` (nested)

Source and target can be `MktDataLakeField` or `MktDataModelField`.

| Field | Type | Notes |
| --- | --- | --- |
| `sourceField` | string | Required. For example `EmailAddr`, `SfmcEnt1_Subscriber.FName` |
| `targetField` | string | Required. For example `SfmcEnt1_Email.EmailAddr`, `Individual.FirstName` |
| `isSourceFormula` | boolean | When true, `sourceFormula` is required |
| `sourceFormula` | string | Concatenation, date function or constant value |
| `filterApplied` | boolean | Whether this mapping is an event type filter |
| `filterOperationType` | string | `Equal` |
| `filterValue` | string | The object holding the event type field |

### `DataSrcDataModelFieldMap`

Standalone field-level mapping, retrievable as its own component.

| Field | Type | Notes |
| --- | --- | --- |
| `masterLabel` | string | Required |
| `sourceField` | string | Required. Developer name of the DLO field |
| `targetField` | string | Required. Developer name of the DMO field |
| `filterApplied` | boolean | Mirrors a DLO filter applied in the Data Spaces tab. API 60.0+ |
| `filterOperationType` | string | Required when `filterApplied` is true. API 60.0+ |
| `filterValue` | string | Required when `filterApplied` is true. API 60.0+ |
| `templateVersion` | int | Field mapping template version. API 61.0+ |
| `versionNumber` | double | Required |

```xml
<?xml version="1.0" encoding="UTF-8"?>
<DataSrcDataModelFieldMap xmlns="http://soap.sforce.com/2006/04/metadata">
    <filterApplied>true</filterApplied>
    <filterOperationType>equals</filterOperationType>
    <filterValue>Active</filterValue>
    <masterLabel>DataSrcDataModel26</masterLabel>
    <sourceField>Account1.LastModifiedDate__c</sourceField>
    <targetField>ssot__Account__dlm.ssot__LastModifiedDate__c</targetField>
    <versionNumber>1.0</versionNumber>
</DataSrcDataModelFieldMap>
```

```xml
<types>
    <members>DataSrcDataModel26</members>
    <name>DataSrcDataModelFieldMap</name>
</types>
```

## 9. Calculated insights as metadata

`MktCalcInsightObjectDef` carries the SQL that produces the insight.

| Field | Type | Notes |
| --- | --- | --- |
| `masterLabel` | string | Required |
| `expression` | string | The SQL query that generates the calculated insight. Required for the internal insight type |
| `creationType` | enum | Required. `Custom` |
| `system` | string | Required. `Custom`, or `System` in API 61.0 and later |
| `description` | string | Optional |
| `builderExpression` | string | Reserved for internal use |

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MktCalcInsightObjectDef xmlns="http://soap.sforce.com/2006/04/metadata">
    <creationType>Custom</creationType>
    <description>InsightName description</description>
    <expression>SELECT COUNT(ssot__Individual__dlm.ssot__Id__c) as count__c FROM ssot__Individual__dlm</expression>
</MktCalcInsightObjectDef>
```

Calculated insight and data transform SQL uses a **different dialect** from the Query API SQL
described in `query-reference.md`. Do not paste a Query API statement into an insight expression and
expect it to compile.

Runtime control from Apex: `ConnectApi.CdpCalculatedInsight` (API 56.0/57.0+) -
`createCalculatedInsight`, `getCalculatedInsight`, `getCalculatedInsights`, `runCalculatedInsight`,
`updateCalculatedInsight`, `deleteCalculatedInsight`. `getCalculatedInsights` takes `batchSize` 1-200
with a default of 25. From Flow, `cdpPublishCalculatedInsight` runs the insight.

## 10. Packaging support by component

From the *Metadata Components for Data 360 Cheat Sheet*.

| Component | Unlocked | Managed 2GP | Managed 1GP |
| --- | --- | --- | --- |
| `ActivationPlatform` | Yes | - | Yes |
| `DataPackageKitDefinition` | Yes | Yes | Yes |
| `DataPackageKitObject` | Yes | Yes | - |
| `DataSource` | Yes | Yes | - |
| `DataSourceBundleDefinition` | Yes | Yes | - |
| `DataSrcDataModelFieldMap` | Yes | Yes | - |
| `DataSourceObject` | Yes | Yes | - |
| `DataSourceTenant` | Yes | - | - |
| `DataStreamDefinition` | Yes | Yes | Yes |
| `DataStreamTemplate` | Yes | Yes | - |
| `ExternalDataConnector` | Yes | Yes | - |
| `ExternalDataSource` | Yes | Yes | Yes |
| `FieldSrcTrgtRelationship` | Yes | Yes | Yes |
| `DataConnectorIngestApi` | Yes | Yes | - |
| `MktCalcInsightObjectDef` | Yes | - | Yes |
| `MktDataTranObject` | Yes | Yes | - |
| `MarketSegmentDefinition` | Yes | - | Yes |
| `ObjectSourceTargetMap` | Yes | Yes | - |
| `DataConnectorS3` | Yes | Yes | - |
| `StreamingAppDataConnector` | Yes | Yes | - |

## 11. Getting the metadata into a source-tracked project

The UI is the modelling tool; the project is the record of it. The documented loop:

1. Build the data streams, mappings, calculated insights and transforms in the org.
2. In the Data Cloud UI, create a data kit and add those features to it.
3. Under Developer Tools, open **Data Kits**, select the kit, click **Download Manifest**. The
   resulting `package.xml` lists every metadata component in the kit.
4. `sf project retrieve start --manifest package.xml --target-org <alias>` pulls the components into
   the project.
5. Commit; another developer clones and runs `sf project deploy start --manifest package.xml` against
   their own org.
6. Installing a data kit is not the same as activating it - data streams, data models and calculated
   insights still have to be deployed from the kit in the target org.

Deploying data kit components needs the **Data Cloud Architect** permission set. Data Cloud in
scratch orgs is restricted: Salesforce partners must log a case with Partner Support, and the feature
is only available for scratch orgs created from a Dev Hub inside a Partner Business Org. Plan on a
shared development org rather than per-developer scratch orgs. Project layout conventions are skill
`sf-project-structure`; deployment sequencing is skill `sf-deployment-strategies`.

## Sources

- Salesforce Data Cloud Objects - https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_concepts_data_cloud_objects.htm
- Data 360 Metadata Types - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_data_cloud_types.htm
- DataStreamDefinition - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_datastreamdefinition.htm
- MktDataTranObject - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_mktdatatranobject.htm
- ExternalDataTranObject - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_externaldatatranobject.htm
- ObjectSourceTargetMap - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_objectsourcetargetmap.htm
- DataSrcDataModelFieldMap - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_datasrcdatamodelfieldmap.htm
- MktCalcInsightObjectDef - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_mktcalcinsightobjectdef.htm
- DataConnectorIngestApi - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_dataconnectoringestapi.htm
- DataSourceObject - https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_datasourceobject.htm
- Data 360 Architecture - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/dc-architecture.html
- Metadata Components for Data 360 Cheat Sheet - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/component-cheatsheet.html
- Workflow for Data 360 Second-Generation Managed Packages - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/data-cloud-2gp-workflow.html
- Custom App Development - https://developer.salesforce.com/docs/data/data-cloud-dev/guide/custom-app-dev.html
- Data Cloud Query Profile Parameters - https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_cdp_query.htm
- Join Records from Different DMOs and DLOs - https://developer.salesforce.com/docs/data/data-cloud-query-guide/guide/query-joins.html
