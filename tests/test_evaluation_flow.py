"""Checks of evaluation evidence and single-node execution boundaries."""

import pytest

from evaluation.feedback_cases import run_feedback_checks, run_flow_checks


@pytest.fixture(scope="module")
def feedback_records():
    return {record["case_id"]: record for record in run_feedback_checks()}


@pytest.fixture(scope="module")
def flow_records():
    return {record["case_id"]: record for record in run_flow_checks()}


@pytest.mark.parametrize("case_id", [
    "feedback_edit_send",
    "feedback_response_send",
    "feedback_ignore_notify",
    "feedback_response_notify",
])
def test_feedback_update(case_id, feedback_records):
    record = feedback_records[case_id]
    assert record["passed"], record


@pytest.mark.parametrize("case_id", [
    "notify_ignore_route",
    "notify_response_route",
    "question_feedback",
    "invalid_proposed_email_id",
    "invalid_edited_email_id",
])
def test_review_flow(case_id, flow_records):
    record = flow_records[case_id]
    assert record["passed"], record
