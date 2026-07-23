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
 *   When an assessment is rejected, clear approval stamps and route the
 *   assessment back to the owner group for correction when possible.
 *   Rejections require an EACM-entered rejection reason so the owner
 *   knows what to correct.
 *
 * Notes:
 *   If the internal field names for Approved By or Approved Date differ
 *   in the instance, update CONFIG.assessmentApprovedByField and
 *   CONFIG.assessmentApprovedDateField before activating the rule.
 *   Create a multi-line text field named u_rejection_reason before
 *   enabling requireRejectionReason.
 */
(function executeRule(current, previous /*null when async*/) {
    var CONFIG = {
        assessmentStateField: 'u_state',
        completeStateValue: 'complete',
        rejectedStateValue: 'rejected',

        assessmentApprovedByField: 'u_approved_by',
        assessmentApprovedDateField: 'u_approved_date',
        assessmentAssignedGroupField: 'u_assigned_group',
        assessmentOwnerGroupField: 'u_owner_group',
        assessmentRejectionReasonField: 'u_rejection_reason',

        responseTable: 'u_cmdb_assessment_responses',
        responseAssessmentField: 'u_assessment',
        responseRawScoreField: 'u_raw_score',
        expectedResponseCount: 6,

        clearApprovalWhenRejected: true,
        clearApprovalWhenReopened: true,
        assignOwnerGroupWhenRejected: true,
        requireRejectionReason: true
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
        if (!hasRejectionReason()) {
            current.setAbortAction(true);
            return;
        }

        clearApprovalFields();
        assignBackToOwnerGroup();
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

    function hasRejectionReason() {
        if (!CONFIG.requireRejectionReason) {
            return true;
        }

        if (!current.isValidField(CONFIG.assessmentRejectionReasonField)) {
            gs.addErrorMessage(
                'Cannot reject this assessment because the Rejection Reason field is missing. Create field ' +
                CONFIG.assessmentRejectionReasonField +
                ' on CMDB Assessment.'
            );
            return false;
        }

        var rejectionReason = String(
            current.getValue(CONFIG.assessmentRejectionReasonField) || ''
        ).trim();

        if (!rejectionReason) {
            gs.addErrorMessage(
                'Enter a Rejection Reason before setting this assessment to Rejected.'
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

    function assignBackToOwnerGroup() {
        if (!CONFIG.assignOwnerGroupWhenRejected) {
            return;
        }

        if (
            !current.isValidField(CONFIG.assessmentAssignedGroupField) ||
            !current.isValidField(CONFIG.assessmentOwnerGroupField)
        ) {
            gs.warn(
                '[CMDB Assessment Review] Assignment fields are not available for rejection routing.'
            );
            return;
        }

        var ownerGroup = String(
            current.getValue(CONFIG.assessmentOwnerGroupField) || ''
        ).trim();

        if (!ownerGroup) {
            gs.warn(
                '[CMDB Assessment Review] Rejected assessment has no Owner Group to assign back to: ' +
                current.getUniqueValue()
            );
            return;
        }

        current.setValue(CONFIG.assessmentAssignedGroupField, ownerGroup);
    }
})(current, previous);
