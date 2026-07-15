/**
 * ServiceNow sync script:
 * Sync CMDB Assessment Class Master
 *
 * Use this in a Scheduled Script Execution, Fix Script, Background Script,
 * or Flow Designer custom Action Script step.
 *
 * Current design:
 *   u_cmdb_assessment_class_exclusions.u_class is the class key.
 *   It should reference sys_db_object, not cmdb_class_info.
 *
 * Candidate class inventory:
 *   1. Pull broad class inventory from cmdb_class_info.class.
 *   2. Also pull distinct cmdb_ci.sys_class_name values.
 *   3. Union those two sets.
 *   4. Resolve each class/table name to sys_db_object.name.
 *
 * Why this hybrid source:
 *   cmdb_class_info gives EACM the broad class inventory they expect.
 *   cmdb_ci catches real CI classes that are missing from cmdb_class_info.
 *   sys_db_object is the canonical table-definition reference target.
 *
 * Active logic:
 *   - Set u_active=true when ANY CI in that class has install_status 1 or 4.
 *   - Set u_active=false otherwise.
 *
 * Manual values preserved:
 *   - u_excluded
 *   - u_owner_group
 *
 * Required master-table fields:
 *   u_class       Reference to sys_db_object
 *   u_excluded    True/False manual exclusion checkbox
 *   u_active      True/False derived by this sync
 *   u_owner_group Reference to sys_user_group, manually assigned by EACM
 *
 * Optional field:
 *   u_last_synced Date/Time of last sync
 */
