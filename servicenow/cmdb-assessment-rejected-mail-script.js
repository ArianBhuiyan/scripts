/**
 * Notification Email Script: cmdb_assessment_rejected
 *
 * Purpose:
 *   Render the owner-facing rejection details and the Service Portal Catalog Item
 *   link so the assigned group can correct and resubmit the assessment.
 *
 * Recommended Notification:
 *   Name: CMDB Assessment Rejected - Action Required
 *   Table: u_cmdb_assessment
 *   Trigger: record updated
 *   Condition: State changes to Rejected
 *   Recipients: Users/Groups in fields -> Assigned Group
 *   Message HTML:
 *     ${mail_script:cmdb_assessment_rejected}
 */
(function runMailScript(current, template, email, email_action, event) {
    var CATALOG_ITEM_SYS_ID = '49a8177f3bb54b106879d3c643e45a63';

    function value(fieldName) {
        if (!current || !current.isValidField(fieldName)) {
            return '';
        }

        return current.getValue(fieldName) || '';
    }

    function display(fieldName) {
        if (!current || !current.isValidField(fieldName)) {
            return '';
        }

        return current.getDisplayValue(fieldName) || '';
    }

    function html(valueToEscape) {
        return GlideStringUtil.escapeHTML(String(valueToEscape || ''));
    }

    function urlParam(valueToEncode) {
        return encodeURIComponent(String(valueToEncode || ''));
    }

    var instanceUrl = gs.getProperty('glide.servlet.uri') || '';
    var assessmentSysId = current.getUniqueValue();
    var catalogUrl =
        instanceUrl +
        'sp?id=sc_cat_item&sys_id=' +
        CATALOG_ITEM_SYS_ID +
        '&sysparm_assessment_sys_id=' +
        urlParam(assessmentSysId) +
        '&sysparm_class_name=' +
        urlParam(display('u_class')) +
        '&sysparm_owner_group=' +
        urlParam(display('u_owner_group')) +
        '&sysparm_assessment_year=' +
        urlParam(value('u_assessment_year'));

    template.print('<p>Your CMDB assessment was reviewed by EACM and needs changes before it can be approved.</p>');

    template.print('<p>');
    template.print('<strong>Assessment Year:</strong> ' + html(value('u_assessment_year')) + '<br>');
    template.print('<strong>Class:</strong> ' + html(display('u_class')) + '<br>');
    template.print('<strong>Owner Group:</strong> ' + html(display('u_owner_group')) + '<br>');
    template.print('<strong>Assigned Group:</strong> ' + html(display('u_assigned_group')) + '<br>');
    template.print('<strong>Reviewed By:</strong> ' + html(display('u_reviewed_by')) + '<br>');
    template.print('<strong>Reviewed On:</strong> ' + html(display('u_reviewed_on')));
    template.print('</p>');

    template.print('<p><strong>Rejection Reason:</strong><br>');
    template.print(html(value('u_rejection_reason')).replace(/\n/g, '<br>'));
    template.print('</p>');

    template.print('<p>');
    template.print('<a href="' + html(catalogUrl) + '">Open the assessment form to correct and resubmit</a>');
    template.print('</p>');
})(current, template, email, email_action, event);
