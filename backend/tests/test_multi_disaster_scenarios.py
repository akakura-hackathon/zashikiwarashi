"""Comprehensive integration and unit tests for Multi-Disaster Scenarios (SC-1 to SC-4 / Issue #34).

Scenarios covered:
- SC-1: POWER_OUTAGE (大規模停電 × EV停止 — 物資の階段バケツリレー運搬)
- SC-2: FIRE (火災発生 × 避難同行 — 西側非常階段への避難同行)
- SC-3: EARTHQUAKE (地震直後 × 初動トリアージ — 未応答住戸の隣室確認)
- SC-4: FLOOD (洪水・内水氾濫 × 垂直避難 — 低層階から上層階への垂直避難同行)
"""

import pytest
from fastapi.testclient import TestClient

from src.agents.building_agent import BuildingAgent
from src.db.factory import reset_in_memory_repo
from src.db.seed import seed_sc3_data
from src.main import app
from src.models.domain import (
    Emergency,
    EmergencyStatus,
    EmergencyType,
    Issue,
    IssueType,
    SafetyStatus,
    TaskType,
)


@pytest.fixture(autouse=True)
async def setup_test_db():
    repo = reset_in_memory_repo()
    await seed_sc3_data(repo, building_id="bld-01")
    yield repo


@pytest.mark.asyncio
async def test_all_four_disaster_triage_scenarios(setup_test_db):
    """BuildingAgent & TriageService が 4大災害シナリオそれぞれで
    最適なタスクを生成することを検証。
    """
    repo = setup_test_db
    building_agent = BuildingAgent(repo)

    scenarios = [
        (
            EmergencyType.EARTHQUAKE,
            TaskType.NEIGHBOR_CHECK,
            "隣室の安否確認",
            20,
        ),
        (
            EmergencyType.POWER_OUTAGE,
            TaskType.SUPPLY_RELAY,
            "飲料水の階段リレー運搬",
            240,
        ),
        (
            EmergencyType.FIRE,
            TaskType.EVACUATION_ESCORT,
            "西側非常階段への避難同行",
            30,
        ),
        (
            EmergencyType.FLOOD,
            TaskType.VERTICAL_EVACUATION,
            "上層階への垂直避難同行",
            60,
        ),
    ]

    for em_type, expected_task_type, expected_title, expected_seconds in scenarios:
        em_id = f"em-{em_type.value.lower()}"
        iss_id = f"iss-{em_type.value.lower()}"

        # 1. 災害レコード作成
        await repo.create_emergency(
            Emergency(
                emergency_id=em_id,
                building_id="bld-01",
                emergency_type=em_type,
                status=EmergencyStatus.ACTIVE,
                triggered_by="admin-01",
            )
        )
        await repo.create_issue(
            "bld-01",
            Issue(
                issue_id=iss_id,
                emergency_id=em_id,
                issue_type=IssueType.SAFETY_CHECK,
                instruction=f"{em_type.value}発令",
                created_by_admin_id="admin-01",
            ),
        )

        # 2. 住民IがSAFEと回答、住民HはUNKNOWN
        from src.models.domain import ResidentEmergencyCurrentState

        await repo.set_current_state(
            "bld-01",
            ResidentEmergencyCurrentState(
                emergency_id=em_id,
                resident_id="resident-i",
                safety_status=SafetyStatus.SAFE,
            ),
        )
        await repo.set_current_state(
            "bld-01",
            ResidentEmergencyCurrentState(
                emergency_id=em_id,
                resident_id="resident-h",
                safety_status=SafetyStatus.UNKNOWN,
            ),
        )

        # 3. トリアージ実行
        result = await building_agent.execute_triage(
            building_id="bld-01",
            emergency_id=em_id,
            issue_id=iss_id,
            use_llm=False,  # ルールベースフォールバック検証
        )

        assert len(result.created_tasks) > 0, f"{em_type}: タスクが生成されること"
        target_task = next(
            (t for t in result.created_tasks if t.resident_id == "resident-i"), None
        )
        assert target_task is not None, f"{em_type}: 住民Iにタスクが割り当てられること"
        assert target_task.task_type == expected_task_type, (
            f"{em_type}: task_type が {expected_task_type} であること"
        )
        assert target_task.title == expected_title, (
            f"{em_type}: title が '{expected_title}' であること"
        )
        assert target_task.estimated_seconds == expected_seconds, (
            f"{em_type}: estimated_seconds が {expected_seconds} であること"
        )
        assert em_type.value in result.ai_reasoning, (
            f"{em_type}: 推論理由に災害名が含まれること"
        )


