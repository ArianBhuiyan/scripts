/**
 * ServiceNow Flow Designer custom Action Script step:
 * Calculate CMDB Assessment Risk Score
 *
 * Formula:
 *   risk_score = sum(response.u_raw_score * response.u_question.u_weight)
 *
 * Action inputs:
 *   assessment_sys_id String
 *   dry_run           True/False
 *
 * Script outputs:
 *   risk_score     Integer
 *   response_count Integer
 *   summary        String JSON execution statistics
 */
(function execute(inputs, outputs) {
    var CONFIG = {
        assessmentTable: 'u_cmdb_assessment',
        assessmentRiskScoreField: 'u_risk_score',

        responseTable: 'u_cmdb_assessment_responses',
        responseAssessmentField: 'u_assessment',
        responseRawScoreField: 'u_raw_score',
        responseQuestionField: 'u_question',

        questionTable: 'u_cmdb_assessment_questions',
        questionWeightField: 'u_weight',

        expectedResponseCount: 6
    };

    var assessmentSysId = String(inputs.assessment_sys_id || '').trim();
    var dryRun = String(inputs.dry_run) !== 'false';

    var stats = {
        status: 'started',
        assessmentSysId: assessmentSysId,
        dryRun: dryRun,
        responseCount: 0,
        scoredResponseCount: 0,
        duplicateQuestionCount: 0,
        missingQuestionCount: 0,
        missingRawScoreCount: 0,
        missingWeightCount: 0,
        riskScore: 0,
        expectedResponseCount: CONFIG.expectedResponseCount,
        wroteRiskScore: false,
        errors: []
    };

    outputs.risk_score = 0;
    outputs.response_count = 0;
    outputs.summary = '';

    function finish(status) {
        stats.status = status;
        outputs.risk_score = stats.riskScore;
        outputs.response_count = stats.responseCount;
        outputs.summary = JSON.stringify(stats);
    }

    function numberValue(value) {
        var parsed = parseFloat(value);

        if (isNaN(parsed)) {
            return null;
        }

        return parsed;
    }

    try {
        if (!assessmentSysId) {
            stats.errors.push('Missing assessment_sys_id input.');
            finish('failed');
            return;
        }

        var assessment = new GlideRecord(CONFIG.assessmentTable);

        if (!assessment.get(assessmentSysId)) {
            stats.errors.push('No assessment found for sys_id: ' + assessmentSysId);
            finish('failed');
            return;
        }

        if (!assessment.isValidField(CONFIG.assessmentRiskScoreField)) {
            stats.errors.push('Assessment risk score field does not exist: ' + CONFIG.assessmentRiskScoreField);
            finish('failed');
            return;
        }

        var seenQuestions = {};
        var totalScore = 0;

        var response = new GlideRecord(CONFIG.responseTable);
        response.addQuery(CONFIG.responseAssessmentField, assessmentSysId);
        response.query();

        while (response.next()) {
            stats.responseCount++;

            var rawScore = numberValue(response.getValue(CONFIG.responseRawScoreField));
            var questionSysId = response.getValue(CONFIG.responseQuestionField);

            if (rawScore === null) {
                stats.missingRawScoreCount++;
                continue;
            }

            if (!questionSysId) {
                stats.missingQuestionCount++;
                continue;
            }

            if (seenQuestions[questionSysId]) {
                stats.duplicateQuestionCount++;
            }

            seenQuestions[questionSysId] = true;

            var question = new GlideRecord(CONFIG.questionTable);

            if (!question.get(questionSysId)) {
                stats.missingQuestionCount++;
                continue;
            }

            var weight = numberValue(question.getValue(CONFIG.questionWeightField));

            if (weight === null) {
                stats.missingWeightCount++;
                continue;
            }

            totalScore += rawScore * weight;
            stats.scoredResponseCount++;
        }

        stats.riskScore = totalScore;

        if (stats.responseCount !== CONFIG.expectedResponseCount) {
            stats.errors.push(
                'Expected ' +
                CONFIG.expectedResponseCount +
                ' responses but found ' +
                stats.responseCount +
                '.'
            );
        }

        if (stats.scoredResponseCount !== CONFIG.expectedResponseCount) {
            stats.errors.push(
                'Expected ' +
                CONFIG.expectedResponseCount +
                ' scored responses but scored ' +
                stats.scoredResponseCount +
                '.'
            );
        }

        if (
            stats.missingQuestionCount > 0 ||
            stats.missingRawScoreCount > 0 ||
            stats.missingWeightCount > 0 ||
            stats.duplicateQuestionCount > 0
        ) {
            stats.errors.push('One or more response rows are incomplete or duplicated. See summary counts.');
        }

        if (stats.errors.length > 0) {
            finish('validation_failed');
            return;
        }

        if (!dryRun) {
            assessment.setValue(CONFIG.assessmentRiskScoreField, totalScore);
            assessment.update();
            stats.wroteRiskScore = true;
        }

        finish('success');
    } catch (error) {
        stats.errors.push(String(error));
        finish('failed');
    }
})(inputs, outputs);
