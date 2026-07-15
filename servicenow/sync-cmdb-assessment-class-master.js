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
 * Why:
 *   cmdb_ci.sys_class_name stores real CI table names such as:
 *     cmdb_ci_ad_controller
 *     cmdb_ci_aircraft
 *     cmdb_ci_apache_active_mq
 *
 *   Some of those classes do not exist in cmdb_class_info, so cmdb_class_info
 *   cannot be the eligibility gate. sys_db_object is the table-definition
 *   registry and should contain the CI table/class definitions.
 *
 * Active logic:
 *   - Read distinct cmdb_ci.sys_class_name values.
 *   - Resolve each table name to sys_db_object.name.
 *   - Insert/update one master row per sys_db_object class.
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
        cmdbCiClasses: 0,
        activeCmdbCiClasses: 0,
        insertedMasterRows: 0,
        updatedMasterRows: 0,
        unchangedMasterRows: 0,
        deactivatedMissingFromCi: 0,
        deactivatedInvalidClassReference: 0,
        skippedMissingClassName: 0,
        skippedMissingTableDefinition: 0,
        failed: 0
    };

    var now = new GlideDateTime();
    var allCiClasses = {};
    var activeCiClasses = {};
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

    function deactivateRowsMissingFromCi() {
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

            if (!allCiClasses[className]) {
                master.setValue(CONFIG.masterActiveField, false);
                setIfValid(master, CONFIG.optionalLastSyncedField, now);

                if (master.update()) {
                    stats.deactivatedMissingFromCi++;
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

    collectCiClasses();

    for (var className in allCiClasses) {
        if (allCiClasses.hasOwnProperty(className)) {
            upsertMasterRow(className);
        }
    }

    deactivateRowsMissingFromCi();

    gs.info(
        '[CMDB Assessment Class Master Sync] Summary: ' +
        JSON.stringify(stats)
    );
})();
