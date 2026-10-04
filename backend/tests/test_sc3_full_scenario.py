"""Full end-to-end integration scenario test for SC-3 (Earthquake Safety Check Distribution).

Covers SPEC.md §2.3 and DESIGN.md §6.3:
1. Earthquake occurs: Admin triggers emergency mode and safety check issue (API-01).
2. Residents respond:
   - Resident I (301) responds SAFE (API-02).
   - Resident H (302) is unconfirmed (UNKNOWN).
   - Resident K (1204) is outside (UNKNOWN, calendar busy).
3. Admin triggers triage (API-08):
   - Resident K is filtered out (Likely Away).
   - Resident I on 3F is matched to Resident H (302) for neighbor check (1:1, no duplicates).
4. Privacy enforcement & Progressive Disclosure:
   - Third party or unapproved attempts are blocked by Policy Engine.
   - Resident I sees task with target room number MASKED (API-06).
   - Resident I approves the task (API-04) -> Room 302 disclosed & AuditEvent recorded (API-07).
5. Task execution & Management alert:
   - Resident I checks 302, reports TARGET_NO_RESPONSE (API-05).
   - Admin console receives CRITICAL priority alert for Unit 302 (API-03).
"""

import pytest
from fastapi.testclient import TestClient

from src.db.factory import reset_in_memory_repo
from src.db.seed import seed_sc3_data
from src.main import app


@pytest.fixture(autouse=True)
async def setup_sc3_scenario_db():
    repo = reset_in_memory_repo()
    await seed_sc3_data(repo, building_id="bld-01")
    yield repo


