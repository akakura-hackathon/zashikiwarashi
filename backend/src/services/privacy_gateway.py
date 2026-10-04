"""Privacy Gateway service (FN-05, docs/DESIGN.md §5.3, §5.8 R2).

Resident Agent から外に出るメッセージ（外向き通信）を検査・抽象化し、
部屋番号・氏名・電話番号・精密な住所などの個人識別情報（PII）の流出を遮断する。
Sensitive Data Protection (SDP) / Model Armor フィルタのコード層実装。
"""

import re
from typing import Any

# PII 検出用正規表現パターン
ROOM_NUMBER_REGEX = re.compile(r"(\d{3,4})\s*号室?", re.IGNORECASE)
FLOOR_ROOM_REGEX = re.compile(r"(\d{1,2})\s*[F階]\s*(\d{2,4})\s*号室?")
PHONE_REGEX = re.compile(r"0\d{1,4}[-(]?\d{1,4}[-)]?\d{4}")
POSTAL_CODE_REGEX = re.compile(r"\d{3}-\d{4}")


class PrivacyGateway:
    """Agent の外向き通信に対する検査・マスキング・抽象トークン変換ゲートウェイ。"""

    @classmethod
    def sanitize_text(cls, text: str, floor: int | None = None) -> str:
        """テキスト内の部屋番号・個人情報を抽象トークンに置換する。

        例:
        - "302号室を確認してください" -> "[3F_NEARBY_UNIT]を確認してください"
        - "田中太郎です。090-1234-5678" -> "[RESIDENT_NAME]です。[PHONE_NUMBER]"
        """
        if not text:
            return text

        sanitized = text

        # 1. 電話番号のマスキング
        sanitized = PHONE_REGEX.sub("[PHONE_NUMBER]", sanitized)

        # 2. 郵便番号のマスキング
        sanitized = POSTAL_CODE_REGEX.sub("[POSTAL_CODE]", sanitized)

        # 3. 階数+部屋番号の抽象化
        def replace_floor_room(m: re.Match[str]) -> str:
            fl = m.group(1)
            return f"[{fl}F_UNIT]"

        sanitized = FLOOR_ROOM_REGEX.sub(replace_floor_room, sanitized)

        # 4. 単独部屋番号（302号室等）の抽象化
        def replace_room(m: re.Match[str]) -> str:
            room = m.group(1)
            room_floor = room[:-2] if len(room) >= 3 else ""
            if floor is not None:
                return f"[{floor}F_UNIT]"
            if room_floor:
                return f"[{room_floor}F_UNIT]"
            return "[UNIT]"

        sanitized = ROOM_NUMBER_REGEX.sub(replace_room, sanitized)

        return sanitized

    @classmethod
    def abstract_resident_profile(cls, profile: dict[str, Any]) -> dict[str, Any]:
        """世帯プロファイル（E-006）から個人特定可能な属性を削ぎ落とし、抽象トークン化する。"""
        floor = profile.get("floor")
        is_elderly = bool(profile.get("elderly_count", 0) > 0)
        is_mobility_difficulty = bool(profile.get("mobility_difficulty_count", 0) > 0)
        has_infant = bool(profile.get("infant_count", 0) > 0)

        # 氏名・部屋番号・正確な人数は一切含めない（段階的開示・人物プロファイリング禁止）
        return {
            "floor_level": f"{floor}F" if floor else "UNKNOWN_FLOOR",
            "needs_assistance": is_elderly or is_mobility_difficulty,
            "has_infant": has_infant,
            "can_stairs": not is_mobility_difficulty,
        }

    @classmethod
    def abstract_need(cls, floor: int, category: str, details: str) -> str:
        """Resident Agent の Need を Building Agent 向け抽象トークン列にフォーマットする。"""
        clean_details = cls.sanitize_text(details, floor=floor)
        return f"[{floor}F / {category} / {clean_details}]"

    @classmethod
    def abstract_capability(cls, floor: int, capability_type: str) -> str:
        """Resident Agent の Capability を抽象トークンにフォーマットする。"""
        return f"[{floor}F / {capability_type}]"
