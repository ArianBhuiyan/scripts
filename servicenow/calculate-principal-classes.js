/**
 * ServiceNow Flow Designer custom Action Script step:
 * Calculate Principal Classes
 *
 * Principal-class rule:
 *   population = all completed/scored CMDB assessments for the assessment year
 *   median = median(population risk scores)
 *   standard_deviation = population standard deviation of those same scores
 *   threshold = median + standard_deviation
 *   principal class = risk_score >= threshold
 *
 * Action inputs:
 *   assessment_year Integer
 *   dry_run         True/False
 *
 * Script outputs:
 *   assessment_count       Integer
 *   median_score           Decimal
 *   standard_deviation     Decimal
 *   principal_threshold    Decimal
 *   principal_class_count  Integer
 *   summary                String JSON execution statistics
 */
(function execute(inputs, outputs) {
    var CONFIG = {
        assessmentTable: 'u_cmdb_assessment',
        assessmentYearField: 'u_assessment_year',
        assessmentStateField: 'u_state',
        assessmentRiskScoreField: 'u_risk_score',
        assessmentPrincipalClassField: 'u_principal_class',
        completeStateValue: 'complete'
    };

    var assessmentYear = String(inputs.assessment_year || '').trim();
    var dryRun = String(inputs.dry_run) !== 'false';

    var stats = {
        status: 'started',
        assessmentYear: assessmentYear,
        dryRun: dryRun,
        totalAssessmentsForYear: 0,
        assessmentCount: 0,
        incompleteAssessments: 0,
        unscoredAssessments: 0,
        medianScore: 0,
        averageScore: 0,
        standardDeviation: 0,
        principalThreshold: 0,
        principalClassCount: 0,
        nonPrincipalClassCount: 0,
        wrotePrincipalClassFlags: false,
        thresholdRule: 'risk_score >= median + population_standard_deviation',
        errors: []
    };

    outputs.assessment_count = 0;
    outputs.median_score = 0;
    outputs.standard_deviation = 0;
    outputs.principal_threshold = 0;
    outputs.principal_class_count = 0;
    outputs.summary = '';

    function finish(status) {
        stats.status = status;
        outputs.assessment_count = stats.assessmentCount;
        outputs.median_score = stats.medianScore;
        outputs.standard_deviation = stats.standardDeviation;
        outputs.principal_threshold = stats.principalThreshold;
        outputs.principal_class_count = stats.principalClassCount;
        outputs.summary = JSON.stringify(stats);
    }

    function hasValue(value) {
        return value !== null && value !== undefined && String(value).trim() !== '';
    }

    function numberValue(value) {
        var parsed = parseFloat(value);

        if (isNaN(parsed)) {
            return null;
        }

        return parsed;
    }

    function round(value) {
        return Math.round(value * 1000000) / 1000000;
    }

    function calculateMedian(sortedScores) {
        var count = sortedScores.length;
        var middle = Math.floor(count / 2);

        if (count % 2 === 1) {
            return sortedScores[middle];
        }

        return (sortedScores[middle - 1] + sortedScores[middle]) / 2;
    }

    function calculateAverage(scores) {
        var total = 0;
        var i;

        for (i = 0; i < scores.length; i++) {
            total += scores[i];
        }

        return total / scores.length;
    }

    function calculatePopulationStandardDeviation(scores, average) {
        var squaredDifferenceTotal = 0;
        var i;

        for (i = 0; i < scores.length; i++) {
            squaredDifferenceTotal += Math.pow(scores[i] - average, 2);
        }

        return Math.sqrt(squaredDifferenceTotal / scores.length);
    }

    try {
        if (!assessmentYear) {
            stats.errors.push('Missing assessment_year input.');
            finish('failed');
            return;
        }

        var validator = new GlideRecord(CONFIG.assessmentTable);

        if (!validator.isValid()) {
            stats.errors.push('Assessment table does not exist: ' + CONFIG.assessmentTable);
            finish('failed');
            return;
        }

        if (!validator.isValidField(CONFIG.assessmentYearField)) {
            stats.errors.push('Assessment year field does not exist: ' + CONFIG.assessmentYearField);
            finish('failed');
            return;
        }

        if (!validator.isValidField(CONFIG.assessmentStateField)) {
            stats.errors.push('Assessment state field does not exist: ' + CONFIG.assessmentStateField);
            finish('failed');
            return;
        }

        if (!validator.isValidField(CONFIG.assessmentRiskScoreField)) {
            stats.errors.push('Assessment risk score field does not exist: ' + CONFIG.assessmentRiskScoreField);
            finish('failed');
            return;
        }

        if (!validator.isValidField(CONFIG.assessmentPrincipalClassField)) {
            stats.errors.push('Assessment principal-class field does not exist: ' + CONFIG.assessmentPrincipalClassField);
            finish('failed');
            return;
        }

        var scores = [];
        var assessments = [];
        var assessment = new GlideRecord(CONFIG.assessmentTable);
        assessment.addQuery(CONFIG.assessmentYearField, assessmentYear);
        assessment.query();

        while (assessment.next()) {
            stats.totalAssessmentsForYear++;

            if (assessment.getValue(CONFIG.assessmentStateField) !== CONFIG.completeStateValue) {
                stats.incompleteAssessments++;
                continue;
            }

            var riskScoreRaw = assessment.getValue(CONFIG.assessmentRiskScoreField);

            if (!hasValue(riskScoreRaw)) {
                stats.unscoredAssessments++;
                continue;
            }

            var riskScore = numberValue(riskScoreRaw);

            if (riskScore === null) {
                stats.unscoredAssessments++;
                continue;
            }

            scores.push(riskScore);
            assessments.push({
                sysId: assessment.getUniqueValue(),
                riskScore: riskScore
            });
        }

        stats.assessmentCount = assessments.length;

        if (stats.totalAssessmentsForYear === 0) {
            stats.errors.push('No assessments found for assessment year: ' + assessmentYear);
            finish('validation_failed');
            return;
        }

        if (stats.incompleteAssessments > 0 || stats.unscoredAssessments > 0) {
            stats.errors.push(
                'Principal-class calculation requires every assessment for the year to be complete and scored. ' +
                'Incomplete assessments: ' +
                stats.incompleteAssessments +
                '; unscored assessments: ' +
                stats.unscoredAssessments +
                '.'
            );
            finish('validation_failed');
            return;
        }

        if (scores.length === 0) {
            stats.errors.push('No completed/scored assessments found for assessment year: ' + assessmentYear);
            finish('validation_failed');
            return;
        }

        scores.sort(function sortNumber(left, right) {
            return left - right;
        });

        var median = calculateMedian(scores);
        var average = calculateAverage(scores);
        var standardDeviation = calculatePopulationStandardDeviation(scores, average);
        var threshold = median + standardDeviation;

        stats.medianScore = round(median);
        stats.averageScore = round(average);
        stats.standardDeviation = round(standardDeviation);
        stats.principalThreshold = round(threshold);

        var i;

        for (i = 0; i < assessments.length; i++) {
            if (assessments[i].riskScore >= threshold) {
                stats.principalClassCount++;
            } else {
                stats.nonPrincipalClassCount++;
            }
        }

        if (!dryRun) {
            for (i = 0; i < assessments.length; i++) {
                var updateAssessment = new GlideRecord(CONFIG.assessmentTable);

                if (!updateAssessment.get(assessments[i].sysId)) {
                    stats.errors.push('Could not reload assessment for principal-class update: ' + assessments[i].sysId);
                    continue;
                }

                updateAssessment.setValue(
                    CONFIG.assessmentPrincipalClassField,
                    assessments[i].riskScore >= threshold ? true : false
                );
                updateAssessment.update();
            }

            if (stats.errors.length > 0) {
                finish('partial_success');
                return;
            }

            stats.wrotePrincipalClassFlags = true;
        }

        finish('success');
    } catch (error) {
        stats.errors.push(String(error));
        finish('failed');
    }
})(inputs, outputs);
