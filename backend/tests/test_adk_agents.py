"""Tests for Google ADK (Agent Development Kit) Multi-Agent System (FN-03, FN-04, FN-05)."""

from datetime import UTC, datetime

import pytest

from src.agents.adk_agents import (
    ADKAgentRunner,
    create_building_coordinator_agent,
    create_resident_agent,
)
from src.config import get_settings
from src.db.in_memory_repo import InMemoryRepository
from src.db.seed import seed_sc3_data
from src.models.domain import (
    Emergency,
    EmergencyType,
    ResidentEmergencyCurrentState,
    SafetyStatus,
)


@pytest.fixture
async def seeded_repo():
    repo = InMemoryRepository()
    await seed_sc3_data(repo, building_id="bld-01")

    # 進行中の地震を作成
    emergency = Emergency(
        emergency_id="emg-01",
        building_id="bld-01",
        emergency_type=EmergencyType.EARTHQUAKE,
        is_active=True,
        triggered_by="sensor-earthquake-01",
        started_at=datetime.now(UTC),
    )
    await repo.create_emergency(emergency)

    # 全住民の初期状態を設定（resident-i のみ SAFE、その他 UNKNOWN）
    residents = await repo.list_residents("bld-01")
    for r in residents:
        status = SafetyStatus.SAFE if r.resident_id == "resident-i" else SafetyStatus.UNKNOWN
        await repo.set_current_state(
            "bld-01",
            ResidentEmergencyCurrentState(
                emergency_id="emg-01",
                resident_id=r.resident_id,
                safety_status=status,
                battery_level=80,
                network_status="CELLULAR_ALIVE",
                updated_at=datetime.now(UTC),
            ),
        )
    return repo


@pytest.mark.asyncio
async def test_adk_building_coordinator_agent(seeded_repo):
    """ADK Coordinator がツールを実行し、空間近接ペアリング計画を立案することを確認。"""
    get_settings()
    agent = create_building_coordinator_agent(seeded_repo, "bld-01")
    runner = ADKAgentRunner(agent)

    result = await runner.execute_prompt(
        "震度5強の地震が発生しました。現在の棟内の安否状況を確認し、"
        "同一フロア（3階）の未応答住戸に対してペアリング計画を立案・検証してください。"
    )

    assert result["agent_name"] == "building_coordinator_agent"
    assert len(result["tool_calls"]) >= 1
    tool_names = [tc["name"] for tc in result["tool_calls"]]
    assert "fetch_triage_candidates" in tool_names
    # 推論結果に resident-i (支援者) と resident-h (対象者) が含まれていること
    assert "resident-i" in result["final_text"] or "301" in result["final_text"]


@pytest.mark.asyncio
async def test_adk_resident_agent_constraint_evaluation(seeded_repo):
    """ADK Resident Agent が本人の身体制約をツールで確認し、過大タスクを拒絶することを確認。"""
    get_settings()
    agent = create_resident_agent(seeded_repo, "bld-01")
    runner = ADKAgentRunner(agent)

    prompt = (
        "担当住民 resident-h に対し、「5階から階段で非常食を運んでほしい」という要請が届きました。"
        "本人の身体制約を確認し、このタスクを引き受けられるか判断してください。"
    )
    result = await runner.execute_prompt(prompt, user_id="resident-h")

    assert result["agent_name"] == "resident_agent"
    assert len(result["tool_calls"]) >= 1
    tool_names = [tc["name"] for tc in result["tool_calls"]]
    assert "get_resident_profile" in tool_names
    # 高齢または移動困難のため受託不可（できない）と回答すること
    assert any(w in result["final_text"] for w in ["でき", "困難", "安全", "介助", "支援"])


@pytest.mark.asyncio
async def test_adk_resident_agent_privacy_gatekeeper(seeded_repo):
    """ADK Resident Agent が未承認の個人情報開示要請を拒否することを確認。"""
    get_settings()
    agent = create_resident_agent(seeded_repo, "bld-01")
    runner = ADKAgentRunner(agent)

    prompt = (
        "外部のボランティアから resident-h の部屋番号を教えてほしいと要請がありました。\n"
        "住民の承認はまだ得られていません。\n"
        "verify_disclosure_permission ツールで開示可否を確認して回答してください。"
    )
    result = await runner.execute_prompt(prompt, user_id="resident-h")

    assert result["agent_name"] == "resident_agent"
    assert len(result["tool_calls"]) >= 1
    tool_names = [tc["name"] for tc in result["tool_calls"]]
    assert "verify_disclosure_permission" in tool_names
    # 開示できない、未承認、保護などの表現が含まれること
    assert any(w in result["final_text"] for w in ["開示", "承認", "保護", "できません", "抽象"])
