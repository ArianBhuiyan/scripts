/**
 * UI Action: Reject CMDB Assessment
 *
 * Table:
 *   u_cmdb_assessment
 *
 * Recommended UI Action settings:
 *   Name: Reject Assessment
 *   Action name: reject_cmdb_assessment
 *   Table: CMDB Assessment [u_cmdb_assessment]
 *   Active: true
 *   Show insert: false
 *   Show update: true
 *   Form button: true
 *   Client: false
 *   Condition:
 *     current.u_state == 'under_review'
 *
 * Required fields on u_cmdb_assessment:
 *   u_state
 *   u_rejection_reason
 *
 * Optional fields on u_cmdb_assessment:
 *   u_reviewed_by
 *   u_reviewed_on
 */
(function executeAction(current, previous) {
    var CONFIG = {
        stateField: 'u_state',
        underReviewStateValue: 'under_review',
        rejectedStateValue: 'rejected',
        rejectionReasonField: 'u_rejection_reason',
        reviewedByField: 'u_reviewed_by',
        reviewedOnField: 'u_reviewed_on'
    };

    function redirectBack() {
        action.setRedirectURL(current);
    }

    if (!current.isValidRecord()) {
        gs.addErrorMessage('Cannot reject this assessment because the record is invalid.');
        redirectBack();
        return;
    }

    if (!current.isValidField(CONFIG.stateField)) {
        gs.addErrorMessage('Cannot reject this assessment because field ' + CONFIG.stateField + ' does not exist.');
        redirectBack();
        return;
    }

    if (!current.isValidField(CONFIG.rejectionReasonField)) {
        gs.addErrorMessage('Cannot reject this assessment because field ' + CONFIG.rejectionReasonField + ' does not exist.');
        redirectBack();
        return;
    }

    if (current.getValue(CONFIG.stateField) !== CONFIG.underReviewStateValue) {
        gs.addErrorMessage('Only assessments in Under Review can be rejected.');
        redirectBack();
        return;
    }

    var rejectionReason = (current.getValue(CONFIG.rejectionReasonField) || '').trim();

    if (!rejectionReason) {
        gs.addErrorMessage('Enter a rejection reason before rejecting this assessment.');
        redirectBack();
        return;
    }

    current.setValue(CONFIG.stateField, CONFIG.rejectedStateValue);

    if (current.isValidField(CONFIG.reviewedByField)) {
        current.setValue(CONFIG.reviewedByField, gs.getUserID());
    }

    if (current.isValidField(CONFIG.reviewedOnField)) {
        current.setValue(CONFIG.reviewedOnField, new GlideDateTime());
    }

    current.update();

    gs.addInfoMessage('Assessment rejected and returned to the assigned group.');
    redirectBack();
})(current, previous);
