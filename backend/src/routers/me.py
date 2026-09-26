from typing import Annotated

from fastapi import APIRouter, Depends

from src.models.auth import CurrentUser
from src.services.auth import get_current_user

router = APIRouter()


@router.get("/me")
def get_me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> CurrentUser:
    """API-09（FN-02）: ログインユーザーのロールとクレーム。"""
    return user
