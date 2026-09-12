# Platform Events and Change Data Capture - Reference

Source of record: Platform Events Developer Guide and Change Data Capture Developer Guide
(Winter '27 / API 68.0 snapshot), plus the Apex Reference Guide `EventBus` namespace. URLs at the
end of this file.

## 1. Publish behaviour

Set on the platform event definition (Setup -> Platform Events -> New Platform Event ->
*Publish Behavior*).

| Behaviour | Respects transaction boundary | `allOrNone` header | Savepoint rollback | Limit charged |
| --- | --- | --- | --- | --- |
| Publish Immediately (default, recommended) | no - published when the publish call executes, even if the transaction later fails | ignored by the APIs; some events publish while others fail | not supported: `Database.setSavepoint()` and `rollback()` do not undo the publish | separate limit of 150 `EventBus.publish()` calls, read with `Limits.getPublishImmediateDML()` |
| Publish After Commit | yes - published only after the transaction commits | enforced for the initial enqueue; once enqueued, not enforced for the eventual publish | supported | 1 DML statement per call against the 150 DML limit, read with `Limits.getDMLStatements()` |

The publish behaviour does not apply to messages published with Pub/Sub API.

A subscriber under Publish Immediately can see the event **before** the publishing transaction's data
is committed. Choose Publish After Commit only when the subscriber genuinely needs committed data.

## 2. Volume, retention, and allocations

| Property | High-volume (default for custom events defined in API 45.0 and later) | Legacy standard-volume |
| --- | --- | --- |
| Publishing | asynchronous, at-least-once with internal retry | asynchronous since Spring '21 |
| Event bus retention | 72 hours (3 days) | 24 hours (1 day) |
| Apex publish callbacks | supported | not supported |
| Parallel subscriptions for Apex triggers | supported | not supported |
| Status | current | retiring in Summer '27; migrate to high volume |

Change events are built on platform events and are retained in the event bus for three days.

## 3. System fields on every event message

| Field | Guarantees |
| --- | --- |
| `ReplayId` | opaque, positional, populated at delivery. **Not** guaranteed contiguous and **not** guaranteed unique across org migrations. Store it to resume a stream; never use it as an identity key. |
| `EventUuid` | universally unique, system-populated, read-only, API 52.0 and later. Use this to deduplicate. |
| `CreatedDate` | publish timestamp |
| `CreatedById` | publishing user |

The maximum number of custom fields on a platform event matches the custom-object limit for the
edition.

Permissions: Create on the event object to publish, Read on the event object to subscribe.

## 4. Publishing from Apex

```apex
List<Order_Event__e> events = new List<Order_Event__e>{
    new Order_Event__e(Order_Number__c = 'SO-1001', Status__c = 'Shipped')
};
List<Database.SaveResult> results = EventBus.publish(events);
for (Database.SaveResult sr : results) {
    if (!sr.isSuccess()) {
        for (Database.Error err : sr.getErrors()) {
            System.debug(LoggingLevel.ERROR, err.getStatusCode() + ' ' + err.getMessage());
        }
    }
}
```

For high-volume events, `isSuccess() == true` means the publish request was **queued**, not that the
message reached the bus: the `Database.Error` carries status code `OPERATION_ENQUEUED` and the
message carries the event UUID. `EventBus.publish()` can publish some events in a call while others
fail. To learn the final outcome, use a publish callback.

### Apex publish callbacks

Implement one or both interfaces in the `EventBus` namespace:

| Interface | Method | Result parameter |
| --- | --- | --- |
| `EventBus.EventPublishFailureCallback` | `void onFailure(EventBus.FailureResult result)` | `EventBus.FailureResult` |
| `EventBus.EventPublishSuccessCallback` | `void onSuccess(EventBus.SuccessResult result)` | `EventBus.SuccessResult` |

```apex
public with sharing class OrderPublishCallback
        implements EventBus.EventPublishFailureCallback, EventBus.EventPublishSuccessCallback {
    public void onFailure(EventBus.FailureResult result) {
        insert as system new Publish_Failure__c(
            Event_Uuids__c = String.join(result.getEventUuids(), ',')
        );
    }
    public void onSuccess(EventBus.SuccessResult result) {
        System.debug('Published ' + result.getEventUuids().size() + ' events');
    }
}
```

```apex
// Generate EventUuid values client-side so callback results can be correlated to the publish call.
Order_Event__e event =
    (Order_Event__e) Order_Event__e.sObjectType.newSObject(null, true);
event.Order_Number__c = 'SO-1001';
List<Database.SaveResult> results =
    EventBus.publish(new List<Order_Event__e>{ event }, new OrderPublishCallback());
```

Callback rules and limits:

| Item | Value |
| --- | --- |
| Running user | Automated Process, so `CreatedById` and `OwnerId` on records created in the callback are Automated Process |
| Cumulative size of all publish callbacks in the last 30 minutes | 5 MB (rolling); monitor `PublishCallbackUsageInApex` on the REST `limits` resource |
| Recursive `EventBus.publish` with a callback from inside a callback | 10 |
| Accounting | the callback instance size is counted **at publish time**, even if the callback method never runs |
| Availability | high-volume events only |

Publish one list in one `EventBus.publish` call rather than a call per event; it is more efficient and
keeps callback accounting down.

## 5. Subscribing with Apex triggers

Apex event triggers are `after insert` only.

| Property | Value |
| --- | --- |
| Default running user | Automated Process (override with `PlatformEventSubscriberConfig`) |
| Default batch size | 2,000 event messages |
| Governor limits | **synchronous** limits apply, even though the trigger runs asynchronously |
| Limit resets | the trigger runs in its own transaction, so limits reset per invocation |
| Callouts | generally not allowed from triggers; see Implementation Considerations for triggers |
| `OwnerId` of records saved in the trigger | the trigger's running user |

### Uncaught exceptions

If an uncaught exception occurs, the trigger stops and does not process the rest of the batch. DML
performed before the exception **is committed** and not rolled back, which is what makes
`setResumeCheckpoint()` usable. DML is rolled back only when:

- the trigger throws `EventBus.RetryableException`, or
- the trigger exceeds the 10-minute Apex transaction execution-time limit.

Platform event triggers do not send exception emails for general unhandled exceptions (unlike object
triggers). Use Event Monitoring event log files to find them.

### `EventBus.TriggerContext`

```apex
trigger ControlBatchSizeTrigger on Low_Ink__e (after insert) {
    Integer counter = 0;
    for (Low_Ink__e event : Trigger.New) {
        counter++;
        if (counter > 200) {
            break;   // resume from the last checkpoint on the next invocation
        }
        // process event ...
        EventBus.TriggerContext.currentContext().setResumeCheckpoint(event.ReplayId);
    }
}
```

| Member | Purpose |
| --- | --- |
| `EventBus.TriggerContext.currentContext()` | the current context instance |
| `.setResumeCheckpoint(replayId)` | next invocation resumes **after** this replay id |
| `.retries` | number of retries so far (populated only for `RetryableException` retries) |
| `.lastError` | last error message (populated only for `RetryableException` retries) |

`setResumeCheckpoint(replayId)` does not stop the current trigger execution; it only records where a
future invocation should resume.

### `EventBus.RetryableException`

```apex
trigger ResendEventsTrigger on Low_Ink__e (after insert) {
    if (conditionMet) {
        // process events
    } else if (EventBus.TriggerContext.currentContext().retries < 4) {
        throw new EventBus.RetryableException('Condition is not met, so retrying the trigger.');
    } else {
        // give up: notify, log, or route to a dead-letter object
    }
}
```

- The whole batch is resent, in original `ReplayId` order; replay ids are unchanged but the resent
  batch may be **larger** than the original.
- Delay grows with each retry.
- Cap: 10 runs total (initial run plus 9 retries). After the ninth retry the subscriber moves to the
  error state, disconnects, and events published while it is down are **not** resent. Fix and save the
  trigger to resume.
- Salesforce recommends staying below 9 retries. `EventBusSubscriber.Retries` (API 43.0 and later) is
  the queryable equivalent of `TriggerContext.retries`.
- The error-state email goes to the developer in the trigger's Last Modified By field, plus anyone on
  the Setup -> Apex Exception Email page (also configurable through the Tooling API
  `ApexEmailNotification` object).

### `setResumeCheckpoint()` versus `EventBus.RetryableException`

| Aspect | `setResumeCheckpoint()` | `EventBus.RetryableException` |
| --- | --- | --- |
| Use when | some events were processed successfully before an unhandled exception such as a limit exception | an external condition or transient error is expected to clear |
| Trigger execution | continues after the call | halts when thrown |
| DML before the failure | committed | rolled back |
| Events resent | only those after the checkpointed replay id, plus new events | the entire previous batch, plus new events |
| `TriggerContext.retries` / `.lastError` | not populated | populated |
| Cap | none | 9 retries after the initial run |

Using both together is supported only via the trigger template in the *Apply Best Practices for
Writing Platform Event Triggers* Trailhead unit; other combinations are unsupported.

### Parallel subscriptions

For custom high-volume events only (not standard events and not change events). Configure with
`PlatformEventSubscriberConfig` in Tooling API or Metadata API.

| Field | Meaning |
| --- | --- |
| `NumPartitions` | number of parallel subscriptions, 1-10 |
| `PartitionKey` | hashed to pick a partition. Either the standard field name `EventUuid`, or a **required** custom field written as `EventName__e.FieldName__c` |
| `PlatformEventConsumerId` / `platformEventConsumer` | the Apex trigger (id in Tooling API, name in Metadata API) |

| Limit | Value |
| --- | --- |
| Partitions per Apex trigger | 10 |
| Apex triggers configurable for parallel subscriptions per org | 5 (monitor `PlatformEventTriggersWithParallelProcessing` on the REST `limits` resource) |

```xml
<?xml version="1.0" encoding="UTF-8"?>
<PlatformEventSubscriberConfig xmlns="http://soap.sforce.com/2006/04/metadata">
    <batchSize>200</batchSize>
    <masterLabel>OrderEventTriggerConfig</masterLabel>
    <numPartitions>3</numPartitions>
    <partitionKey>Order_Event__e.Order_Number__c</partitionKey>
    <platformEventConsumer>OrderEventTrigger</platformEventConsumer>
    <user>integration@example.com</user>
</PlatformEventSubscriberConfig>
```

Ordering is preserved within a partition, not across partitions. Choose a partition key that groups
events that must stay ordered relative to each other (for example the order number).

## 6. External subscribers

| Channel form | Used by |
| --- | --- |
| `/event/Event_Name__e` | Pub/Sub API and CometD |
| `/event/Channel_Name__chn` | custom channel |
| `/data/Object__ChangeEvent` | a single object's change events |
| `/data/Custom_Object__c__ChangeEvent` | custom object change events |
| `/data/ChangeEvents` | all change events for objects selected for Change Data Capture |
| CometD endpoint | `/cometd/<apiVersion>` |

Pub/Sub API (gRPC, HTTP/2, binary payloads) is the current recommendation; CometD Streaming API is
older. Recommended client buffer sizes: 3 MB for Pub/Sub API, at least 10 MB for CometD. Apex
triggers can subscribe to a single change event object, never to `/data/ChangeEvents`.

## 7. Change Data Capture

Purpose: continuous synchronisation (step 2 of replication: day-0 copy, continuous sync,
reconciliation). CDC publishes deltas for created, updated, deleted, and undeleted records; it does
**not** perform the initial copy.

Capabilities: event retention of three days, broad access regardless of sharing rules, field-level
security applied per subscriber, encryption of change event fields at rest, versioned event schema,
and change origin information so a client can ignore its own writes.

### `EventBus.ChangeEventHeader` properties

Accessed as properties on the header object (`event.ChangeEventHeader`). The CDC guide also documents
a `getRecordIds()` accessor on the header.

| Property | Meaning |
| --- | --- |
| `entityname` | API name of the changed object |
| `recordids` | one or more record ids. Salesforce merges identical changes to multiple records of the same type within one second into one event. Can be a wildcard such as `001*` for custom-field type conversions that cause data loss |
| `changetype` | `CREATE`, `UPDATE`, `DELETE`, `UNDELETE`, `SNAPSHOT` (reserved), or `GAP_CREATE` / `GAP_UPDATE` / `GAP_DELETE` / `GAP_UNDELETE` / `GAP_OVERFLOW` |
| `changedfields` | fields changed in an update, including `LastModifiedDate`; empty for other operations. API 47.0 and later, present in both Apex and JSON messages |
| `nulledfields` | fields explicitly set to null in an update. **Apex triggers and Pub/Sub API only**, not CometD |
| `difffields` | fields sent as a unified diff because they hold large text. **Apex triggers and Pub/Sub API only** |
| `changeorigin` | the Salesforce API and client id that made the change, when set by the client. Use it to skip changes your own app made |
| `commituser` | id of the user who ran the change |
| `committimestamp` | change time in milliseconds since 1970-01-01T00:00:00Z |
| `commitnumber` | system change number, sequential within one database instance only; diagnostic use |
| `transactionkey` | uniquely identifies a Salesforce transaction; group all changes from one transaction |
| `sequencenumber` | sequence of this change within the transaction, starting at 1 |

All record fields are statically present in the Apex change event type. **Unchanged fields are
null.** Use `changedfields` to tell "changed" from "absent", and `nulledfields` to tell "changed to
null" from "unchanged".

### Change event trigger

```apex
trigger MyAccountChangeTrigger on AccountChangeEvent (after insert) {
    List<Task> tasks = new List<Task>();
    for (AccountChangeEvent event : Trigger.New) {
        EventBus.ChangeEventHeader header = event.ChangeEventHeader;
        if (header.changeType == 'CREATE') {
            tasks.add(new Task(
                Subject = 'Follow up on new account: ' + header.recordIds,
                OwnerId = header.commitUser
            ));
        } else if (header.changeType == 'UPDATE') {
            for (String field : header.changedFields) {
                System.debug(field + ' -> ' + event.get(field));
            }
        }
    }
    insert as system tasks;
}
```

Change event triggers run asynchronously **after** the database transaction completes. Put
transaction-critical logic in the object trigger and resource-intensive work in the change event
trigger; the decoupling shortens the user-facing transaction.

### Gap and overflow events

A gap event carries only header fields and a `GAP_*` change type when Salesforce cannot generate a
full change event. `GAP_OVERFLOW` means the event is an overflow event. In both cases the subscriber
must re-read the affected records instead of trusting the payload. Apex triggers that fire on gap
events and create records can generate further change events, so guard against loops with
`changeorigin`.

## 8. Testing pointers

Full mechanics live in skill `sf-apex-testing`. Minimum contract:

- Publish inside `Test.startTest()` / `Test.stopTest()`, then call `Test.getEventBus().deliver()` to
  fire the subscriber trigger. Each `deliver()` call fires the trigger once, so a 201-event test needs
  two `deliver()` calls when the trigger caps itself at 200.
- Verify resumption by inspecting `EventBusSubscriber.Position`, which holds the replay id of the last
  processed event message.
- `EventBus.TestBroker` simulates successful delivery or failed publishing of platform event and
  change event messages inside a test.
- Change event triggers require Change Data Capture to be enabled for the object, or the test must
  use `Test.enableChangeDataCapture()`.

## 9. Source URLs

- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_intro.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_define_ui.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_publish_apex.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_publish_callbacks.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_publish_callback_limits.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_subscribe_apex.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_subscribe_batch_resume.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_subscribe_apex_refire.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_subscribe_compare_checkpoint_retryable.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_ps.htm
- https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/platform_events_trigger_config.htm
- https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_event_fields_header.htm
- https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_subscribe_apex_triggers.htm
- https://developer.salesforce.com/docs/atlas.en-us.change_data_capture.meta/change_data_capture/cdc_subscribe_delivery.htm
- PDF snapshots used while authoring: https://resources.docs.salesforce.com/264/latest/en-us/sfdc/pdf/platform_events.pdf and https://resources.docs.salesforce.com/262/latest/en-us/sfdc/pdf/salesforce_change_data_capture.pdf