(function syncCmdbAssessmentClassMaster() {
    var CONFIG = {
        classInfoTable: 'cmdb_class_info',
        classInfoClassField: 'class',

        ciTable: 'cmdb_ci',
        ciClassField: 'sys_class_name',
        ciStatusField: 'install_status',
        activeStatusValues: ['1', '4'],

        tableDefinitionTable: 'sys_db_object',
        tableDefinitionNameField: 'name',

        masterTable: 'u_cmdb_assessment_class_exclusions',
        masterClassField: 'u_class',
        masterExcludedField: 'u_excluded',
        masterActiveField: 'u_active',
        masterOwnerGroupField: 'u_owner_group',
        optionalLastSyncedField: 'u_last_synced'
    };

    var stats = {
        classInfoClasses: 0,
        cmdbCiClasses: 0,
        activeCmdbCiClasses: 0,
        candidateClasses: 0,
        insertedMasterRows: 0,
        updatedMasterRows: 0,
        unchangedMasterRows: 0,
        deactivatedNoLongerCandidate: 0,
        deactivatedInvalidClassReference: 0,
        skippedMissingClassName: 0,
        skippedMissingTableDefinition: 0,
        failed: 0
    };

    var now = new GlideDateTime();
    var classInfoClasses = {};
    var allCiClasses = {};
    var activeCiClasses = {};
    var candidateClasses = {};
    var tableDefinitionCache = {};
    var tableNameBySysIdCache = {};

    function isTrueValue(value) {
        var normalized = String(value || '').toLowerCase();
        return normalized === '1' || normalized === 'true';
    }

    function setIfValid(record, fieldName, value) {
        if (record.isValidField(fieldName)) {
            record.setValue(fieldName, value);
            return true;
        }

        return false;
    }

    function addCandidateClass(className) {
        if (!className) {
            stats.skippedMissingClassName++;
            return;
        }

        if (!candidateClasses[className]) {
            candidateClasses[className] = true;
            stats.candidateClasses++;
        }
    }

    function getTableDefinitionSysId(tableName) {
        if (tableDefinitionCache.hasOwnProperty(tableName)) {
            return tableDefinitionCache[tableName];
        }

        var tableDef = new GlideRecord(CONFIG.tableDefinitionTable);
        tableDef.addQuery(CONFIG.tableDefinitionNameField, tableName);
        tableDef.setLimit(1);
        tableDef.query();

        if (tableDef.next()) {
            tableDefinitionCache[tableName] = tableDef.getUniqueValue();
            tableNameBySysIdCache[tableDef.getUniqueValue()] = tableName;
        } else {
            tableDefinitionCache[tableName] = '';
        }

        return tableDefinitionCache[tableName];
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

    function collectClassInfoClasses() {
        var classInfo = new GlideRecord(CONFIG.classInfoTable);
        classInfo.addNotNullQuery(CONFIG.classInfoClassField);
        classInfo.query();

        while (classInfo.next()) {
            var className = classInfo.getValue(CONFIG.classInfoClassField);

            if (!className) {
                stats.skippedMissingClassName++;
                continue;
            }

            if (!classInfoClasses[className]) {
                classInfoClasses[className] = true;
                stats.classInfoClasses++;
            }

            addCandidateClass(className);
        }
    }

    function collectCiClasses() {
        var allAgg = new GlideAggregate(CONFIG.ciTable);
        allAgg.addNotNullQuery(CONFIG.ciClassField);
        allAgg.groupBy(CONFIG.ciClassField);
        allAgg.addAggregate('COUNT');
        allAgg.query();

        while (allAgg.next()) {
            var className = allAgg.getValue(CONFIG.ciClassField);

            if (!className) {
                stats.skippedMissingClassName++;
                continue;
            }

            allCiClasses[className] = true;
            stats.cmdbCiClasses++;
            addCandidateClass(className);
        }

        var activeAgg = new GlideAggregate(CONFIG.ciTable);
        activeAgg.addNotNullQuery(CONFIG.ciClassField);
        activeAgg.addQuery(
            CONFIG.ciStatusField,
            'IN',
            CONFIG.activeStatusValues.join(',')
        );
        activeAgg.groupBy(CONFIG.ciClassField);
        activeAgg.addAggregate('COUNT');
        activeAgg.query();

        while (activeAgg.next()) {
            var activeClassName = activeAgg.getValue(CONFIG.ciClassField);

            if (!activeClassName) {
                stats.skippedMissingClassName++;
                continue;
            }

            activeCiClasses[activeClassName] = true;
            stats.activeCmdbCiClasses++;
            addCandidateClass(activeClassName);
        }
    }

    function findMasterByClassSysId(classSysId) {
        var master = new GlideRecord(CONFIG.masterTable);
        master.addQuery(CONFIG.masterClassField, classSysId);
        master.setLimit(1);
        master.query();

        if (master.next()) {
            return master;
        }

        return null;
    }

    function upsertMasterRow(className) {
        var classSysId = getTableDefinitionSysId(className);

        if (!classSysId) {
            stats.skippedMissingTableDefinition++;
            gs.warn(
                '[CMDB Assessment Class Master Sync] Missing sys_db_object table definition for ' +
                className
            );
            return;
        }

        var shouldBeActive = !!activeCiClasses[className];
        var master = findMasterByClassSysId(classSysId);
        var changed = false;

        if (!master) {
            master = new GlideRecord(CONFIG.masterTable);
            master.initialize();
            master.setValue(CONFIG.masterClassField, classSysId);
            master.setValue(CONFIG.masterExcludedField, false);
            master.setValue(CONFIG.masterActiveField, shouldBeActive);
            setIfValid(master, CONFIG.optionalLastSyncedField, now);

            if (master.insert()) {
                stats.insertedMasterRows++;
            } else {
                stats.failed++;
            }

            return;
        }

        if (
            isTrueValue(master.getValue(CONFIG.masterActiveField)) !==
            shouldBeActive
        ) {
            master.setValue(CONFIG.masterActiveField, shouldBeActive);
            changed = true;
        }

        if (setIfValid(master, CONFIG.optionalLastSyncedField, now)) {
            changed = true;
        }

        if (changed) {
            if (master.update()) {
                stats.updatedMasterRows++;
            } else {
                stats.failed++;
            }
        } else {
            stats.unchangedMasterRows++;
        }
    }

    function deactivateRowsMissingFromCandidates() {
        var master = new GlideRecord(CONFIG.masterTable);
        master.addQuery(CONFIG.masterActiveField, true);
        master.addNotNullQuery(CONFIG.masterClassField);
        master.query();

        while (master.next()) {
            var classSysId = master.getValue(CONFIG.masterClassField);
            var className = getTableNameBySysId(classSysId);

            if (!className) {
                master.setValue(CONFIG.masterActiveField, false);
                setIfValid(master, CONFIG.optionalLastSyncedField, now);

                if (master.update()) {
                    stats.deactivatedInvalidClassReference++;
                } else {
                    stats.failed++;
                }

                continue;
            }

            if (!candidateClasses[className]) {
                master.setValue(CONFIG.masterActiveField, false);
                setIfValid(master, CONFIG.optionalLastSyncedField, now);

                if (master.update()) {
                    stats.deactivatedNoLongerCandidate++;
                } else {
                    stats.failed++;
                }
            }
        }
    }

    var masterProbe = new GlideRecord(CONFIG.masterTable);

    if (!masterProbe.isValidField(CONFIG.masterClassField)) {
        gs.error(
            '[CMDB Assessment Class Master Sync] Missing required field ' +
            CONFIG.masterTable +
            '.' +
            CONFIG.masterClassField
        );
        return;
    }

    collectClassInfoClasses();
    collectCiClasses();

    for (var className in candidateClasses) {
        if (candidateClasses.hasOwnProperty(className)) {
            upsertMasterRow(className);
        }
    }

    deactivateRowsMissingFromCandidates();

    gs.info(
        '[CMDB Assessment Class Master Sync] Summary: ' +
        JSON.stringify(stats)
    );
})();
