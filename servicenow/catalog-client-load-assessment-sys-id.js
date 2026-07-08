/*
 * ServiceNow Catalog Client Script
 *
 * Catalog Item: CMDB Annual Risk Assessment
 * Type: onLoad
 * UI Type: All
 *
 * Purpose:
 * Reads sysparm_assessment_sys_id from the Catalog Item URL and copies it into
 * the hidden/read-only assessment_sys_id variable.
 *
 * Expected URL format:
 * sp?id=sc_cat_item&sys_id=49a8177f3bb54b106879d3c643e45a63&sysparm_assessment_sys_id=<assessment_sys_id>
 */
function onLoad() {
  var params = new URLSearchParams(top.location.href);
  var assessmentSysId = params.get('sysparm_assessment_sys_id');

  if (assessmentSysId) {
    g_form.setValue('assessment_sys_id', assessmentSysId);
    g_form.setReadOnly('assessment_sys_id', true);
  }
}
