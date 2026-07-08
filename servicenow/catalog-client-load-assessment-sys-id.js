/*
 * ServiceNow Catalog Client Script
 *
 * Catalog Item: CMDB Annual Risk Assessment
 * Type: onLoad
 * UI Type: All
 *
 * Purpose:
 * Reads assessment context from the Catalog Item URL and copies it into
 * hidden/read-only or read-only Catalog Item variables.
 *
 * Expected URL format:
 * sp?id=sc_cat_item&sys_id=49a8177f3bb54b106879d3c643e45a63
 *   &sysparm_assessment_sys_id=<assessment_sys_id>
 *   &sysparm_class_name=<class_display_name>
 *   &sysparm_owner_group=<owner_group_display_name>
 *   &sysparm_assessment_year=<assessment_year>
 */
function onLoad() {
  var params = new URLSearchParams(top.location.href);

  var assessmentSysId = params.get('sysparm_assessment_sys_id');
  var className = params.get('sysparm_class_name');
  var ownerGroup = params.get('sysparm_owner_group');
  var assessmentYear = params.get('sysparm_assessment_year');

  if (assessmentSysId) {
    g_form.setValue('assessment_sys_id', assessmentSysId);
    g_form.setReadOnly('assessment_sys_id', true);
    g_form.setDisplay('assessment_sys_id', false);
  }

  if (className) {
    g_form.setValue('class_name', className);
    g_form.setReadOnly('class_name', true);
  }

  if (ownerGroup) {
    g_form.setValue('owner_group', ownerGroup);
    g_form.setReadOnly('owner_group', true);
  }

  if (assessmentYear) {
    g_form.setValue('assessment_year', assessmentYear);
    g_form.setReadOnly('assessment_year', true);
  }
}
