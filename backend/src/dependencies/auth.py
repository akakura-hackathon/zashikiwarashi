"""Authentication and authorization dependencies for FastAPI endpoints.

Follows docs/ARCHITECTURE.md §3.1:
- Production:
  - Validates `X-Apigateway-Api-Userinfo` header injected by Google Cloud API Gateway.
  - Rejects unauthenticated / anonymous sessions.
  - FN-02 Studio demo headers select one of five fixed identities in bld-01.
- Local / Test:
  - Allows header-based mocking (`X-User-Id`, `X-User-Role`, `X-Apigateway-Api-Userinfo`)
    or falls back to default persona for rapid developer testing.
"""

import base64
import json

from fastapi import Header, HTTPException, status

from src.config import get_settings
from src.models.auth import CurrentUser, Role

# FN-02: Studio demo identities are fixed; Firebase uid remains the login actor.
DEMO_IDENTITIES: dict[str, tuple[Role, str | None]] = {
    "admin-001": ("admin", None),
    "resident-i": ("resident", "unit-301"),
    "resident-h": ("resident", "unit-302"),
    "resident-j": ("resident", "unit-303"),
    "resident-k": ("resident", "unit-504"),
}


def _decode_gateway_userinfo(userinfo_header: str) -> dict:
    """Decode base64url-encoded userinfo payload from API Gateway."""
    try:
        # Standard base64url padding restoration
        padded = userinfo_header + "=" * (-len(userinfo_header) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        payload = json.loads(decoded)
        if not isinstance(payload, dict):
            raise ValueError("userinfo must be an object")
        return payload
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid API Gateway userinfo header: {e}",
        ) from e


async def get_current_user(
    x_apigateway_api_userinfo: str | None = Header(None, alias="X-Apigateway-Api-Userinfo"),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_building_id: str | None = Header(None, alias="X-Building-Id"),
) -> CurrentUser:
    """Resolve current user with environment-aware security guardrails."""
    settings = get_settings()

    # 1. API Gateway Userinfo Header (Production primary source)
    if x_apigateway_api_userinfo:
        claims = _decode_gateway_userinfo(x_apigateway_api_userinfo)
        # FN-02: Demo persona switching requires an authenticated human session.
        if claims.get("firebase", {}).get("sign_in_provider") == "anonymous":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Google login required")
        uid = claims.get("user_id") or claims.get("sub") or claims.get("uid")
        if not uid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: Userinfo missing uid.",
            )

        # FN-02: Resolve the selected demo identity as a whole, including custom-claim users.
        if x_user_id:
            identity = DEMO_IDENTITIES.get(x_user_id)
            if not identity or x_user_role != identity[0]:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid demo persona")
            if claims.get("building_id") not in (None, "bld-01") or x_building_id not in (
                None, "bld-01"
            ):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Demo building mismatch")
            return CurrentUser(
                uid=uid,
                email=claims.get("email"),
                role=identity[0],
                building_id="bld-01",
                resident_id=x_user_id if identity[0] == "resident" else None,
                unit_id=identity[1],
            )

        # Custom claims or demo persona fallback
        role_claim = claims.get("role")
        role: Role = role_claim or ("admin" if x_user_role == "admin" else "resident")
        resident_id = claims.get("resident_id") or x_user_id or uid
        building_id = claims.get("building_id") or x_building_id or "bld-01"
        unit_id = claims.get("unit_id") or (
            f"unit-{resident_id[-3:]}" if resident_id.startswith("resident-") else None
        )

        return CurrentUser(
            uid=uid,
            email=claims.get("email"),
            role=role,
            building_id=building_id,
            resident_id=resident_id,
            unit_id=unit_id,
        )

    # 2. Production Security Enforcement: Must not bypass API Gateway unless auth_mode is mock
    if settings.is_production and settings.auth_mode == "production":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Direct access without API Gateway is forbidden.",
        )

    # 3. Local / Test Mode Fallbacks
    if x_user_id:
        role_val: Role = "admin" if x_user_role == "admin" else "resident"
        return CurrentUser(
            uid=x_user_id,
            role=role_val,
            building_id=x_building_id or "bld-01",
            resident_id=x_user_id,
            unit_id=f"unit-{x_user_id[-3:]}" if x_user_id.startswith("resident-") else None,
        )

    # Default Local Persona (Resident I by default for ease of local testing)
    return CurrentUser(
        uid="resident-i",
        role="resident",
        building_id="bld-01",
        resident_id="resident-i",
        unit_id="unit-301",
    )


async def require_admin(
    x_apigateway_api_userinfo: str | None = Header(None, alias="X-Apigateway-Api-Userinfo"),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    x_user_role: str | None = Header(None, alias="X-User-Role"),
    x_building_id: str | None = Header(None, alias="X-Building-Id"),
) -> CurrentUser:
    """Enforce admin-only access (API-01, API-08)."""
    user = await get_current_user(
        x_apigateway_api_userinfo=x_apigateway_api_userinfo,
        x_user_id=x_user_id,
        x_user_role=x_user_role or "admin",  # Default local admin request to admin
        x_building_id=x_building_id,
    )
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Admin role required for this endpoint.",
        )
    return user
