"""Tests for triage re-execution and duplicate prevention (FN-04, #60, DESIGN §6.3 D)."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.agents.building_agent import BuildingAgent
from src.db.in_memory_repo import InMemoryRepository
from src.db.seed import seed_sc3_data
from src.models.domain import (
    ActorType,
    ReasonCode,
    ResidentEmergencyCurrentState,
    SafetyStatus,
    TaskEventType,
    TaskStatus,
)
from src.services.policy_engine import PolicyViolationError
from src.services.task_service import TaskService
from src.services.triage_service import TriageService

BUILDING_ID = "bld-01"
EMERGENCY_ID = "emg-sc3"
ISSUE_ID = "issue-sc3"
FLOOR3 = ["resident-i", "resident-j"] + [f"res-30{n}" for n in range(4, 10)] + ["res-310"]


@pytest.fixture
async def repo():
    """3階は 302（resident-h）だけが未応答、それ以外の3階住民は無事。他の階は回答なし。"""
    r = InMemoryRepository()
    await seed_sc3_data(r, building_id=BUILDING_ID)
    for resident_id in FLOOR3:
        await _set_status(r, resident_id, SafetyStatus.SAFE)
    await _set_status(r, "resident-h", SafetyStatus.UNKNOWN)
    return r


async def _set_status(repo, resident_id: str, status: SafetyStatus) -> None:
    await repo.set_current_state(
        BUILDING_ID,
        ResidentEmergencyCurrentState(
            emergency_id=EMERGENCY_ID, resident_id=resident_id, safety_status=status
        ),
    )


async def _tasks_for_h(repo) -> list:
    tasks = await repo.list_all_tasks(BUILDING_ID, EMERGENCY_ID)
    return [t for t in tasks if t.target_resident_id == "resident-h"]


async def _triage(repo) -> list:
    return await TriageService(repo).execute_sc3_triage(BUILDING_ID, EMERGENCY_ID, ISSUE_ID)


async def test_gemini_success_saves_tasks_only_once(repo, monkeypatch):
    mock_response = MagicMock()
    mock_response.text = json.dumps({
        "pairing": [{"assigned_resident_id": "resident-j", "target_resident_id": "resident-h"}],
        "reasoning": "303号室が302号室の隣です。",
    })
    mock_client = MagicMock()
    mock_client.aio.models.generate_content = AsyncMock(return_value=mock_response)
    agent = BuildingAgent(repo=repo)
    monkeypatch.setattr(agent, "_get_genai_client", lambda: mock_client)

    res = await agent.execute_triage(BUILDING_ID, EMERGENCY_ID, ISSUE_ID, use_llm=True)

    assert "Gemini" in res.agent_model
    h_tasks = await _tasks_for_h(repo)
    # 以前はルールの Task と Gemini の Task が両方保存されていた
    assert len(h_tasks) == 1
    assert h_tasks[0].resident_id == "resident-j"
    all_tasks = await repo.list_all_tasks(BUILDING_ID, EMERGENCY_ID)
    assert len(all_tasks) == len(res.created_tasks)


async def test_second_triage_skips_targets_with_active_tasks(repo):
    first = await _triage(repo)
    second = await _triage(repo)

    assert any(t.target_resident_id == "resident-h" for t in first)
    assert second == []
    assert len(await _tasks_for_h(repo)) == 1


async def test_completed_target_is_not_offered_again(repo):
    [task] = await _tasks_for_h_after(repo)
    svc = TaskService(repo)
    await svc.respond_to_task(BUILDING_ID, EMERGENCY_ID, task.task_id, task.resident_id,
                              TaskStatus.APPROVED)
    await svc.report_task_progress(BUILDING_ID, EMERGENCY_ID, task.task_id, task.resident_id,
                                   TaskStatus.COMPLETED,
                                   reason_code=ReasonCode.TARGET_NO_RESPONSE)

    assert await _triage(repo) == []
    assert len(await _tasks_for_h(repo)) == 1


async def test_declined_target_is_reoffered_to_another_helper(repo):
    [first] = await _tasks_for_h_after(repo)
    await TaskService(repo).respond_to_task(
        BUILDING_ID, EMERGENCY_ID, first.task_id, first.resident_id, TaskStatus.DECLINED
    )

    second = await _triage(repo)

    assert len(second) == 1
    assert second[0].target_resident_id == "resident-h"
    assert second[0].resident_id != first.resident_id
    # 辞退した住民には同じ依頼が届かない
    assert first.resident_id not in {t.resident_id for t in second}


async def test_expired_offer_is_marked_and_reoffered(repo):
    [first] = await _tasks_for_h_after(repo)
    first.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await repo.update_task(BUILDING_ID, EMERGENCY_ID, first)

    second = await _triage(repo)

    expired = await repo.get_task(BUILDING_ID, EMERGENCY_ID, first.task_id)
    assert expired.status == TaskStatus.EXPIRED
    events = await repo.list_task_events(BUILDING_ID, EMERGENCY_ID, first.task_id)
    timeout = events[-1]
    assert timeout.event_type == TaskEventType.DECLINED
    assert timeout.reason_code == ReasonCode.TIMEOUT
    assert timeout.actor_type == ActorType.SYSTEM
    assert [t.target_resident_id for t in second] == ["resident-h"]
    assert second[0].resident_id != first.resident_id


async def test_reoffer_stops_after_two_offers(repo):
    svc = TaskService(repo)
    for _ in range(2):
        tasks = [t for t in await _triage(repo) if t.target_resident_id == "resident-h"]
        assert len(tasks) == 1
        await svc.respond_to_task(BUILDING_ID, EMERGENCY_ID, tasks[0].task_id,
                                  tasks[0].resident_id, TaskStatus.DECLINED)

    classification = await TriageService(repo).classify_candidates(BUILDING_ID, EMERGENCY_ID)
    assert "resident-h" in {c.resident_id for c in classification.exhausted_targets}
    assert await _triage(repo) == []
    assert len(await _tasks_for_h(repo)) == 2


async def test_cannot_respond_to_task_that_is_no_longer_offered(repo):
    [task] = await _tasks_for_h_after(repo)
    svc = TaskService(repo)
    await svc.respond_to_task(BUILDING_ID, EMERGENCY_ID, task.task_id, task.resident_id,
                              TaskStatus.DECLINED)

    with pytest.raises(PolicyViolationError):
        await svc.respond_to_task(BUILDING_ID, EMERGENCY_ID, task.task_id, task.resident_id,
                                  TaskStatus.APPROVED)


async def _tasks_for_h_after(repo) -> list:
    await _triage(repo)
    return await _tasks_for_h(repo)


# --- #61: 管理人の確認状況ボード ---


async def _board(repo) -> dict:
    items = await TriageService(repo).build_task_board(BUILDING_ID, EMERGENCY_ID, ISSUE_ID)
    return {i.target_room_number: i for i in items}


async def test_board_shows_offered_task_with_helper_and_reason(repo):
    [task] = await _tasks_for_h_after(repo)
    board = await _board(repo)

    item = board["302"]
    assert (item.group, item.state) == ("ACTIVE", "OFFERED")
    assert item.helper_room_number in {"301", "303"}
    assert item.reason == "同じ3階・隣の部屋"
    assert item.expires_at is not None
    # 1階は無事の住民がいないので、担当なしとして要対応に出る
    assert (board["101"].group, board["101"].state) == ("ACTION", "UNASSIGNED")
    # 外出中の 504 は出さない
    assert "504" not in board


async def test_board_tracks_decline_exhaustion_and_results(repo):
    svc = TaskService(repo)
    [first] = await _tasks_for_h_after(repo)
    await svc.respond_to_task(BUILDING_ID, EMERGENCY_ID, first.task_id, first.resident_id,
                              TaskStatus.DECLINED)
    assert (await _board(repo))["302"].state == "RETRY_PENDING"

    [second] = [t for t in await _triage(repo) if t.target_resident_id == "resident-h"]
    await svc.respond_to_task(BUILDING_ID, EMERGENCY_ID, second.task_id, second.resident_id,
                              TaskStatus.DECLINED)
    item = (await _board(repo))["302"]
    assert (item.group, item.state, item.offer_count) == ("ACTION", "EXHAUSTED", 2)


async def test_board_separates_no_response_from_responded(repo):
    svc = TaskService(repo)
    [task] = await _tasks_for_h_after(repo)
    await svc.respond_to_task(BUILDING_ID, EMERGENCY_ID, task.task_id, task.resident_id,
                              TaskStatus.APPROVED)
    assert (await _board(repo))["302"].state == "APPROVED"

    await svc.report_task_progress(BUILDING_ID, EMERGENCY_ID, task.task_id, task.resident_id,
                                   TaskStatus.COMPLETED,
                                   reason_code=ReasonCode.TARGET_NO_RESPONSE)
    item = (await _board(repo))["302"]
    assert (item.group, item.state) == ("ACTION", "NO_RESPONSE")
    assert list(await _board(repo))[0] == "302"  # 要対応の先頭に並ぶ
