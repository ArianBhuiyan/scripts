/**
 * ServiceNow Business Rule:
 * CMDB Assessment Catalog Item Submit Handler
 *
 * Table:
 *   Requested Item [sc_req_item]
 *
 * When to run:
 *   When: after
 *   Insert: true
 *   Update/Delete/Query: false
 *   Order: 200
 *   Advanced: true
 *
 * Filter condition:
 *   Item is CMDB Annual Class Risk Assessment
 *
 * Purpose:
 *   Convert the submitted Catalog Item variables into permanent
 *   CMDB Assessment Response rows, then move the parent assessment
 *   to Under Review.
 */
(function executeRule(current, previous /*null when async*/) {
    var CONFIG = {
        catalogItemSysId: '49a8177f3bb54b106879d3c643e45a63',

        assessmentTable: 'u_cmdb_assessment',
        assessmentSubmittedByField: 'u_submitted_by',
        assessmentStateField: 'u_state',
        underReviewStateValue: 'under_review',

        answerChoiceTable: 'u_cmdb_assessment_answer_choices',
        answerChoiceQuestionField: 'u_question',
        answerChoiceScoreField: 'u_score_value',

        responseTable: 'u_cmdb_assessment_responses',
        responseAssessmentField: 'u_assessment',
        responseQuestionField: 'u_question',
        responseAnswerChoiceField: 'u_answer_choice',
        responseRawScoreField: 'u_raw_score'
    };

    if (String(current.cat_item) !== CONFIG.catalogItemSysId) {
        return;
    }

    var assessmentSysId = String(current.variables.assessment_sys_id || '').trim();

    if (!assessmentSysId) {
        gs.error(
            '[CMDB Assessment Submit] Missing assessment_sys_id for ' +
            current.getDisplayValue()
        );
        return;
    }

    var assessment = new GlideRecord(CONFIG.assessmentTable);

    if (!assessment.get(assessmentSysId)) {
        gs.error(
            '[CMDB Assessment Submit] Assessment not found: ' +
            assessmentSysId
        );
        return;
    }

    var questionVariables = [
        'question_1',
        'question_2',
        'question_3',
        'question_4',
        'question_5',
        'question_6'
    ];

    var preparedResponses = [];
    var seenQuestionSysIds = {};

    for (var i = 0; i < questionVariables.length; i++) {
        var variableName = questionVariables[i];
        var answerChoiceSysId = String(current.variables[variableName] || '').trim();

        if (!answerChoiceSysId) {
            gs.error(
                '[CMDB Assessment Submit] Missing answer for ' +
                variableName +
                ' on ' +
                assessmentSysId
            );
            return;
        }

        var answerChoice = new GlideRecord(CONFIG.answerChoiceTable);

        if (!answerChoice.get(answerChoiceSysId)) {
            gs.error(
                '[CMDB Assessment Submit] Answer choice not found for ' +
                variableName +
                ': ' +
                answerChoiceSysId
            );
            return;
        }

        var questionSysId = String(
            answerChoice.getValue(CONFIG.answerChoiceQuestionField) || ''
        ).trim();

        if (!questionSysId) {
            gs.error(
                '[CMDB Assessment Submit] Answer choice ' +
                answerChoiceSysId +
                ' has no linked question for ' +
                variableName
            );
            return;
        }

        if (seenQuestionSysIds[questionSysId]) {
            gs.error(
                '[CMDB Assessment Submit] Duplicate submitted answer for question ' +
                questionSysId +
                ' on ' +
                assessmentSysId
            );
            return;
        }

        seenQuestionSysIds[questionSysId] = true;

        preparedResponses.push({
            question: questionSysId,
            answerChoice: answerChoiceSysId,
            rawScore: answerChoice.getValue(CONFIG.answerChoiceScoreField)
        });
    }

    for (var j = 0; j < preparedResponses.length; j++) {
        var prepared = preparedResponses[j];
        var response = new GlideRecord(CONFIG.responseTable);
        response.addQuery(CONFIG.responseAssessmentField, assessmentSysId);
        response.addQuery(CONFIG.responseQuestionField, prepared.question);
        response.setLimit(1);
        response.query();

        var existingResponseFound = response.next();

        if (!existingResponseFound) {
            response.initialize();
            response.setValue(CONFIG.responseAssessmentField, assessmentSysId);
            response.setValue(CONFIG.responseQuestionField, prepared.question);
        }

        response.setValue(
            CONFIG.responseAnswerChoiceField,
            prepared.answerChoice
        );
        response.setValue(CONFIG.responseRawScoreField, prepared.rawScore);

        if (existingResponseFound) {
            response.update();
        } else {
            response.insert();
        }
    }

    assessment.setValue(CONFIG.assessmentSubmittedByField, gs.getUserID());
    assessment.setValue(
        CONFIG.assessmentStateField,
        CONFIG.underReviewStateValue
    );
    assessment.update();

    gs.info(
        '[CMDB Assessment Submit] Saved ' +
        preparedResponses.length +
        ' responses and moved assessment to under_review: ' +
        assessmentSysId
    );
})(current, previous);
