"""FN-02: ログインユーザーの取り出しとロールの確認。

画面 → API Gateway（Firebase の ID トークンを検証）→ api（非公開の Cloud Run）の構成で、
Gateway は検証済みトークンのペイロードを `X-Apigateway-Api-Userinfo`（base64url の JSON）で渡す。
api は Gateway と deployer からしか呼べないため、このヘッダーを信用できる
（docs/ARCHITECTURE.md §3.1）。
トークンの署名はここでは検証しない。
"""

import base64
import binascii
import json
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from pydantic import ValidationError

from src.models.auth import CurrentUser

USERINFO_HEADER = "X-Apigateway-Api-Userinfo"


def _decode_userinfo(value: str) -> dict:
    padded = value + "=" * (-len(value) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid user info") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid user info")
    return payload


def get_current_user(
    userinfo: Annotated[str | None, Header(alias=USERINFO_HEADER)] = None,
) -> CurrentUser:
    """ロール（カスタムクレーム）が付いた登録済みユーザーだけを通す。"""
    if not userinfo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    payload = _decode_userinfo(userinfo)
    uid = payload.get("user_id") or payload.get("sub")
    if not uid or payload.get("role") is None:
        # Google ログインはできても、ロールが付いていない（登録されていない）ユーザーは使えない
        raise HTTPException(status.HTTP_403_FORBIDDEN, "user is not registered")
    try:
        return CurrentUser(
            uid=uid,
            email=payload.get("email"),
            role=payload["role"],
            building_id=payload.get("building_id"),
            resident_id=payload.get("resident_id"),
            unit_id=payload.get("unit_id"),
        )
    except ValidationError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "invalid role") from exc


def require_admin(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    """管理人用の API（API-01・API-08）で使う。"""
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")
    return user
