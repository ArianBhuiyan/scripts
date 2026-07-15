/**
 * ServiceNow sync script:
 * Sync CMDB Assessment Class Master
 *
 * Use this in a Scheduled Script Execution, Fix Script, or the existing
 * Business Rule that currently populates u_cmdb_assessment_class_exclusions.
 *
 * Purpose:
 *   Treat u_cmdb_assessment_class_exclusions as the Flow 1 master table.
 *   It should contain one row per eligible active CI class. Active means
 *   at least one cmdb_ci record for the class has install_status Installed (1)
 *   or Pending Install (4).
 *
 * Required master-table fields:
 *   u_class       Reference to cmdb_class_info
 *   u_excluded    True/False manual exclusion checkbox
 *   u_active      True/False active eligibility checkbox
 *   u_owner_group Reference to sys_user_group, manually assigned by EACM
 *
 * Optional master-table fields if the team adds them:
 *   u_class_name      String snapshot of cmdb_ci.sys_class_name
 *   u_last_synced     Date/Time of last sync
 *
 * The sync does not overwrite u_excluded or u_owner_group.
 */
(function syncCmdbAssessmentClassMaster() {
    var CONFIG = {
        ciTable: 'cmdb_ci',
        ciClassField: 'sys_class_name',
        ciStatusField: 'install_status',
        activeStatusValues: ['1', '4'],

        classInfoTable: 'cmdb_class_info',
        classInfoMatchField: 'class',

        masterTable: 'u_cmdb_assessment_class_exclusions',
        masterClassField: 'u_class',
        masterExcludedField: 'u_excluded',
        masterActiveField: 'u_active',
        masterOwnerGroupField: 'u_owner_group',

        optionalClassNameField: 'u_class_name',
        optionalLastSyncedField: 'u_last_synced'
    };

    var stats = {
        activeCiClasses: 0,
        insertedMasterRows: 0,
        reactivatedMasterRows: 0,
        alreadyActiveMasterRows: 0,
        deactivatedMasterRows: 0,
        skippedMissingClassInfo: 0,
        failed: 0
    };

    var activeClassInfoSysIds = {};
    var now = new GlideDateTime();

    function setIfValid(record, fieldName, value) {
        if (record.isValidField(fieldName)) {
            record.setValue(fieldName, value);
        }
    }

    var ciClasses = new GlideAggregate(CONFIG.ciTable);
    ciClasses.addQuery(
        CONFIG.ciStatusField,
        'IN',
        CONFIG.activeStatusValues.join(',')
    );
    ciClasses.addNotNullQuery(CONFIG.ciClassField);
    ciClasses.addAggregate('COUNT');
    ciClasses.groupBy(CONFIG.ciClassField);
    ciClasses.query();

    while (ciClasses.next()) {
        stats.activeCiClasses++;

        var className = ciClasses.getValue(CONFIG.ciClassField);

        var classInfo = new GlideRecord(CONFIG.classInfoTable);
        classInfo.addQuery(CONFIG.classInfoMatchField, className);
        classInfo.setLimit(1);
        classInfo.query();

        if (!classInfo.next()) {
            stats.skippedMissingClassInfo++;
            gs.warn(
                '[CMDB Assessment Class Master Sync] No class-info record for active CI class ' +
                className
            );
            continue;
        }

        var classSysId = classInfo.getUniqueValue();
        activeClassInfoSysIds[classSysId] = true;

        var master = new GlideRecord(CONFIG.masterTable);
        master.addQuery(CONFIG.masterClassField, classSysId);
        master.setLimit(1);
        master.query();

        if (master.next()) {
            var wasActive =
                String(master.getValue(CONFIG.masterActiveField)) === '1';

            master.setValue(CONFIG.masterActiveField, true);
            setIfValid(master, CONFIG.optionalClassNameField, className);
            setIfValid(master, CONFIG.optionalLastSyncedField, now);

            if (master.update()) {
                if (wasActive) {
                    stats.alreadyActiveMasterRows++;
                } else {
                    stats.reactivatedMasterRows++;
                }
            } else {
                stats.failed++;
            }

            continue;
        }

        master.initialize();
        master.setValue(CONFIG.masterClassField, classSysId);
        master.setValue(CONFIG.masterExcludedField, false);
        master.setValue(CONFIG.masterActiveField, true);
        setIfValid(master, CONFIG.optionalClassNameField, className);
        setIfValid(master, CONFIG.optionalLastSyncedField, now);

        if (master.insert()) {
            stats.insertedMasterRows++;
        } else {
            stats.failed++;
        }
    }

    var existingMaster = new GlideRecord(CONFIG.masterTable);
    existingMaster.addQuery(CONFIG.masterActiveField, true);
    existingMaster.query();

    while (existingMaster.next()) {
        var existingClassSysId = existingMaster.getValue(
            CONFIG.masterClassField
        );

        if (activeClassInfoSysIds[existingClassSysId]) {
            continue;
        }

        existingMaster.setValue(CONFIG.masterActiveField, false);
        setIfValid(existingMaster, CONFIG.optionalLastSyncedField, now);

        if (existingMaster.update()) {
            stats.deactivatedMasterRows++;
        } else {
            stats.failed++;
        }
    }

    gs.info(
        '[CMDB Assessment Class Master Sync] Summary: ' +
        JSON.stringify(stats)
    );
})();
