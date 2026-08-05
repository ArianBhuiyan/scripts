/**
 * ServiceNow Flow Designer custom Action Script step:
 * Prepare Created Assessment Notifications
 *
 * Action inputs:
 *   created_assessments_json String     JSON array returned by Generate Annual CMDB Assessments.
 *   notification_dry_run     True/False Keep true while validating notification payloads.
 *   event_name               String     Optional event name for future real notification queueing.
 *
 * Script outputs:
 *   summary                   String JSON execution statistics.
 *   notification_payload_json String JSON array of batched notification/link data.
 *
 * Purpose:
 *   Keep assessment generation separate from notification handling.
 *   This Action parses the generated assessment link data and prepares one
 *   notification payload per assigned group. That keeps the MVP from sending
 *   one email per assessment when the same owner/group has multiple classes.
 *   In dry-run mode it only logs the payload. When notification_dry_run is
 *   false, it queues one ServiceNow event per assigned group. The event must
 *   exist in Event Registry and have a Notification configured before real
 *   sending is useful.
 */
(function execute(inputs, outputs) {
    var CONFIG = {
        assessmentTable: 'u_cmdb_assessment',
        assessmentClassField: 'u_class',
        assessmentYearField: 'u_assessment_year',
        assessmentAssignedGroupField: 'u_assigned_group',
        defaultEventName: 'u.cmdb.assessment.catalog.ready',
        instanceBaseUrl: 'https://mtb.service-now.com',
        emailSubject: 'CMDB Annual Risk Assessments Ready'
    };

    var notificationDryRun = String(inputs.notification_dry_run) !== 'false';
    var eventName = String(inputs.event_name || CONFIG.defaultEventName).trim();
    var rawCreatedAssessments = String(inputs.created_assessments_json || '[]');

    var stats = {
        received: 0,
        prepared: 0,
        assessmentLinksPrepared: 0,
        queued: 0,
        skippedInvalidRow: 0,
        skippedMissingAssessment: 0,
        failed: 0,
        notificationDryRun: notificationDryRun,
        eventName: eventName
    };

    var notificationPayloads = [];
    var payloadsByAssignedGroup = {};
    var payloadOrder = [];
    var createdAssessments;

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function absoluteUrl(url) {
        url = String(url || '').trim();

        if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
            return url;
        }

        if (url.indexOf('/') === 0) {
            return CONFIG.instanceBaseUrl + url;
        }

        return url;
    }

    function buildLinkLabel(item) {
        var label = item.class_name || 'CMDB class';

        if (item.assessment_year) {
            label += ' - ' + item.assessment_year;
        }

        if (item.assessment_display) {
            label += ' (' + item.assessment_display + ')';
        }

        return label;
    }

    function buildEmailHtml(payload) {
        var html = [];

        html.push('<p>Hello,</p>');
        html.push(
            '<p>Your group has CMDB Annual Risk Assessment(s) ready for completion.</p>'
        );
        html.push(
            '<p>Please complete each assessment using the link(s) below:</p>'
        );
        html.push('<ul>');

        for (var i = 0; i < payload.assessments.length; i++) {
            var item = payload.assessments[i];
            html.push(
                '<li><a href="' +
                escapeHtml(item.catalog_url) +
                '">' +
                escapeHtml(buildLinkLabel(item)) +
                '</a></li>'
            );
        }

        html.push('</ul>');
        html.push('<p>Thank you.</p>');

        return html.join('');
    }

    try {
        createdAssessments = JSON.parse(rawCreatedAssessments);

        if (!Array.isArray(createdAssessments)) {
            throw new Error('created_assessments_json must be a JSON array');
        }
    } catch (parseError) {
        stats.failed++;
        outputs.summary = JSON.stringify(stats);
        outputs.notification_payload_json = JSON.stringify(notificationPayloads);
        gs.error(
            '[Annual Assessment Notification] Invalid created_assessments_json: ' +
            parseError.message
        );
        return;
    }

    for (var i = 0; i < createdAssessments.length; i++) {
        stats.received++;

        var row = createdAssessments[i] || {};
        var assessmentSysId = String(row.assessment_sys_id || '').trim();
        var catalogUrl = absoluteUrl(row.catalog_url);

        if (!assessmentSysId || !catalogUrl) {
            stats.skippedInvalidRow++;
            gs.warn(
                '[Annual Assessment Notification] Skipping invalid row: ' +
                JSON.stringify(row)
            );
            continue;
        }

        var assessment = new GlideRecord(CONFIG.assessmentTable);

        if (!assessment.get(assessmentSysId)) {
            stats.skippedMissingAssessment++;
            gs.warn(
                '[Annual Assessment Notification] Assessment not found: ' +
                assessmentSysId
            );
            continue;
        }

        var assignedGroup =
            String(row.assigned_group || '').trim() ||
            assessment.getValue(CONFIG.assessmentAssignedGroupField);

        if (!assignedGroup) {
            stats.skippedInvalidRow++;
            gs.warn(
                '[Annual Assessment Notification] Skipping assessment with no assigned group: ' +
                assessmentSysId
            );
            continue;
        }

        if (!payloadsByAssignedGroup[assignedGroup]) {
            payloadsByAssignedGroup[assignedGroup] = {
                assigned_group: assignedGroup,
                assigned_group_display: assessment.getDisplayValue(
                    CONFIG.assessmentAssignedGroupField
                ),
                event_record_sys_id: assessmentSysId,
                assessment_count: 0,
                assessments: [],
                catalog_urls: [],
                link_list_text: '',
                email_subject: CONFIG.emailSubject,
                email_html_body: ''
            };
            payloadOrder.push(assignedGroup);
        }

        var assessmentPayload = {
            assessment_sys_id: assessmentSysId,
            assessment_display: assessment.getDisplayValue(),
            class_name:
                String(row.class_name || '').trim() ||
                assessment.getDisplayValue(CONFIG.assessmentClassField),
            assessment_year: assessment.getValue(CONFIG.assessmentYearField),
            catalog_url: catalogUrl
        };

        payloadsByAssignedGroup[assignedGroup].assessments.push(
            assessmentPayload
        );
        payloadsByAssignedGroup[assignedGroup].catalog_urls.push(catalogUrl);
        payloadsByAssignedGroup[assignedGroup].assessment_count++;
        stats.assessmentLinksPrepared++;
    }

    for (var j = 0; j < payloadOrder.length; j++) {
        var groupSysId = payloadOrder[j];
        var payload = payloadsByAssignedGroup[groupSysId];

        var linkLines = [];

        for (var k = 0; k < payload.assessments.length; k++) {
            var item = payload.assessments[k];
            linkLines.push(
                '- ' +
                item.class_name +
                ' (' +
                item.assessment_year +
                '): ' +
                item.catalog_url
            );
        }

        payload.link_list_text = linkLines.join('\n');
        payload.email_html_body = buildEmailHtml(payload);
        notificationPayloads.push(payload);
        stats.prepared++;

        if (notificationDryRun) {
            gs.info(
                '[Annual Assessment Notification] DRY RUN batch payload: ' +
                JSON.stringify(payload)
            );
            continue;
        }

        try {
            var eventRecord = new GlideRecord(CONFIG.assessmentTable);

            if (!eventRecord.get(payload.event_record_sys_id)) {
                stats.skippedMissingAssessment++;
                gs.warn(
                    '[Annual Assessment Notification] Event record not found: ' +
                    payload.event_record_sys_id
                );
                continue;
            }

            gs.eventQueue(
                eventName,
                eventRecord,
                payload.email_html_body,
                JSON.stringify(payload)
            );
            stats.queued++;
        } catch (queueError) {
            stats.failed++;
            gs.error(
                '[Annual Assessment Notification] Failed to queue event for group ' +
                groupSysId +
                ': ' +
                queueError.message
            );
        }
    }

    outputs.summary = JSON.stringify(stats);
    outputs.notification_payload_json = JSON.stringify(notificationPayloads);

    gs.info('[Annual Assessment Notification] Summary: ' + outputs.summary);
    gs.info(
        '[Annual Assessment Notification] Payload JSON: ' +
        outputs.notification_payload_json
    );
})(inputs, outputs);
