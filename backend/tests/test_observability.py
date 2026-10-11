"""Tests for FN-11 Agent Observability and Cloud Trace OpenTelemetry module."""

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from src.agents.building_agent import BuildingAgent
from src.agents.resident_agent import ResidentAgent
from src.db.in_memory_repo import InMemoryRepository
from src.db.seed import seed_sc3_data
from src.models.domain import Emergency, EmergencyType, Issue
from src.observability.trace import get_current_trace_context, trace_span

_global_provider = TracerProvider()
try:
    trace.set_tracer_provider(_global_provider)
except Exception:
    pass


@pytest.fixture
def memory_exporter():
    """Setup in-memory span exporter for testing trace emission."""
    exporter = InMemorySpanExporter()
    processor = SimpleSpanProcessor(exporter)
    _global_provider.add_span_processor(processor)
    yield exporter
    exporter.clear()


def test_trace_span_with_plan_id_and_privacy_attributes(memory_exporter):
    """Verify trace_span sets plan_id and filters out raw message content (PRV-03)."""
    with trace_span(
        "test.agent_operation",
        plan_id="iss-test-01",
        attributes={
            "agent_type": "BUILDING_AGENT",
            "floor": 3,
            "raw_message": "これは個人情報を含む生テキストです",
            "prompt": "内部プロンプトテキスト",
        },
    ) as span:
        ctx = get_current_trace_context()
        assert "trace_id" in ctx
        assert "span_id" in ctx

    spans = memory_exporter.get_finished_spans()
    assert len(spans) == 1
    span = spans[0]
    assert span.name == "test.agent_operation"
    assert span.attributes["zashikiwarashi.plan_id"] == "iss-test-01"
    assert span.attributes["zashikiwarashi.agent_type"] == "BUILDING_AGENT"
    assert span.attributes["zashikiwarashi.floor"] == 3

    # PRV-03: 生メッセージ・プロンプト本文はスパン属性に含まれないこと
    assert "zashikiwarashi.raw_message" not in span.attributes
    assert "zashikiwarashi.prompt" not in span.attributes


@pytest.mark.asyncio
async def test_building_and_resident_agent_trace_emission(memory_exporter):
    """Verify BuildingAgent and ResidentAgent emit spans with plan_id."""
    repo = InMemoryRepository()
    building_id = "bld-01"
    emergency_id = "em-trace-01"
    issue_id = "iss-trace-01"

    await seed_sc3_data(repo, building_id=building_id)
    await repo.create_emergency(
        Emergency(
            emergency_id=emergency_id,
            building_id=building_id,
            emergency_type=EmergencyType.EARTHQUAKE,
            triggered_by="admin-01",
        )
    )
    await repo.create_issue(
        building_id,
        Issue(
            issue_id=issue_id,
            emergency_id=emergency_id,
            instruction="安否確認",
            created_by_admin_id="admin-01",
        ),
    )

    # 1. BuildingAgent execute_triage
    building_agent = BuildingAgent(repo)
    await building_agent.execute_triage(
        building_id=building_id,
        emergency_id=emergency_id,
        issue_id=issue_id,
        use_llm=False,
    )

    # 2. ResidentAgent parse_user_free_text
    resident_agent = ResidentAgent(resident_id="resident-i", repo=repo, building_id=building_id)
    resident_agent.parse_user_free_text("足が痛くて動けません", floor=3)

    spans = memory_exporter.get_finished_spans()
    span_names = [s.name for s in spans]

    assert "BuildingAgent.execute_triage" in span_names
    b_span = next(s for s in spans if s.name == "BuildingAgent.execute_triage")
    assert b_span.attributes["zashikiwarashi.plan_id"] == issue_id
    assert b_span.attributes["zashikiwarashi.building_id"] == building_id

    assert "ResidentAgent.parse_user_free_text" in span_names
    r_span = next(s for s in spans if s.name == "ResidentAgent.parse_user_free_text")
    assert r_span.attributes["zashikiwarashi.plan_id"] == "resident-i"
    assert r_span.attributes["zashikiwarashi.floor"] == 3
    # 生テキストはスパン属性に含まれないこと
    assert "zashikiwarashi.raw_message" not in r_span.attributes
