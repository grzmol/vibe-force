/**
 * vibe-force post-deploy smoke script.
 *
 * Run by:  node "${CLAUDE_PLUGIN_ROOT}/scripts/checks/vf-check.mjs" smoke --target-org <alias>
 * which executes it with:  sf apex run --file scripts/apex/smoke.apex --target-org <alias> --json
 *
 * Contract with the runner:
 *   - Every line containing VF_SMOKE_FAIL becomes a high-severity finding.
 *   - An uncaught exception or a compile error becomes a critical finding.
 *   - Lines containing VF_SMOKE_OK are informational.
 * Keep the script read-only. It runs against real orgs, including production, where `smoke` is
 * allowed with a banner instead of being refused.
 *
 * Adapt the assertions to the release being verified; the checks below are the generic ones that
 * hold for any org.
 */

String result = '';
Integer failures = 0;

// ---------------------------------------------------------------------------
// 1. Apex compilation state. A class left inactive after a deploy is a broken release.
//    API version 67.0+ runs Apex in user mode by default; `WITH USER_MODE` states the
//    enforcement explicitly. `WITH SECURITY_ENFORCED` is not allowed at 67.0 or later.
// ---------------------------------------------------------------------------
List<ApexClass> brokenClasses = [
    SELECT Id, Name, Status
    FROM ApexClass
    WHERE Status != 'Active' AND NamespacePrefix = NULL
    WITH USER_MODE
    LIMIT 50
];
if (!brokenClasses.isEmpty()) {
    failures++;
    List<String> names = new List<String>();
    for (ApexClass cls : brokenClasses) {
        names.add(cls.Name + '(' + cls.Status + ')');
    }
    System.debug(LoggingLevel.ERROR, 'VF_SMOKE_FAIL inactive Apex classes: ' + String.join(names, ', '));
} else {
    System.debug(LoggingLevel.INFO, 'VF_SMOKE_OK all local Apex classes are Active');
}

// ---------------------------------------------------------------------------
// 2. Trigger state.
// ---------------------------------------------------------------------------
Integer brokenTriggers = [
    SELECT COUNT()
    FROM ApexTrigger
    WHERE Status != 'Active' AND NamespacePrefix = NULL
    WITH USER_MODE
];
if (brokenTriggers > 0) {
    failures++;
    System.debug(LoggingLevel.ERROR, 'VF_SMOKE_FAIL inactive Apex triggers: ' + brokenTriggers);
} else {
    System.debug(LoggingLevel.INFO, 'VF_SMOKE_OK all local Apex triggers are Active');
}

// ---------------------------------------------------------------------------
// 3. Describe reachability for the objects the release touches. Add your own API names here; a
//    missing field or object surfaces as a deploy that succeeded against the wrong org shape.
// ---------------------------------------------------------------------------
Set<String> requiredObjects = new Set<String>{ 'Account', 'Contact' };
for (String objectName : requiredObjects) {
    Schema.SObjectType sobjectType = Schema.getGlobalDescribe().get(objectName);
    if (sobjectType == null) {
        failures++;
        System.debug(LoggingLevel.ERROR, 'VF_SMOKE_FAIL object not visible to this user: ' + objectName);
        continue;
    }
    Schema.DescribeSObjectResult describe = sobjectType.getDescribe();
    if (!describe.isAccessible()) {
        failures++;
        System.debug(LoggingLevel.ERROR, 'VF_SMOKE_FAIL object not accessible: ' + objectName);
    }
}

// ---------------------------------------------------------------------------
// 4. Async backlog. Failed jobs in the last day usually belong to the release being verified.
// ---------------------------------------------------------------------------
Integer failedJobs = [
    SELECT COUNT()
    FROM AsyncApexJob
    WHERE Status = 'Failed' AND CreatedDate = LAST_N_DAYS:1
    WITH USER_MODE
];
if (failedJobs > 0) {
    failures++;
    System.debug(LoggingLevel.ERROR, 'VF_SMOKE_FAIL failed async Apex jobs in the last day: ' + failedJobs);
} else {
    System.debug(LoggingLevel.INFO, 'VF_SMOKE_OK no failed async Apex jobs in the last day');
}

// ---------------------------------------------------------------------------
// 5. Governor headroom for this transaction. A smoke run must stay far below every limit; if it
//    does not, the probes themselves are too heavy to trust.
// ---------------------------------------------------------------------------
Integer queriesUsed = Limits.getQueries();
Integer queryLimit = Limits.getLimitQueries();
if (queriesUsed > queryLimit / 2) {
    failures++;
    System.debug(
        LoggingLevel.ERROR,
        'VF_SMOKE_FAIL smoke script used ' + queriesUsed + ' of ' + queryLimit + ' SOQL queries'
    );
}

result = failures == 0 ? 'VF_SMOKE_OK all probes passed' : 'VF_SMOKE_FAIL ' + failures + ' probe(s) failed';
System.debug(LoggingLevel.INFO, result);
