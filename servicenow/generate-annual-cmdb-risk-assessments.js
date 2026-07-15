/**
 * ServiceNow Flow Designer custom Action Script step:
 * Generate Annual CMDB Risk Assessments
 *
 * Action inputs:
 *   assessment_year  String     Optional; defaults to the current local year.
 *   dry_run          True/False Keep true until candidate results are validated.
 *   class_name_filter String    Optional sys_class_name for single-class testing.
 *
 * Script output:
 *   summary                  String JSON execution statistics.
 *   created_assessments_json String JSON array of created assessment link data.
 *
 * Eligibility:
 *   Flow 1 no longer scans cmdb_ci directly. Eligibility comes from the
 *   CMDB Assessment Class Exclusions/master table. A class is a candidate when
 *   the master row is active and not excluded. The EACM team owns group
 *   assignment on that master table. If the master row has no owner group,
 *   Flow 1 skips it so EACM can complete manual assignment first.
 */
(function execute(inputs, outputs) {
    var CONFIG = {
        classInfoTable: 'cmdb_class_info',
        classInfoMatchField: 'class',

        masterTable: 'u_cmdb_assessment_class_exclusions',
        masterClassField: 'u_class',
        masterActiveField: 'u_active',
        masterExcludedField: 'u_excluded',
        masterOwnerGroupField: 'u_owner_group',

        assessmentTable: 'u_cmdb_assessment',
        assessmentClassField: 'u_class',
        assessmentYearField: 'u_assessment_year',
        assessmentStateField: 'u_state',
        assessmentAssignedGroupField: 'u_assigned_group',
        assessmentOwnerGroupField: 'u_owner_group',

        assignedStateValue: 'assigned',

        catalogItemBaseUrl: '/sp?id=sc_cat_item&sys_id=49a8177f3bb54b106879d3c643e45a63'
    };

    var dryRun = String(inputs.dry_run) === 'true';
    var classFilter = String(inputs.class_name_filter || '').trim();
    var year = String(
        inputs.assessment_year || new GlideDateTime().getYearLocalTime()
    );

    var stats = {
        assessmentYear: year,
        activeClasses: 0,
        wouldCreate: 0,
        created: 0,
        skippedExcluded: 0,
        skippedDuplicate: 0,
        skippedInactive: 0,
        skippedMissingClassInfo: 0,
        skippedMissingOwnerGroup: 0,
        routedToEacm: 0,
        failed: 0
    };

    var createdAssessments = [];

    function encodeUrlValue(value) {
        return encodeURIComponent(String(value || ''));
    }

    function buildCatalogUrl(assessmentSysId, className, ownerGroupDisplay) {
        return (
            CONFIG.catalogItemBaseUrl +
            '&sysparm_assessment_sys_id=' +
            encodeUrlValue(assessmentSysId) +
            '&sysparm_class_name=' +
            encodeUrlValue(className) +
            '&sysparm_owner_group=' +
            encodeUrlValue(ownerGroupDisplay) +
            '&sysparm_assessment_year=' +
            encodeUrlValue(year)
        );
    }

    // The master table is now the source of truth for Flow 1 eligibility.
    var master = new GlideRecord(CONFIG.masterTable);
    master.addQuery(CONFIG.masterActiveField, true);
    master.addNotNullQuery(CONFIG.masterClassField);

    if (classFilter) {
        master.addQuery(
            CONFIG.masterClassField + '.' + CONFIG.classInfoMatchField,
            classFilter
        );
    }

    master.query();

    while (master.next()) {
        stats.activeClasses++;

        if (String(master.getValue(CONFIG.masterExcludedField)) === '1') {
            stats.skippedExcluded++;
            continue;
        }

        var classSysId = master.getValue(CONFIG.masterClassField);

        var classInfo = new GlideRecord(CONFIG.classInfoTable);

        if (!classInfo.get(classSysId)) {
            stats.skippedMissingClassInfo++;
            gs.warn(
                '[Annual Assessment] Master row has missing class-info reference: ' +
                master.getUniqueValue()
            );
            continue;
        }

        var className = classInfo.getValue(CONFIG.classInfoMatchField);

        // Prevent duplicate assessments for the same class and year.
        var existing = new GlideRecord(CONFIG.assessmentTable);
        existing.addQuery(CONFIG.assessmentClassField, classSysId);
        existing.addQuery(CONFIG.assessmentYearField, year);
        existing.setLimit(1);
        existing.query();

        if (existing.hasNext()) {
            stats.skippedDuplicate++;
            continue;
        }

        // Owner group now comes only from the master table. Do not use
        // cmdb_class_info.managed_by_group for Flow 1 assignment.
        var ownerGroup = master.getValue(CONFIG.masterOwnerGroupField);
        var assignedGroup = ownerGroup;

        if (!ownerGroup) {
            stats.skippedMissingOwnerGroup++;
            gs.warn(
                '[Annual Assessment] Skipping ' +
                className +
                ' because master owner group is empty'
            );
            continue;
        }

        var assignedGroupDisplay = master.getDisplayValue(
            CONFIG.masterOwnerGroupField
        );

        if (dryRun) {
            stats.wouldCreate++;
            gs.info(
                '[Annual Assessment] DRY RUN: ' +
                className +
                ' would be assigned to ' +
                assignedGroupDisplay
            );
            continue;
        }

        var assessment = new GlideRecord(CONFIG.assessmentTable);
        assessment.initialize();
        assessment.setValue(CONFIG.assessmentClassField, classSysId);
        assessment.setValue(CONFIG.assessmentYearField, year);
        assessment.setValue(
            CONFIG.assessmentStateField,
            CONFIG.assignedStateValue
        );
        assessment.setValue(
            CONFIG.assessmentAssignedGroupField,
            assignedGroup
        );

        if (ownerGroup) {
            assessment.setValue(
                CONFIG.assessmentOwnerGroupField,
                ownerGroup
            );
        }

        var assessmentSysId = assessment.insert();

        if (assessmentSysId) {
            stats.created++;
            createdAssessments.push({
                assessment_sys_id: String(assessmentSysId),
                class_name: className,
                assigned_group: assignedGroup,
                assigned_group_display: assignedGroupDisplay,
                catalog_url: buildCatalogUrl(
                    assessmentSysId,
                    className,
                    assignedGroupDisplay
                )
            });
        } else {
            stats.failed++;
        }
    }

    outputs.summary = JSON.stringify(stats);
    outputs.created_assessments_json = JSON.stringify(createdAssessments);
    gs.info('[Annual Assessment] Summary: ' + outputs.summary);
    gs.info(
        '[Annual Assessment] Created Assessments JSON: ' +
        outputs.created_assessments_json
    );
})(inputs, outputs);
