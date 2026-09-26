"""FN-02: ユーザーにカスタムクレーム（ロール）を付ける。

API はロールが付いた登録済みユーザーしか受け付けない（src/services/auth.py）。
先に本人が画面から Google ログインを 1 回行い、Firebase Authentication にユーザーを作っておくこと。

使い方（オーナー権限の gcloud 認証情報で実行する）:
    export GOOGLE_CLOUD_QUOTA_PROJECT=zashikiwarashi
    uv run python scripts/set_claims.py --email admin@example.com --role admin --building-id B-001
    uv run python scripts/set_claims.py --email i@example.com --role resident \
        --building-id B-001 --unit-id U-301
    uv run python scripts/set_claims.py --email i@example.com --clear   # ロールを外す

クレームは次にトークンが更新されたとき（最長 1 時間、または再ログイン）に反映される。
部屋番号はクレームに載せない（docs/ARCHITECTURE.md §3.1）。
resident_id は Firebase Auth の uid（docs/DESIGN.md §7.3.1）。省略すると uid を使う。
"""

import argparse

import firebase_admin
from firebase_admin import auth

ROLES = ("admin", "resident")


def main() -> None:
    parser = argparse.ArgumentParser(description="Firebase ユーザーにロールを付ける")
    parser.add_argument("--project", default="zashikiwarashi")
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", choices=ROLES)
    parser.add_argument("--building-id")
    parser.add_argument("--resident-id")
    parser.add_argument("--unit-id")
    parser.add_argument("--clear", action="store_true", help="クレームをすべて外す")
    args = parser.parse_args()

    if not args.clear and not args.role:
        parser.error("--role か --clear のどちらかを指定する")
    if args.role and not args.building_id:
        parser.error("--building-id が必要")
    if args.role == "resident" and not args.unit_id:
        parser.error("住民には --unit-id が必要")

    firebase_admin.initialize_app(options={"projectId": args.project})
    user = auth.get_user_by_email(args.email)

    if args.clear:
        claims = None
    else:
        claims = {
            key: value
            for key, value in {
                "role": args.role,
                "building_id": args.building_id,
                "resident_id": (args.resident_id or user.uid) if args.role == "resident" else None,
                "unit_id": args.unit_id,
            }.items()
            if value
        }
    auth.set_custom_user_claims(user.uid, claims)
    print(f"{args.email} (uid={user.uid}) のクレームを設定しました: {claims}")


if __name__ == "__main__":
    main()
