import base64
import json

import pytest

from src.services.auth import USERINFO_HEADER


def _userinfo(payload: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    return raw.rstrip("=")


@pytest.mark.asyncio
async def test_me_returns_claims(client):
    header = _userinfo(
        {"user_id": "uid-1", "email": "i@example.com", "role": "resident", "resident_id": "R-I"}
    )
    response = await client.get("/me", headers={USERINFO_HEADER: header})
    assert response.status_code == 200
    body = response.json()
    assert body["uid"] == "uid-1"
    assert body["role"] == "resident"
    assert body["resident_id"] == "R-I"


@pytest.mark.asyncio
async def test_me_requires_userinfo(client):
    response = await client.get("/me")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_rejects_user_without_role(client):
    header = _userinfo({"user_id": "uid-2", "email": "stranger@example.com"})
    response = await client.get("/me", headers={USERINFO_HEADER: header})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_me_rejects_unknown_role(client):
    header = _userinfo({"user_id": "uid-3", "role": "superuser"})
    response = await client.get("/me", headers={USERINFO_HEADER: header})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_me_rejects_broken_userinfo(client):
    response = await client.get("/me", headers={USERINFO_HEADER: "%%%not-base64%%%"})
    assert response.status_code == 401
