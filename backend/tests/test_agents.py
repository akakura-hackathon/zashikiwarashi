"""Tests for Multi-Agent and Privacy Gateway (FN-03, FN-04, FN-05)."""

from datetime import UTC, datetime

import pytest

from src.agents.building_agent import BuildingAgent
from src.agents.resident_agent import ResidentAgent
from src.db.in_memory_repo import InMemoryRepository
from src.db.seed import seed_sc3_data
from src.models.domain import (
    ResidentEmergencyCurrentState,
    SafetyStatus,
    Task,
    TaskResult,
    TaskStatus,
)
from src.services.privacy_gateway import PrivacyGateway


@pytest.fixture
async def seeded_repo():
    repo = InMemoryRepository()
    await seed_sc3_data(repo, building_id="bld-01")
    return repo


@pytest.mark.asyncio
async def test_privacy_gateway_pii_masking():
    """FN-05: 個人識別情報（部屋番号、電話番号）のマスキングとトークン抽象化."""
    text1 = "302号室のインターホンを確認してください。"
    sanitized1 = PrivacyGateway.sanitize_text(text1, floor=3)
    assert "[3F_UNIT]" in sanitized1
    assert "302号室" not in sanitized1

    text2 = "私の電話番号は 090-1234-5678 です。1204号室に住んでいます。"
    sanitized2 = PrivacyGateway.sanitize_text(text2)
    assert "[PHONE_NUMBER]" in sanitized2
    assert "[12F_UNIT]" in sanitized2
    assert "090-1234-5678" not in sanitized2
    assert "1204" not in sanitized2


@pytest.mark.asyncio
async def test_privacy_gateway_profile_abstraction():
    """FN-05: 世帯プロファイルの抽象化（個人特定情報の除去）."""
    raw_profile = {
        "floor": 3,
        "elderly_count": 1,
        "infant_count": 0,
        "mobility_difficulty_count": 1,
        "resident_name": "田中太郎",
        "room_number": "302",
    }
    abstracted = PrivacyGateway.abstract_resident_profile(raw_profile)
    assert abstracted["floor_level"] == "3F"
    assert abstracted["needs_assistance"] is True
    assert abstracted["can_stairs"] is False
    assert "resident_name" not in abstracted
    assert "room_number" not in abstracted


@pytest.mark.asyncio
async def test_resident_agent_r1_counter_proposal(seeded_repo):
    """FN-03 R1: 住民の制約に基づく評価と援助要・逆提案の生成."""
    # 住民H (302号室: 高齢単身・移動困難) の Agent
    agent_h = ResidentAgent(resident_id="resident-h", repo=seeded_repo, building_id="bld-01")
    heavy_task = Task(
        task_id="task-01",
        issue_id="issue-01",
        resident_id="resident-h",
        task_type="NEIGHBOR_CHECK",
    )
    eval_event_h = await agent_h.evaluate_task(heavy_task)
    # 移動困難のため援助要へ振替
    assert eval_event_h.result == TaskResult.REQUIRES_ASSISTANCE

    # 住民I (301号室: 健常単身) の Agent
    agent_i = ResidentAgent(resident_id="resident-i", repo=seeded_repo, building_id="bld-01")
    light_task = Task(
        task_id="task-02",
        issue_id="issue-01",
        resident_id="resident-i",
        task_type="NEIGHBOR_CHECK",
    )
    eval_event_i = await agent_i.evaluate_task(light_task)
    assert eval_event_i.result == TaskResult.CAN_EXECUTE


@pytest.mark.asyncio
async def test_resident_agent_r2_gatekeeper(seeded_repo):
    """FN-03 R2: 開示の番人。承認前は部屋番号を秘匿し、承認後にのみ開示."""
    agent_i = ResidentAgent(resident_id="resident-i", repo=seeded_repo, building_id="bld-01")

    # 承認前の問い合わせ: 部屋番号は返さず抽象トークンのみ
    unapproved_ans = await agent_i.answer_inquiry(inquiry_type="LOCATION", is_approved=False)
    assert unapproved_ans["is_disclosed"] is False
    assert "room_number" not in unapproved_ans
    assert "[3F / RESIDENCE]" in unapproved_ans["location_token"]

    # 承認後の問い合わせ: 部屋番号を開示
    approved_ans = await agent_i.answer_inquiry(inquiry_type="LOCATION", is_approved=True)
    assert approved_ans["is_disclosed"] is True
    assert approved_ans["room_number"] == "301"


@pytest.mark.asyncio
async def test_resident_agent_r3_free_text_and_clarification(seeded_repo):
    """FN-03 R3: 自由文の構造化 Need 変換と聞き返し."""
    agent_i = ResidentAgent(resident_id="resident-i", repo=seeded_repo, building_id="bld-01")

    # 不足情報がある場合（「水」のみ）
    need_short = agent_i.parse_user_free_text("水", floor=3)
    assert need_short.needs_clarification is True
    assert need_short.clarification_question is not None

    # 具体的な困りごとの場合
    need_concrete = agent_i.parse_user_free_text("家具が倒れて足を挟まれ動けません", floor=3)
    assert need_concrete.needs_clarification is False
    assert need_concrete.requires_assistance is True
    assert need_concrete.category == "EVACUATION"
    assert need_concrete.can_stairs is False


@pytest.mark.asyncio
async def test_building_agent_triage_fallback(seeded_repo):
    """FN-04: Building Agent のトリアージ実行とルールベースフォールバック保証."""
    now = datetime.now(UTC)
    # SC-3 の初期状態: 住民IはSAFE、住民HはUNKNOWN（未応答）
    await seeded_repo.set_current_state(
        ResidentEmergencyCurrentState(
            emergency_id="emg-sc3",
            resident_id="resident-i",
            safety_status=SafetyStatus.SAFE,
            observed_at=now,
        ),
    )
    await seeded_repo.set_current_state(
        ResidentEmergencyCurrentState(
            emergency_id="emg-sc3",
            resident_id="resident-h",
            safety_status=SafetyStatus.UNKNOWN,
            observed_at=now,
        ),
    )

    building_agent = BuildingAgent(repo=seeded_repo)

    # LLM 無効（ルールベース）での確実なトリアージ実行
    res = await building_agent.execute_triage(
        building_id="bld-01",
        emergency_id="emg-sc3",
        issue_id="issue-sc3",
        use_llm=False,
    )
    assert res.emergency_id == "emg-sc3"
    assert res.unresponsive_count >= 1
    assert len(res.created_tasks) >= 1
    assert res.created_tasks[0].status == TaskStatus.OFFERED
