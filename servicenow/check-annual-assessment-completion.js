/**
 * ServiceNow Flow Designer custom Action Script step:
 * Check Annual Assessment Completion
 *
 * Purpose:
 *   Determine whether every CMDB assessment for a given assessment year is
 *   complete and scored. Principal-class calculation should only run after
 *   this Action returns all_complete = true.
 *
 * Action inputs:
 *   assessment_year Integer
 *
 * Script outputs:
 *   total_assessments    Integer
 *   complete_assessments Integer
 *   scored_assessments   Integer
 *   all_complete         True/False
 *   summary              String JSON execution statistics
 */
(function execute(inputs, outputs) {
    var CONFIG = {
        assessmentTable: 'u_cmdb_assessment',
        assessmentYearField: 'u_assessment_year',
        assessmentStateField: 'u_state',
        assessmentRiskScoreField: 'u_risk_score',
        completeStateValue: 'complete'
    };

    var assessmentYear = String(inputs.assessment_year || '').trim();

    var stats = {
        status: 'started',
        assessmentYear: assessmentYear,
        totalAssessments: 0,
        completeAssessments: 0,
        scoredAssessments: 0,
        incompleteAssessments: 0,
        unscoredAssessments: 0,
        allComplete: false,
        errors: []
    };

    outputs.total_assessments = 0;
    outputs.complete_assessments = 0;
    outputs.scored_assessments = 0;
    outputs.all_complete = false;
    outputs.summary = '';

    function finish(status) {
        stats.status = status;
        outputs.total_assessments = stats.totalAssessments;
        outputs.complete_assessments = stats.completeAssessments;
        outputs.scored_assessments = stats.scoredAssessments;
        outputs.all_complete = stats.allComplete;
        outputs.summary = JSON.stringify(stats);
    }

    function hasValue(value) {
        return value !== null && value !== undefined && String(value).trim() !== '';
    }

    try {
        if (!assessmentYear) {
            stats.errors.push('Missing assessment_year input.');
            finish('failed');
            return;
        }

        var assessment = new GlideRecord(CONFIG.assessmentTable);

        if (!assessment.isValid()) {
            stats.errors.push('Assessment table does not exist: ' + CONFIG.assessmentTable);
            finish('failed');
            return;
        }

        if (!assessment.isValidField(CONFIG.assessmentYearField)) {
            stats.errors.push('Assessment year field does not exist: ' + CONFIG.assessmentYearField);
            finish('failed');
            return;
        }

        if (!assessment.isValidField(CONFIG.assessmentStateField)) {
            stats.errors.push('Assessment state field does not exist: ' + CONFIG.assessmentStateField);
            finish('failed');
            return;
        }

        if (!assessment.isValidField(CONFIG.assessmentRiskScoreField)) {
            stats.errors.push('Assessment risk score field does not exist: ' + CONFIG.assessmentRiskScoreField);
            finish('failed');
            return;
        }

        assessment.addQuery(CONFIG.assessmentYearField, assessmentYear);
        assessment.query();

        while (assessment.next()) {
            stats.totalAssessments++;

            if (assessment.getValue(CONFIG.assessmentStateField) === CONFIG.completeStateValue) {
                stats.completeAssessments++;
            }

            if (hasValue(assessment.getValue(CONFIG.assessmentRiskScoreField))) {
                stats.scoredAssessments++;
            }
        }

        stats.incompleteAssessments = stats.totalAssessments - stats.completeAssessments;
        stats.unscoredAssessments = stats.totalAssessments - stats.scoredAssessments;
        stats.allComplete =
            stats.totalAssessments > 0 &&
            stats.completeAssessments === stats.totalAssessments &&
            stats.scoredAssessments === stats.totalAssessments;

        finish('success');
    } catch (error) {
        stats.errors.push(String(error));
        finish('failed');
    }
})(inputs, outputs);
