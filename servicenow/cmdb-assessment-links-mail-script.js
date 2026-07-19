/**
 * ServiceNow Notification Email Script:
 * cmdb_assessment_links
 *
 * Use in Notification body:
 *   ${mail_script:cmdb_assessment_links}
 *
 * Event:
 *   u.cmdb.assessment.catalog.ready
 *
 * Payload contract from Prepare Created Assessment Notifications:
 *   event.parm1 = plain-text link list fallback
 *   event.parm2 = JSON payload for one assigned group
 */
(function runMailScript(current, template, email, email_action, event) {
    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

    function printPlainTextFallback() {
        var fallback = String(event.parm1 || '').trim();

        if (!fallback) {
            template.print(
                '<p>No assessment links were found for this notification.</p>'
            );
            return;
        }

        template.print('<pre>' + escapeHtml(fallback) + '</pre>');
    }

    var payload;

    try {
        payload = JSON.parse(event.parm2 || '{}');
    } catch (parseError) {
        printPlainTextFallback();
        return;
    }

    var assessments = payload.assessments || [];

    if (!assessments.length) {
        printPlainTextFallback();
        return;
    }

    template.print('<ul>');

    for (var i = 0; i < assessments.length; i++) {
        var item = assessments[i] || {};
        var className = item.class_name || 'CMDB class';
        var year = item.assessment_year || '';
        var assessmentDisplay = item.assessment_display || '';
        var url = absoluteUrl(item.catalog_url || '#');
        var label = className;

        if (year) {
            label += ' - ' + year;
        }

        if (assessmentDisplay) {
            label += ' (' + assessmentDisplay + ')';
        }

        template.print(
            '<li><a href="' +
            escapeHtml(url) +
            '">' +
            escapeHtml(label) +
            '</a></li>'
        );
    }

    template.print('</ul>');
})(current, template, email, email_action, event);
