/**
 * ServiceNow Business Rule:
 * CMDB Assessment Rejection Handler
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
 *   State changes to Rejected
 *
 * Purpose:
 *   Keep Intern 2's rejection flow separate from Intern 1's Complete/risk
 *   score flow. When EACM rejects an assessment, require a rejection reason,
 *   assign the assessment back to Owner Group for correction, and clear
 *   approval stamps if those fields exist.
 */
(function executeRule(current, previous /*null when async*/) {
    var CONFIG = {
        assessmentAssignedGroupField: 'u_assigned_group',
        assessmentOwnerGroupField: 'u_owner_group',
        assessmentRejectionReasonField: 'u_rejection_reason',
        assessmentApprovedByField: 'u_approved_by',
        assessmentApprovedDateField: 'u_approved_date',

        requireRejectionReason: true,
        assignOwnerGroupWhenRejected: true,
        clearApprovalWhenRejected: true
    };

    if (!hasRejectionReason()) {
        current.setAbortAction(true);
        return;
    }

    if (CONFIG.clearApprovalWhenRejected) {
        clearApprovalFields();
    }

    if (CONFIG.assignOwnerGroupWhenRejected) {
        assignBackToOwnerGroup();
    }

    gs.info(
        '[CMDB Assessment Rejection] Assessment rejected by EACM: ' +
        current.getUniqueValue()
    );

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

    function clearApprovalFields() {
        if (current.isValidField(CONFIG.assessmentApprovedByField)) {
            current.setValue(CONFIG.assessmentApprovedByField, '');
        }

        if (current.isValidField(CONFIG.assessmentApprovedDateField)) {
            current.setValue(CONFIG.assessmentApprovedDateField, '');
        }
    }

    function assignBackToOwnerGroup() {
        if (
            !current.isValidField(CONFIG.assessmentAssignedGroupField) ||
            !current.isValidField(CONFIG.assessmentOwnerGroupField)
        ) {
            gs.warn(
                '[CMDB Assessment Rejection] Assignment fields are not available for rejection routing.'
            );
            return;
        }

        var ownerGroup = String(
            current.getValue(CONFIG.assessmentOwnerGroupField) || ''
        ).trim();

        if (!ownerGroup) {
            gs.warn(
                '[CMDB Assessment Rejection] Rejected assessment has no Owner Group to assign back to: ' +
                current.getUniqueValue()
            );
            return;
        }

        current.setValue(CONFIG.assessmentAssignedGroupField, ownerGroup);
    }
})(current, previous);
