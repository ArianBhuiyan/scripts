/**
 * ServiceNow Business Rule:
 * CMDB Assessment Review State Handler
 *
 * Table:
 *   CMDB Assessment [u_cmdb_assessment]
 *
 * When to run:
 *   When: before
 *   Update: true
 *   Insert/Delete/Query: false
 *   Order: 200
 *   Advanced: true
 *
 * Filter condition:
 *   State changes
 *
 * Purpose:
 *   Treat Complete as the MVP EACM-approved/final state.
 *   Before an assessment can move to Complete, confirm the expected
 *   six response rows exist and each has a raw score. Then stamp
 *   Approved By and Approved Date when those fields are available.
 *
 * Notes:
 *   If the internal field names for Approved By or Approved Date differ
 *   in the instance, update CONFIG.assessmentApprovedByField and
 *   CONFIG.assessmentApprovedDateField before activating the rule.
 */
(function executeRule(current, previous /*null when async*/) {
    var CONFIG = {
        assessmentStateField: 'u_state',
        completeStateValue: 'complete',
        rejectedStateValue: 'rejected',

        assessmentApprovedByField: 'u_approved_by',
        assessmentApprovedDateField: 'u_approved_date',

        responseTable: 'u_cmdb_assessment_responses',
        responseAssessmentField: 'u_assessment',
        responseRawScoreField: 'u_raw_score',
        expectedResponseCount: 6,

        clearApprovalWhenRejected: true,
        clearApprovalWhenReopened: true
    };

    var oldState = previous ?
        String(previous.getValue(CONFIG.assessmentStateField) || '') :
        '';
    var newState = String(current.getValue(CONFIG.assessmentStateField) || '');

    if (oldState === newState) {
        return;
    }

    if (newState === CONFIG.completeStateValue) {
        if (!hasCompleteResponseSet(current.getUniqueValue())) {
            current.setAbortAction(true);
            return;
        }

        stampApprovalFields();
        gs.info(
            '[CMDB Assessment Review] Assessment completed by EACM: ' +
            current.getUniqueValue()
        );
        return;
    }

    if (
        newState === CONFIG.rejectedStateValue &&
        CONFIG.clearApprovalWhenRejected
    ) {
        clearApprovalFields();
        gs.info(
            '[CMDB Assessment Review] Assessment rejected by EACM: ' +
            current.getUniqueValue()
        );
        return;
    }

    if (
        oldState === CONFIG.completeStateValue &&
        CONFIG.clearApprovalWhenReopened
    ) {
        clearApprovalFields();
        gs.info(
            '[CMDB Assessment Review] Completed assessment reopened: ' +
            current.getUniqueValue()
        );
    }

    function hasCompleteResponseSet(assessmentSysId) {
        var response = new GlideRecord(CONFIG.responseTable);
        response.addQuery(CONFIG.responseAssessmentField, assessmentSysId);
        response.query();

        var responseCount = 0;
        var missingRawScoreCount = 0;

        while (response.next()) {
            responseCount++;

            if (gs.nil(response.getValue(CONFIG.responseRawScoreField))) {
                missingRawScoreCount++;
            }
        }

        if (responseCount !== CONFIG.expectedResponseCount) {
            gs.addErrorMessage(
                'Cannot complete this assessment until exactly ' +
                CONFIG.expectedResponseCount +
                ' response rows exist. Current response count: ' +
                responseCount +
                '.'
            );
            return false;
        }

        if (missingRawScoreCount > 0) {
            gs.addErrorMessage(
                'Cannot complete this assessment because ' +
                missingRawScoreCount +
                ' response row(s) are missing Raw Score.'
            );
            return false;
        }

        return true;
    }

    function stampApprovalFields() {
        if (current.isValidField(CONFIG.assessmentApprovedByField)) {
            current.setValue(CONFIG.assessmentApprovedByField, gs.getUserID());
        } else {
            gs.warn(
                '[CMDB Assessment Review] Approved By field not found: ' +
                CONFIG.assessmentApprovedByField
            );
        }

        if (current.isValidField(CONFIG.assessmentApprovedDateField)) {
            current.setValue(CONFIG.assessmentApprovedDateField, gs.nowDateTime());
        } else {
            gs.warn(
                '[CMDB Assessment Review] Approved Date field not found: ' +
                CONFIG.assessmentApprovedDateField
            );
        }
    }

    function clearApprovalFields() {
        if (current.isValidField(CONFIG.assessmentApprovedByField)) {
            current.setValue(CONFIG.assessmentApprovedByField, '');
        }

        if (current.isValidField(CONFIG.assessmentApprovedDateField)) {
            current.setValue(CONFIG.assessmentApprovedDateField, '');
        }
    }
})(current, previous);