def test_sc3_full_earthquake_scenario():
    client = TestClient(app)

    # ----------------------------------------------------
    # Step 1: 地震発生・管理人による緊急モード発令 (API-01)
    # ----------------------------------------------------
    res_trigger = client.post(
        "/emergency/trigger",
        json={
            "building_id": "bld-01",
            "emergency_type": "EARTHQUAKE",
            "instruction": "震度5強の地震が発生しました。各戸の安否確認を一斉実施します。",
        },
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_trigger.status_code == 200, res_trigger.text
    data_trigger = res_trigger.json()
    emergency_id = data_trigger["emergency_id"]
    issue_id = data_trigger["issue_id"]
    assert data_trigger["status"] == "ACTIVE"

    # ----------------------------------------------------
    # Step 2: 住民の安否回答 (API-02)
    # ----------------------------------------------------
    # 住民 I（301号室・健常単身）が「無事」と回答
    res_pres_i = client.post(
        "/emergency/confirm-presence",
        json={"emergency_id": emergency_id, "safety_status": "SAFE"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_pres_i.status_code == 200
    assert res_pres_i.json()["safety_status"] == "SAFE"

    # 住民 H（302号室・高齢単身）は未応答（UNKNOWN のまま）
    # 住民 K（1204号室）は未応答（UNKNOWN、カレンダー外出中）

    # ----------------------------------------------------
    # Step 3: 管理人によるトリアージ開始 (API-08)
    # ----------------------------------------------------
    res_triage = client.post(
        f"/emergencies/{emergency_id}/triage",
        json={"issue_id": issue_id},
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_triage.status_code == 200
    triage_data = res_triage.json()
    assert triage_data["tasks_created"] >= 1
    assert "resident-i" in triage_data["assigned_residents"]

    # ----------------------------------------------------
    # Step 4: 住民 I によるタスク確認と Progressive Disclosure (API-03, API-06)
    # ----------------------------------------------------
    # 住民 I が自身のタスクを確認
    res_issue = client.get(
        f"/issues/{issue_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    tasks = res_issue.json()["tasks"]
    task_for_h = next((t for t in tasks if t["target_resident_id"] == "resident-h"), None)
    assert task_for_h is not None
    assert task_for_h["resident_id"] == "resident-i"
    task_id = task_for_h["task_id"]

    # 承認前: 部屋番号はマスクされている (Progressive Disclosure)
    res_detail_pre = client.get(
        f"/tasks/{task_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_detail_pre.status_code == 200
    pre_data = res_detail_pre.json()
    assert pre_data["is_disclosed"] is False
    assert pre_data["target_room_number"] is None
    assert pre_data["target_floor"] == 3

    # 【セキュリティ検証】未承認の状態でタスクを完了しようとすると遮断される (Policy Engine G5)
    res_blocked = client.post(
        f"/tasks/{task_id}/report",
        json={"status": "COMPLETED", "reason_code": "TARGET_NO_RESPONSE"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_blocked.status_code == 403
    assert "without prior Human Approval" in res_blocked.text

    # 【セキュリティ検証】他人が承認しようとしても遮断される (PRV-06)
    res_imposter = client.post(
        f"/tasks/{task_id}/respond",
        json={"response": "APPROVED"},
        headers={"X-User-Id": "resident-stranger", "X-User-Role": "resident"},
    )
    assert res_imposter.status_code == 403
    assert "Unauthorized" in res_imposter.text

    # ----------------------------------------------------
    # Step 5: 住民 I による Human Approval（承認）(API-04)
    # ----------------------------------------------------
    res_approve = client.post(
        f"/tasks/{task_id}/respond",
        json={"response": "APPROVED"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_approve.status_code == 200
    assert res_approve.json()["status"] == "APPROVED"

    # 承認後: 初めて部屋番号「302」が開示される
    res_detail_post = client.get(
        f"/tasks/{task_id}",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    post_data = res_detail_post.json()
    assert post_data["is_disclosed"] is True
    assert post_data["target_room_number"] == "302"
    assert post_data["target_floor"] == 3

    # 監査イベント (AuditEvent E-016) に部屋番号開示が記録されている
    res_audit = client.get(
        "/me/audit-events",
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_audit.status_code == 200
    audits = res_audit.json()["audit_events"]
    assert len(audits) >= 1
    assert "unit_room_number:302" in audits[0]["data_disclosed"]
    assert audits[0]["action"] == "DISCLOSE_ROOM_NUMBER_ON_APPROVAL"

    # ----------------------------------------------------
    # Step 6: 住民 I が隣室確認を実施し「応答なし」で完了報告 (API-05)
    # ----------------------------------------------------
    res_complete = client.post(
        f"/tasks/{task_id}/report",
        json={"status": "COMPLETED", "reason_code": "TARGET_NO_RESPONSE"},
        headers={"X-User-Id": "resident-i", "X-User-Role": "resident"},
    )
    assert res_complete.status_code == 200
    assert res_complete.json()["status"] == "COMPLETED"

    # ----------------------------------------------------
    # Step 7: 管理人コンソールでの最優先現地確認アラート確認 (API-03)
    # ----------------------------------------------------
    # 管理人が Issue 全体の進捗を確認
    res_admin_issue = client.get(
        f"/issues/{issue_id}",
        headers={"X-User-Id": "admin-01", "X-User-Role": "admin"},
    )
    assert res_admin_issue.status_code == 200
    admin_issue_data = res_admin_issue.json()

    # 「本人未応答 × 近隣確認も応答なし × 高齢単身要配慮」の302号室が CRITICAL アラートとして抽出
    priority_targets = admin_issue_data["priority_targets"]
    target_302 = next((t for t in priority_targets if t["room_number"] == "302"), None)
    assert target_302 is not None
    assert target_302["is_elderly"] is True
    assert target_302["priority_level"] == "CRITICAL"
    assert target_302["neighbor_check_result"] == "TARGET_NO_RESPONSE"

    # 外出予定の住民 K（1204号室）はトリアージ対象外であり、不要なタスクやアラートになっていない
    target_1204 = next((t for t in priority_targets if t["room_number"] == "1204"), None)
    assert target_1204 is None
