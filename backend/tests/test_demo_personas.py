"""FN-02 / FN-08: Authenticated Studio persona switching and repeat answers."""

import base64
import json

import pytest
from fastapi.testclient import TestClient

from src.db.factory import reset_in_memory_repo
from src.db.seed import seed_sc3_data
from src.main import app


def headers(persona=None, persona_role=None, **extra_claims):
    claims = {
        "sub": "google-login-uid",
        "role": "resident",
        "resident_id": "resident-i",
        "unit_id": "unit-301",
        "building_id": "bld-01",
        "firebase": {"sign_in_provider": "google.com"},
        **extra_claims,
    }
    encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode()
    result = {"X-Apigateway-Api-Userinfo": encoded}
    if persona:
        result.update({"X-User-Id": persona, "X-User-Role": persona_role or "resident"})
    return result


@pytest.fixture(autouse=True)
async def seeded_repo():
    repo = reset_in_memory_repo()
    await seed_sc3_data(repo, building_id="bld-01")
    return repo


@pytest.mark.parametrize("login_role", ["admin", "resident", None])
def test_claims_do_not_override_selected_demo_resident(login_role):
    client = TestClient(app)
    admin = headers("admin-001", "admin", role=login_role)
    trigger = client.post(
        "/emergency/trigger", headers=admin, json={"building_id": "bld-01"}
    )
    assert trigger.status_code == 200
    emergency = trigger.json()
    for resident_id, room in [("resident-h", "302"), ("resident-i", "301"),
                              ("resident-j", "303"), ("resident-k", "504")]:
        for safety in ("SAFE", "NEED_HELP", "NEED_HELP", "SAFE"):
            response = client.post(
                "/emergency/confirm-presence",
                headers=headers(resident_id, role=login_role),
                json={"emergency_id": emergency["emergency_id"], "safety_status": safety},
            )
            assert response.status_code == 200
            assert response.json()["resident_id"] == resident_id
            detail = client.get(f"/issues/{emergency['issue_id']}", headers=admin).json()
            assert detail["resident_states"][resident_id] == safety
            assert detail["room_states"][room] == safety
    assert detail["current_states_summary"] == {"SAFE": 4, "UNKNOWN": 46}


def test_demo_rejects_unknown_identity_role_and_cross_building():
    client = TestClient(app)
    for credentials in (
        headers("unregistered-resident"),
        headers("resident-h", "admin"),
        headers("resident-h", building_id="other-building"),
        headers("resident-h", firebase={"sign_in_provider": "anonymous"}),
    ):
        response = client.post(
            "/emergency/confirm-presence", headers=credentials,
            json={"emergency_id": "em-test", "safety_status": "SAFE"},
        )
        assert response.status_code in (401, 403)


def test_without_demo_headers_registered_identity_is_preserved():
    client = TestClient(app)
    response = client.get("/me", headers=headers())
    assert response.status_code == 200
    assert response.json()["uid"] == "google-login-uid"
    assert response.json()["resident_id"] == "resident-i"
    assert response.json()["role"] == "resident"


def test_admin_persona_cannot_create_a_resident_safety_state():
    client = TestClient(app)
    admin = headers("admin-001", "admin")
    trigger = client.post(
        "/emergency/trigger", headers=admin, json={"building_id": "bld-01"}
    ).json()
    response = client.post(
        "/emergency/confirm-presence", headers=admin,
        json={"emergency_id": trigger["emergency_id"], "safety_status": "SAFE"},
    )
    assert response.status_code == 403
    detail = client.get(f"/issues/{trigger['issue_id']}", headers=admin).json()
    assert detail["current_states_summary"] == {"UNKNOWN": 50}
