/**
 * ServiceNow Flow Designer custom Action Script step:
 * Generate Annual CMDB Risk Assessments
 *
 * Action inputs:
 *   assessment_year   String     Optional; defaults to the current local year.
 *   dry_run           True/False Keep true until candidate results are valid.
 *   class_name_filter String     Optional raw sys_class_name for single-class tests.
 *
 * Script outputs:
 *   summary                  String JSON execution statistics.
 *   created_assessments_json String JSON array of created assessment link data.
 *
 * Eligibility source:
 *   Flow 1 reads the CMDB Assessment Class Exclusions/master table only.
 *
 * Current class-key design:
 *   u_cmdb_assessment_class_exclusions.u_class references sys_db_object.
 *   u_cmdb_assessment.u_class also references sys_db_object.
 *
 * Do NOT require cmdb_class_info for eligibility.
 */
(function execute(inputs, outputs) {
    try {
    var CONFIG = {
        tableDefinitionTable: 'sys_db_object',
        tableDefinitionNameField: 'name',

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

        groupTable: 'sys_user_group',
        eacmFallbackGroupSysId: '1774614b874f05d039e44226cebb3510',
        eacmFallbackGroupDisplay: 'APP - Asset & CMDB Automation',

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
        skippedMissingClass: 0,
        skippedMissingTableDefinition: 0,
        routedToEacm: 0,
        failed: 0
    };

    var createdAssessments = [];
    var tableNameBySysIdCache = {};

    function finish() {
        outputs.summary = JSON.stringify(stats);
        outputs.created_assessments_json = JSON.stringify(createdAssessments);
        gs.info('[Annual Assessment] Summary: ' + outputs.summary);
        gs.info(
            '[Annual Assessment] Created Assessments JSON: ' +
            outputs.created_assessments_json
        );
    }

    function encodeUrlValue(value) {
        return encodeURIComponent(String(value || ''));
    }

    function isTrueValue(value) {
        var normalized = String(value || '').toLowerCase();
        return normalized === '1' || normalized === 'true';
    }

    function getTableNameBySysId(tableSysId) {
        if (!tableSysId) {
            return '';
        }

        if (tableNameBySysIdCache.hasOwnProperty(tableSysId)) {
            return tableNameBySysIdCache[tableSysId];
        }

        var tableDef = new GlideRecord(CONFIG.tableDefinitionTable);

        if (tableDef.get(tableSysId)) {
            tableNameBySysIdCache[tableSysId] = tableDef.getValue(
                CONFIG.tableDefinitionNameField
            );
        } else {
            tableNameBySysIdCache[tableSysId] = '';
        }

        return tableNameBySysIdCache[tableSysId];
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

    function hasDuplicateAssessment(classSysId) {
        var existing = new GlideRecord(CONFIG.assessmentTable);
        existing.addQuery(CONFIG.assessmentClassField, classSysId);
        existing.addQuery(CONFIG.assessmentYearField, year);
        existing.setLimit(1);
        existing.query();
        return existing.hasNext();
    }

    function getGroupDisplay(groupSysId, fallbackDisplay) {
        var group = new GlideRecord(CONFIG.groupTable);

        if (group.get(groupSysId)) {
            return group.getDisplayValue();
        }

        return fallbackDisplay || groupSysId;
    }

    var masterProbe = new GlideRecord(CONFIG.masterTable);
    var assessmentProbe = new GlideRecord(CONFIG.assessmentTable);

    if (!masterProbe.isValidField(CONFIG.masterClassField)) {
        stats.failed++;
        stats.error =
            'Missing required field ' +
            CONFIG.masterTable +
            '.' +
            CONFIG.masterClassField;
        finish();
        return;
    }

    if (!assessmentProbe.isValidField(CONFIG.assessmentClassField)) {
        stats.failed++;
        stats.error =
            'Missing required field ' +
            CONFIG.assessmentTable +
            '.' +
            CONFIG.assessmentClassField;
        finish();
        return;
    }

    var master = new GlideRecord(CONFIG.masterTable);
    master.addQuery(CONFIG.masterActiveField, true);
    master.addNotNullQuery(CONFIG.masterClassField);

    if (classFilter) {
        master.addQuery(
            CONFIG.masterClassField + '.' + CONFIG.tableDefinitionNameField,
            classFilter
        );
    }

    master.query();

    while (master.next()) {
        stats.activeClasses++;

        if (isTrueValue(master.getValue(CONFIG.masterExcludedField))) {
            stats.skippedExcluded++;
            continue;
        }

        var classSysId = master.getValue(CONFIG.masterClassField);

        if (!classSysId) {
            stats.skippedMissingClass++;
            continue;
        }

        var className = getTableNameBySysId(classSysId);

        if (!className) {
            stats.skippedMissingTableDefinition++;
            gs.warn(
                '[Annual Assessment] Skipping master row with invalid sys_db_object reference: ' +
                master.getUniqueValue()
            );
            continue;
        }

        var ownerGroup = master.getValue(CONFIG.masterOwnerGroupField);
        var assignedFromFallback = false;

        if (!ownerGroup) {
            ownerGroup = CONFIG.eacmFallbackGroupSysId;
            assignedFromFallback = true;
            stats.routedToEacm++;
            gs.info(
                '[Annual Assessment] Routing ' +
                className +
                ' to EACM fallback because master owner group is empty'
            );
        }

        if (hasDuplicateAssessment(classSysId)) {
            stats.skippedDuplicate++;
            continue;
        }

        var assignedGroupDisplay = assignedFromFallback ?
            getGroupDisplay(ownerGroup, CONFIG.eacmFallbackGroupDisplay) :
            master.getDisplayValue(CONFIG.masterOwnerGroupField);

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
            ownerGroup
        );
        assessment.setValue(
            CONFIG.assessmentOwnerGroupField,
            ownerGroup
        );

        var assessmentSysId = assessment.insert();

        if (assessmentSysId) {
            stats.created++;
            createdAssessments.push({
                assessment_sys_id: String(assessmentSysId),
                class_sys_id: classSysId,
                class_name: className,
                assigned_group: ownerGroup,
                assigned_group_display: assignedGroupDisplay,
                routed_to_eacm: assignedFromFallback,
                catalog_url: buildCatalogUrl(
                    assessmentSysId,
                    className,
                    assignedGroupDisplay
                )
            });
        } else {
            stats.failed++;
            gs.error(
                '[Annual Assessment] Failed to insert assessment for ' +
                className
            );
        }
    }

    finish();
    } catch (error) {
        var errorMessage = error && error.message ?
            error.message :
            String(error);
        var errorSummary = {
            failed: 1,
            error: errorMessage
        };

        outputs.summary = JSON.stringify(errorSummary);
        outputs.created_assessments_json = '[]';

        gs.error(
            '[Annual Assessment] Runtime error before normal summary output: ' +
            errorMessage
        );
    }
})(inputs, outputs);
