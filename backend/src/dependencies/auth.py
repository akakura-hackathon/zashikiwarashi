"""Authentication and authorization dependencies for FastAPI endpoints.

Follows docs/ARCHITECTURE.md §3.1:
- Production:
  - Validates `X-Apigateway-Api-Userinfo` header injected by Google Cloud API Gateway.
  - Rejects unauthenticated or role-less requests (401 / 403).
- Local / Test:
  - Allows header-based mocking (`X-User-Id`, `X-User-Role`, `X-Apigateway-Api-Userinfo`)
    or falls back to default persona for rapid developer testing.
"""

import base64
import json

from fastapi import Header, HTTPException, status

from src.config import get_settings
from src.models.auth import CurrentUser, Role


def _decode_gateway_userinfo(userinfo_header: str) -> dict:
    """Decode base64url-encoded userinfo payload from API Gateway."""
    try:
        # Standard base64url padding restoration
        padded = userinfo_header + "=" * (-len(userinfo_header) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        return json.loads(decoded)
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
        uid = claims.get("user_id") or claims.get("sub") or claims.get("uid")
        role: Role | None = claims.get("role")

        if not uid or not role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: Userinfo missing uid or role custom claim.",
            )

        return CurrentUser(
            uid=uid,
            email=claims.get("email"),
            role=role,
            building_id=claims.get("building_id", "bld-01"),
            resident_id=claims.get("resident_id", uid),
            unit_id=claims.get("unit_id"),
        )

    # 2. Production Security Enforcement: Must not bypass API Gateway
    if settings.is_production:
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