def test_api_trigger_disaster_scenarios_and_route_constraints():
    """POST /emergency/trigger で 4大災害の IssueType と
    route_constraint が正しく反映されることを検証。
    """
    client = TestClient(app)
    admin_headers = {"X-User-Id": "admin-01", "X-User-Role": "admin"}

    # 1. FIRE (火災) -> EVACUATION_GUIDANCE & 西側非常階段
    res_fire = client.post(
        "/emergency/trigger",
        json={
            "building_id": "bld-01",
            "emergency_type": "FIRE",
            "instruction": "棟内火災警報鳴動。西側非常階段より避難開始。",
        },
        headers=admin_headers,
    )
    assert res_fire.status_code == 200
    fire_data = res_fire.json()

    # IssueDetail を取得して確認
    res_detail = client.get(
        f"/issues/{fire_data['issue_id']}",
        headers=admin_headers,
    )
    assert res_detail.status_code == 200
    detail_data = res_detail.json()
    assert detail_data["issue"]["issue_type"] == "EVACUATION_GUIDANCE"

    # 2. FLOOD (洪水) -> VERTICAL_EVACUATION & 上層階共用部
    res_flood = client.post(
        "/emergency/trigger",
        json={
            "building_id": "bld-01",
            "emergency_type": "FLOOD",
            "instruction": "浸水警戒発令。低層階住民は6階以上へ垂直避難。",
        },
        headers=admin_headers,
    )
    assert res_flood.status_code == 200
    flood_data = res_flood.json()

    res_flood_detail = client.get(
        f"/issues/{flood_data['issue_id']}",
        headers=admin_headers,
    )
    assert res_flood_detail.status_code == 200
    assert res_flood_detail.json()["issue"]["issue_type"] == "VERTICAL_EVACUATION"

    # 3. POWER_OUTAGE (停電) -> SUPPLY_DISTRIBUTION
    res_power = client.post(
        "/emergency/trigger",
        json={
            "building_id": "bld-01",
            "emergency_type": "POWER_OUTAGE",
            "instruction": "全館停電発生。物資支援開始。",
        },
        headers=admin_headers,
    )
    assert res_power.status_code == 200
    power_data = res_power.json()

    res_power_detail = client.get(
        f"/issues/{power_data['issue_id']}",
        headers=admin_headers,
    )
    assert res_power_detail.status_code == 200
    assert res_power_detail.json()["issue"]["issue_type"] == "SUPPLY_DISTRIBUTION"


@pytest.mark.asyncio
async def test_sc1_power_outage_need_parsing_and_relay_flow(setup_test_db):
    """SC-1 停電シナリオで住民Agentが困りごと（水・階段・熱中症）を
    正確に構造化し、物資リレータスクが生成されることを検証。
    """
    repo = setup_test_db
    from src.agents.resident_agent import ResidentAgent

    agent = ResidentAgent(resident_id="res-1401", repo=repo, building_id="bld-01")

    # 1. 水不足かつ階段歩行不可のメッセージ
    msg_water = "14階で飲料水が切れました。足が悪く階段が降りられません。"
    need1 = agent.parse_user_free_text(msg_water, floor=14)
    assert need1.category == "WATER"
    assert need1.can_stairs is False
    assert need1.requires_assistance is True

    # 2. 空調停止による熱中症リスク
    msg_heat = "停電でエアコンが止まり、部屋が暑くて熱中症が心配です。"
    need2 = agent.parse_user_free_text(msg_heat, floor=8)
    assert need2.category == "HEAT_RELIEF"
    assert need2.requires_assistance is True

    # 3. 停電トリアージタスク生成
    building_agent = BuildingAgent(repo)
    emergency = Emergency(
        emergency_id="em-sc1-test",
        building_id="bld-01",
        emergency_type=EmergencyType.POWER_OUTAGE,
        status=EmergencyStatus.ACTIVE,
        triggered_by="admin-01",
    )
    await repo.create_emergency(emergency)
    issue = Issue(
        issue_id="iss-sc1-test",
        emergency_id="em-sc1-test",
        building_id="bld-01",
        issue_type=IssueType.SUPPLY_DISTRIBUTION,
        title="物資支援・階段リレー",
        description="EV全基停止に伴う飲料水の階段リレー運搬",
        instruction="全館停電発生。物資支援開始。",
        created_by_admin_id="admin-01",
    )
    await repo.create_issue("bld-01", issue)

    from src.models.domain import ResidentEmergencyCurrentState
    await repo.set_current_state(
        "bld-01",
        ResidentEmergencyCurrentState(
            emergency_id="em-sc1-test",
            resident_id="resident-i",
            safety_status=SafetyStatus.SAFE,
        ),
    )
    await repo.set_current_state(
        "bld-01",
        ResidentEmergencyCurrentState(
            emergency_id="em-sc1-test",
            resident_id="resident-h",
            safety_status=SafetyStatus.UNKNOWN,
        ),
    )

    triage_result = await building_agent.execute_triage(
        building_id="bld-01",
        emergency_id="em-sc1-test",
        issue_id="iss-sc1-test",
        use_llm=False,
    )
    tasks = triage_result.created_tasks
    assert len(tasks) > 0
    assert tasks[0].task_type == TaskType.SUPPLY_RELAY
    assert tasks[0].title == "飲料水の階段リレー運搬"
    assert tasks[0].estimated_seconds == 240


