"""Comprehensive integration tests for REST API endpoints (API-01 to API-08)."""

import pytest
from fastapi.testclient import TestClient

from src.db.factory import reset_in_memory_repo
from src.db.seed import seed_sc3_data
from src.main import app


@pytest.fixture(autouse=True)
async def setup_test_db():
    repo = reset_in_memory_repo()
    await seed_sc3_data(repo, building_id="bld-01")
    yield repo


def test_api_sc3_end_to_end_flow():
    client = TestClient(app)

    # 1. API-01: Trigger Emergency (Admin only)
    # Unauthorized as resident
    res_forbidden = client.post(
        "/emergency/trigger",
        json={"building_id": "bld-01", "instruction": "震度5強地震"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_forbidden.status_code == 403

    # Authorized as Admin
    res_trigger = client.post(
        "/emergency/trigger",
        json={"building_id": "bld-01", "instruction": "震度5強地震。安否確認開始"},
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_trigger.status_code == 200
    data_trigger = res_trigger.json()
    emergency_id = data_trigger["emergency_id"]
    issue_id = data_trigger["issue_id"]
    assert emergency_id.startswith("em-")
    assert issue_id.startswith("iss-")

    # 2. API-02: Resident I reports SAFE
    res_presence_i = client.post(
        "/emergency/confirm-presence",
        json={"emergency_id": emergency_id, "safety_status": "SAFE"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_presence_i.status_code == 200
    assert res_presence_i.json()["safety_status"] == "SAFE"

    # (Resident H remains UNKNOWN, Resident K is UNKNOWN but calendar busy)

    # 3. API-08: Admin triggers Triage
    res_triage = client.post(
        f"/emergencies/{emergency_id}/triage",
        json={"issue_id": issue_id},
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_triage.status_code == 200
    assert res_triage.json()["tasks_created"] >= 1

    # 4. API-03: Resident I views issue progress & finds assigned task
    res_issue_resident = client.get(
        f"/issues/{issue_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_issue_resident.status_code == 200
    resident_tasks = res_issue_resident.json()["tasks"]
    assert len(resident_tasks) >= 1
    task_for_h = next((t for t in resident_tasks if t["target_resident_id"] == "resident-h"), None)
    assert task_for_h is not None
    task_id = task_for_h["task_id"]

    # 5. API-06: Progressive Disclosure check BEFORE approval
    res_task_before = client.get(
        f"/tasks/{task_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_task_before.status_code == 200
    detail_before = res_task_before.json()
    assert detail_before["is_disclosed"] is False
    assert detail_before["target_room_number"] is None  # MASKED
    assert detail_before["target_floor"] == 3

    # 6. API-04: Resident I approves the neighbor check task
    res_approval = client.post(
        f"/tasks/{task_id}/respond",
        json={"response": "APPROVED"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_approval.status_code == 200
    assert res_approval.json()["status"] == "APPROVED"

    # API-06: Progressive Disclosure check AFTER approval -> Room 302 disclosed
    res_task_after = client.get(
        f"/tasks/{task_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_task_after.status_code == 200
    detail_after = res_task_after.json()
    assert detail_after["is_disclosed"] is True
    assert detail_after["target_room_number"] == "302"  # DISCLOSED

    # 7. API-05: Resident I reports completion with TARGET_NO_RESPONSE
    res_report = client.post(
        f"/tasks/{task_id}/report",
        json={"status": "COMPLETED", "reason_code": "TARGET_NO_RESPONSE"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_report.status_code == 200
    assert res_report.json()["status"] == "COMPLETED"

    # 8. API-03: Admin views issue progress and sees CRITICAL alert for 302
    res_issue_admin = client.get(
        f"/issues/{issue_id}",
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_issue_admin.status_code == 200
    priority_targets = res_issue_admin.json()["priority_targets"]
    target_302 = next((p for p in priority_targets if p["room_number"] == "302"), None)
    assert target_302 is not None
    assert target_302["priority_level"] == "CRITICAL"
    assert target_302["neighbor_check_result"] == "TARGET_NO_RESPONSE"

    # 9. API-07: Resident I views personal audit events
    res_audit = client.get(
        "/me/audit-events",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_audit.status_code == 200
    audit_events = res_audit.json()["audit_events"]
    assert len(audit_events) >= 1
    assert "unit_room_number:302" in audit_events[0]["data_disclosed"]


def test_fn08_room_map_tracks_resident_answers_and_emergency_reset():
    client = TestClient(app)
    admin = {"X-User-Id": "admin-01", "X-User-Role": "admin"}
    resident = {"X-User-Id": "resident-i", "X-User-Role": "resident"}
    trigger = client.post(
        "/emergency/trigger", headers=admin, json={"building_id": "bld-01"}
    ).json()
    path = f"/issues/{trigger['issue_id']}"
    initial = client.get(path, headers=admin).json()
    assert len(initial["room_states"]) == 50
    # NFR-05 / SC-3: Realistic initial distribution (38 SAFE, 10 UNKNOWN, 2 NEED_HELP)
    assert initial["current_states_summary"] == {"SAFE": 38, "UNKNOWN": 10, "NEED_HELP": 2}
    assert initial["room_states"]["301"] == "UNKNOWN"
    assert initial["likely_away_count"] == 1
    assert "504" in initial["likely_away_rooms"]
    assert initial["issue"]["created_at"]

    # resident-i updates their state: UNKNOWN -> SAFE -> NEED_HELP -> SAFE
    response_safe1 = client.post(
        "/emergency/confirm-presence", headers=resident,
        json={"emergency_id": trigger["emergency_id"], "safety_status": "SAFE"},
    )
    assert response_safe1.status_code == 200
    detail1 = client.get(path, headers=admin).json()
    assert detail1["room_states"]["301"] == "SAFE"
    assert detail1["current_states_summary"]["SAFE"] == 39
    assert detail1["current_states_summary"]["UNKNOWN"] == 9
    assert detail1["current_states_summary"]["NEED_HELP"] == 2

    response_help = client.post(
        "/emergency/confirm-presence", headers=resident,
        json={"emergency_id": trigger["emergency_id"], "safety_status": "NEED_HELP"},
    )
    assert response_help.status_code == 200
    detail2 = client.get(path, headers=admin).json()
    assert detail2["room_states"]["301"] == "NEED_HELP"
    assert detail2["current_states_summary"]["SAFE"] == 38
    assert detail2["current_states_summary"]["UNKNOWN"] == 9
    assert detail2["current_states_summary"]["NEED_HELP"] == 3

    response_safe2 = client.post(
        "/emergency/confirm-presence", headers=resident,
        json={"emergency_id": trigger["emergency_id"], "safety_status": "SAFE"},
    )
    assert response_safe2.status_code == 200
    detail3 = client.get(path, headers=admin).json()
    assert detail3["room_states"]["301"] == "SAFE"
    assert detail3["current_states_summary"]["SAFE"] == 39
    assert detail3["current_states_summary"]["UNKNOWN"] == 9

    resident_view = client.get(path, headers=resident).json()
    assert resident_view["room_states"] == {}
    assert resident_view["likely_away_rooms"] == []
    assert resident_view["likely_away_count"] == 0

    # Reset with default deterministic simulation
    new = client.post("/emergency/trigger", headers=admin, json={"building_id": "bld-01"}).json()
    reset = client.get(f"/issues/{new['issue_id']}", headers=admin).json()
    assert reset["current_states_summary"] == {"SAFE": 38, "UNKNOWN": 10, "NEED_HELP": 2}
    assert reset["likely_away_count"] == 1
    assert "504" in reset["likely_away_rooms"]

    # Reset with simulate_distribution=False (all UNKNOWN fallback)
    no_sim = client.post(
        "/emergency/trigger",
        headers=admin,
        json={"building_id": "bld-01", "simulate_distribution": False},
    ).json()
    reset_no_sim = client.get(f"/issues/{no_sim['issue_id']}", headers=admin).json()
    assert set(reset_no_sim["room_states"].values()) == {"UNKNOWN"}
    assert reset_no_sim["current_states_summary"] == {"UNKNOWN": 50}


def test_fn02_anonymous_gateway_session_cannot_use_demo_personas():
    import base64
    import json

    claims = {"sub": "anonymous-user", "firebase": {"sign_in_provider": "anonymous"}}
    token = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode()
    client = TestClient(app)
    for persona in ("admin", "resident"):
        response = client.post(
            "/emergency/confirm-presence",
            headers={"X-Apigateway-Api-Userinfo": token, "X-User-Role": persona},
            json={"emergency_id": "em-demo", "safety_status": "SAFE"},
        )
        assert response.status_code == 401


def test_fn03_req15_free_text_parsing_and_clarification():
    client = TestClient(app)
    admin = {"X-User-Id": "admin-01", "X-User-Role": "admin"}
    resident_i = {"X-User-Id": "resident-i", "X-User-Role": "resident"}

    trigger = client.post(
        "/emergency/trigger", headers=admin, json={"building_id": "bld-01"}
    ).json()
    em_id = trigger["emergency_id"]

    # 1. 自由文で負傷・脱出困難を入力 -> 救助要・EVACUATION に構造化
    res_injury = client.post(
        "/emergency/confirm-presence",
        headers=resident_i,
        json={
            "emergency_id": em_id,
            "safety_status": "NEED_HELP",
            "message": "棚が倒れて足が痛くて動けません。ドアも変形しています。",
        },
    )
    assert res_injury.status_code == 200
    data_injury = res_injury.json()
    assert data_injury["safety_status"] == "NEED_HELP"
    assert data_injury["needs_clarification"] is False
    assert data_injury["structured_need"] is not None
    assert data_injury["structured_need"]["category"] == "EVACUATION"
    assert data_injury["structured_need"]["requires_assistance"] is True
    assert data_injury["structured_need"]["can_stairs"] is False
    assert data_injury["structured_need"]["floor"] == 3

    # 2. 短すぎる情報不足メッセージ（例:「水」） -> 聞き返し質問が返却される
    res_short = client.post(
        "/emergency/confirm-presence",
        headers=resident_i,
        json={
            "emergency_id": em_id,
            "safety_status": "NEED_HELP",
            "message": "水",
        },
    )
    assert res_short.status_code == 200
    data_short = res_short.json()
    assert data_short["needs_clarification"] is True
    assert "お怪我や閉じ込め" in data_short["clarification_question"]


def test_get_active_emergency():
    """FN-01 / API-08: リロード時のアクティブ緊急事態および最新Issueの復元エンドポイント検証"""
    client = TestClient(app)
    resident_headers = {"X-User-Id": "resident-i", "X-User-Role": "resident"}
    admin_headers = {"X-User-Id": "admin-01", "X-User-Role": "admin"}

    # 1. 緊急事態が未発令の状態では is_active=False
    res_initial = client.get("/emergency/active", headers=resident_headers)
    assert res_initial.status_code == 200
    data_initial = res_initial.json()
    assert data_initial["is_active"] is False
    assert data_initial["emergency_id"] is None
    assert data_initial["issue_id"] is None

    # 2. 発令後の取得では is_active=True, emergency_id, issue_id が返る
    res_trigger = client.post(
        "/emergency/trigger",
        json={"building_id": "bld-01", "instruction": "大地震発生。安否確認をお願いします。"},
        headers=admin_headers,
    )
    assert res_trigger.status_code == 200
    trigger_data = res_trigger.json()

    res_active = client.get("/emergency/active", headers=resident_headers)
    assert res_active.status_code == 200
    data_active = res_active.json()
    assert data_active["is_active"] is True
    assert data_active["emergency_id"] == trigger_data["emergency_id"]
    assert data_active["issue_id"] == trigger_data["issue_id"]
    assert data_active["status"] == "ACTIVE"
    assert "大地震発生" in data_active["instruction"]


def test_random_seed_and_disaster_weighted_distribution():
    """Issue #50: ランダムシード生成および災害種別に応じた重み付け安否分布シミュレーションの検証"""
    client = TestClient(app)
    admin_headers = {"X-User-Id": "admin-01", "X-User-Role": "admin"}

    # 1. FLOOD (洪水): 低層階（1F/2F）への被害偏重シミュレーション
    res_flood = client.post(
        "/emergency/trigger",
        json={
            "building_id": "bld-01",
            "emergency_type": "FLOOD",
            "instruction": "大雨による冠水警報",
            "random_seed": True,
        },
        headers=admin_headers,
    )
    assert res_flood.status_code == 200
    issue_flood_id = res_flood.json()["issue_id"]

    res_issue = client.get(f"/issues/{issue_flood_id}", headers=admin_headers)
    assert res_issue.status_code == 200
    data_issue = res_issue.json()
    # 6 non-persona + 4 manual personas = 10 UNKNOWN
    assert data_issue["current_states_summary"]["UNKNOWN"] == 10
    assert data_issue["current_states_summary"]["SAFE"] == 38

    # 2. FIRE (火災): 上層階（4F/5F）への影響シミュレーション
    res_fire = client.post(
        "/emergency/trigger",
        json={
            "building_id": "bld-01",
            "emergency_type": "FIRE",
            "instruction": "火災警報発令",
            "random_seed": True,
        },
        headers=admin_headers,
    )
    assert res_fire.status_code == 200


def test_simulate_step_advances_safety():
    """Issue #50: 時間経過による未回答住戸の自律回答シミュレーション (simulate-step) の検証"""
    client = TestClient(app)
    admin_headers = {"X-User-Id": "admin-01", "X-User-Role": "admin"}
    resident_headers = {"X-User-Id": "resident-i", "X-User-Role": "resident"}

    # 発災
    res_trigger = client.post(
        "/emergency/trigger",
        json={"building_id": "bld-01", "instruction": "地震発生"},
        headers=admin_headers,
    )
    assert res_trigger.status_code == 200
    em_id = res_trigger.json()["emergency_id"]

    # 住民からの simulate-step 呼び出しは 403 Forbidden
    res_forbidden = client.post(
        f"/emergencies/{em_id}/simulate-step",
        headers=resident_headers,
    )
    assert res_forbidden.status_code == 403

    # 管理者からの simulate-step 呼び出し
    res_step = client.post(
        f"/emergencies/{em_id}/simulate-step",
        headers=admin_headers,
    )
    assert res_step.status_code == 200
    data_step = res_step.json()
    assert 1 <= data_step["updated_count"] <= 2
    assert len(data_step["updated_residents"]) == data_step["updated_count"]
    # 手動ペルソナは自動ステップで更新されない
    manual_ids = {"resident-i", "resident-h", "resident-j", "resident-k"}
    for uid in data_step["updated_residents"]:
        assert uid not in manual_ids

    # SAFE数が増加し、UNKNOWN数が減少していることを確認
    assert data_step["safe_count"] == 38 + data_step["updated_count"]
    assert data_step["unknown_count"] == 10 - data_step["updated_count"]


