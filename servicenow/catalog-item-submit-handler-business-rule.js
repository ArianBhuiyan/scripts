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

    var questionMap = [
        {
            variable: 'question_1',
            question: '720344f7fba5831033e5fde55eefdc83'
        },
        {
            variable: 'question_2',
            question: 'e643c4f7fba5831033e5fde55eefdc83'
        },
        {
            variable: 'question_3',
            question: '1673c03bfba5831033e5fde55efdc57'
        },
        {
            variable: 'question_4',
            question: '3f83083bfba5831033e5fde55eefdc39'
        },
        {
            variable: 'question_5',
            question: 'b2b3807bfba5831033e5fde55eefdce9'
        },
        {
            variable: 'question_6',
            question: '28e3047bfba5831033e5fde55eefdcb6'
        }
    ];

    var preparedResponses = [];

    for (var i = 0; i < questionMap.length; i++) {
        var item = questionMap[i];
        var answerChoiceSysId = String(current.variables[item.variable] || '').trim();

        if (!answerChoiceSysId) {
            gs.error(
                '[CMDB Assessment Submit] Missing answer for ' +
                item.variable +
                ' on ' +
                assessmentSysId
            );
            return;
        }

        var answerChoice = new GlideRecord(CONFIG.answerChoiceTable);

        if (!answerChoice.get(answerChoiceSysId)) {
            gs.error(
                '[CMDB Assessment Submit] Answer choice not found for ' +
                item.variable +
                ': ' +
                answerChoiceSysId
            );
            return;
        }

        if (
            String(answerChoice.getValue(CONFIG.answerChoiceQuestionField)) !==
            item.question
        ) {
            gs.error(
                '[CMDB Assessment Submit] Answer choice ' +
                answerChoiceSysId +
                ' does not belong to expected question ' +
                item.question
            );
            return;
        }

        preparedResponses.push({
            question: item.question,
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