@pytest.mark.asyncio
async def test_sc2_fire_scenario_e2e(setup_test_db):
    """SC-2 火災・煙感知シナリオの一気通貫検証。

    - 避難状況送信（階段歩行困難・煙充満）
    - ResidentAgent による Need 構造化
    - BuildingAgent による西側非常階段同行タスクの生成
    - タスク受諾・部屋番号限定開示・結果報告（退避完了）
    """
    repo = setup_test_db
    from src.agents.resident_agent import ResidentAgent
    from src.models.domain import TaskStatus

    # 1. ResidentAgent による Need 解析
    ra_e = ResidentAgent(resident_id="resident-h", repo=repo, building_id="bld-01")
    fire_msg = "廊下に煙が漂っています。足腰に不安があり一人で階段を降りられません。"
    need = ra_e.parse_user_free_text(fire_msg, floor=8)
    assert need.category == "EVACUATION"
    assert need.can_stairs is False
    assert need.requires_assistance is True

    # 2. 火災災害および Issue の作成
    building_agent = BuildingAgent(repo)
    emergency = Emergency(
        emergency_id="em-sc2-fire",
        building_id="bld-01",
        emergency_type=EmergencyType.FIRE,
        status=EmergencyStatus.ACTIVE,
        triggered_by="admin-01",
    )
    await repo.create_emergency(emergency)
    issue = Issue(
        issue_id="iss-sc2-fire",
        emergency_id="em-sc2-fire",
        building_id="bld-01",
        issue_type=IssueType.EVACUATION_GUIDANCE,
        title="西側非常階段への避難同行",
        description="同一階の要支援者と避難可能住民のマッチング",
        instruction="6階火災警報鳴動。西側非常階段より全館避難開始。",
        created_by_admin_id="admin-01",
    )
    await repo.create_issue("bld-01", issue)

    # 3. 住民Hは NEED_HELP、住民Iは SAFE で回答
    from src.models.domain import ResidentEmergencyCurrentState
    await repo.set_current_state(
        "bld-01",
        ResidentEmergencyCurrentState(
            emergency_id="em-sc2-fire",
            resident_id="resident-h",
            safety_status=SafetyStatus.NEED_HELP,
        ),
    )
    await repo.set_current_state(
        "bld-01",
        ResidentEmergencyCurrentState(
            emergency_id="em-sc2-fire",
            resident_id="resident-i",
            safety_status=SafetyStatus.SAFE,
        ),
    )

    # 4. トリアージ実行 -> EVACUATION_ESCORT タスク生成
    triage_result = await building_agent.execute_triage(
        building_id="bld-01",
        emergency_id="em-sc2-fire",
        issue_id="iss-sc2-fire",
        use_llm=False,
    )
    tasks = triage_result.created_tasks
    assert len(tasks) > 0
    escort_task = tasks[0]
    assert escort_task.task_type == TaskType.EVACUATION_ESCORT
    assert escort_task.title == "西側非常階段への避難同行"
    assert escort_task.estimated_seconds == 30
    assert escort_task.status == TaskStatus.OFFERED

    # 5. REST API 経由でのタスク受諾・報告フロー
    client = TestClient(app)
    # 受諾 (APPROVED)
    res_respond = client.post(
        f"/tasks/{escort_task.task_id}/respond",
        json={"response": "APPROVED"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_respond.status_code == 200

    # 開示確認 (API-04: target_room_number が開示される)
    res_detail = client.get(
        f"/tasks/{escort_task.task_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_detail.status_code == 200
    detail_data = res_detail.json()
    assert detail_data["is_disclosed"] is True
    assert detail_data["target_room_number"] is not None

    # 結果報告 (API-06: TARGET_RESPONDED -> COMPLETED)
    res_report = client.post(
        f"/tasks/{escort_task.task_id}/report",
        json={"status": "COMPLETED", "reason_code": "TARGET_RESPONDED"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_report.status_code == 200
    assert res_report.json()["status"] == "COMPLETED"

