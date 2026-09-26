from typing import Literal

from pydantic import BaseModel

Role = Literal["admin", "resident"]


class CurrentUser(BaseModel):
    """FN-02: API Gateway が検証した Firebase の ID トークンから取り出したログインユーザー。

    カスタムクレーム（role・building_id・resident_id・unit_id）は set_claims スクリプトで付ける
    （docs/ARCHITECTURE.md §3.1）。部屋番号はクレームに載せない。
    """

    uid: str
    email: str | None = None
    role: Role
    building_id: str | None = None
    resident_id: str | None = None
    unit_id: str | None = None
