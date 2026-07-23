/**
 * ServiceNow Notification Email Script:
 * cmdb_assessment_rejection_link
 *
 * Use in Notification body:
 *   ${mail_script:cmdb_assessment_rejection_link}
 *
 * Notification:
 *   CMDB Assessment Rejected - Owner Correction Required
 *
 * Table:
 *   CMDB Assessment [u_cmdb_assessment]
 *
 * Purpose:
 *   Render a safe Service Portal Catalog Item link that lets the owner
 *   resubmit the existing rejected assessment. The Catalog Item submit
 *   handler updates existing response rows, so resubmission should not
 *   create duplicate responses.
 */
(function runMailScript(current, template, email, email_action, event) {
    var CONFIG = {
        catalogItemBaseUrl: '/sp?id=sc_cat_item&sys_id=49a8177f3bb54b106879d3c643e45a63',
        assessmentClassField: 'u_class',
        assessmentOwnerGroupField: 'u_owner_group',
        assessmentAssignedGroupField: 'u_assigned_group',
        assessmentYearField: 'u_assessment_year'
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function encodeUrlValue(value) {
        return encodeURIComponent(String(value || ''));
    }

    function absoluteUrl(url) {
        url = String(url || '');

        if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) {
            return url;
        }

        if (url.indexOf('/') === 0) {
            var baseUrl = String(gs.getProperty('glide.servlet.uri') || '');

            if (baseUrl && baseUrl.charAt(baseUrl.length - 1) === '/') {
                baseUrl = baseUrl.substring(0, baseUrl.length - 1);
            }

            return baseUrl + url;
        }

        return url;
    }

    function getDisplayValue(fieldName) {
        if (!current.isValidField(fieldName)) {
            return '';
        }

        return String(current.getDisplayValue(fieldName) || '').trim();
    }

    function getValue(fieldName) {
        if (!current.isValidField(fieldName)) {
            return '';
        }

        return String(current.getValue(fieldName) || '').trim();
    }

    var assessmentSysId = current.getUniqueValue();
    var className = getDisplayValue(CONFIG.assessmentClassField);
    var ownerGroup =
        getDisplayValue(CONFIG.assessmentOwnerGroupField) ||
        getDisplayValue(CONFIG.assessmentAssignedGroupField);
    var assessmentYear =
        getValue(CONFIG.assessmentYearField) ||
        getDisplayValue(CONFIG.assessmentYearField);

    var catalogUrl = absoluteUrl(
        CONFIG.catalogItemBaseUrl +
        '&sysparm_assessment_sys_id=' +
        encodeUrlValue(assessmentSysId) +
        '&sysparm_class_name=' +
        encodeUrlValue(className) +
        '&sysparm_owner_group=' +
        encodeUrlValue(ownerGroup) +
        '&sysparm_assessment_year=' +
        encodeUrlValue(assessmentYear)
    );

    template.print(
        '<p><a href="' +
        escapeHtml(catalogUrl) +
        '">Resubmit CMDB Assessment</a></p>'
    );
})(current, template, email, email_action, event);
