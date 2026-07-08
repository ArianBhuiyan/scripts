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
 *   A class is a candidate when any cmdb_ci record in that class has
 *   install_status 1 (Installed) or 4 (Pending Install). Each class is
 *   processed once. An explicit exclusion or existing class/year assessment
 *   prevents creation.
 */
(function execute(inputs, outputs) {
    var CONFIG = {
        classInfoTable: 'cmdb_class_info',
        classInfoMatchField: 'class',
        classOwnerGroupField: 'managed_by_group',

        ciTable: 'cmdb_ci',
        ciClassField: 'sys_class_name',
        ciStatusField: 'install_status',
        activeStatusValues: ['1', '4'],

        exclusionTable: 'u_cmdb_assessment_class_exclusions',
        exclusionClassField: 'u_class',
        exclusionExcludedField: 'u_excluded',

        assessmentTable: 'u_cmdb_assessment',
        assessmentClassField: 'u_class',
        assessmentYearField: 'u_assessment_year',
        assessmentStateField: 'u_state',
        assessmentAssignedGroupField: 'u_assigned_group',
        assessmentOwnerGroupField: 'u_owner_group',

        assignedStateValue: 'assigned',
        eacmGroupSysId: '1774614b874f05d039e44226cebb3510',

        catalogItemUrlPrefix: 'sp?id=sc_cat_item&sys_id=49a8177f3bb54b106879d3c643e45a63&sysparm_assessment_sys_id='
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
        skippedMissingClassInfo: 0,
        routedToEacm: 0,
        failed: 0
    };

    var createdAssessments = [];

    // Filter qualifying CIs first, then return one aggregate row per class.
    var ciClasses = new GlideAggregate(CONFIG.ciTable);
    ciClasses.addQuery(
        CONFIG.ciStatusField,
        'IN',
        CONFIG.activeStatusValues.join(',')
    );
    ciClasses.addNotNullQuery(CONFIG.ciClassField);

    if (classFilter) {
        ciClasses.addQuery(CONFIG.ciClassField, classFilter);
    }

    ciClasses.addAggregate('COUNT');
    ciClasses.groupBy(CONFIG.ciClassField);
    ciClasses.query();

    while (ciClasses.next()) {
        stats.activeClasses++;

        var className = ciClasses.getValue(CONFIG.ciClassField);

        // Match the raw CI class table name to cmdb_class_info.
        var classInfo = new GlideRecord(CONFIG.classInfoTable);
        classInfo.addQuery(CONFIG.classInfoMatchField, className);
        classInfo.setLimit(1);
        classInfo.query();

        if (!classInfo.next()) {
            stats.skippedMissingClassInfo++;
            gs.warn(
                '[Annual Assessment] No class-info record for ' + className
            );
            continue;
        }

        var classSysId = classInfo.getUniqueValue();

        // Only an explicit true exclusion blocks a class.
        var exclusion = new GlideRecord(CONFIG.exclusionTable);
        exclusion.addQuery(CONFIG.exclusionClassField, classSysId);
        exclusion.addQuery(CONFIG.exclusionExcludedField, true);
        exclusion.setLimit(1);
        exclusion.query();

        if (exclusion.hasNext()) {
            stats.skippedExcluded++;
            continue;
        }

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

        var ownerGroup = classInfo.getValue(CONFIG.classOwnerGroupField);
        var assignedGroup = ownerGroup || CONFIG.eacmGroupSysId;

        if (!ownerGroup) {
            stats.routedToEacm++;
        }

        if (dryRun) {
            stats.wouldCreate++;
            gs.info(
                '[Annual Assessment] DRY RUN: ' +
                className +
                ' would be assigned to ' +
                assignedGroup
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
                catalog_url: CONFIG.catalogItemUrlPrefix + assessmentSysId
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
