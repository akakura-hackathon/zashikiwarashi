"""Push notification router (FCM HTTP v1 / Web Push / APNs test)."""

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException
from firebase_admin import messaging
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["push"])


class PushTestRequest(BaseModel):
    token: str = Field(..., description="FCM device registration token")
    delay_seconds: int = Field(5, ge=0, le=60, description="Delay before sending notification")
    title: str = Field("⚡ 停電が発生しました", description="Notification title")
    body: str = Field(
        "少し手を貸せますか？ 4分ほど階段でお水を運ぶお願いです。",
        description="Notification body",
    )


def _send_fcm_notification(token: str, title: str, body: str) -> None:
    try:
        message = messaging.Message(
            token=token,
            notification=messaging.Notification(
                title=title,
                body=body,
            ),
            # Web Push (Chrome / PWA) configuration
            webpush=messaging.WebpushConfig(
                headers={"Urgency": "high"},
                notification=messaging.WebpushNotification(
                    title=title,
                    body=body,
                    icon="/icons/icon-192.png",
                    require_interaction=True,
                    tag="zashiki-emergency",
                ),
            ),
            # Apple Push Notification service (APNs for iPhone sleep screen) configuration
            apns=messaging.APNSConfig(
                headers={
                    "apns-priority": "10",
                    "apns-push-type": "alert",
                },
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(
                        alert=messaging.ApsAlert(
                            title=title,
                            body=body,
                        ),
                        sound="default",
                        interruption_level="time-sensitive",
                    )
                ),
            ),
        )
        response = messaging.send(message)
        logger.info(f"[FCM] Notification sent successfully: {response}")
    except Exception as e:
        logger.error(f"[FCM] Failed to send push notification: {e}")


async def _delayed_send(delay_seconds: int, token: str, title: str, body: str) -> None:
    if delay_seconds > 0:
        await asyncio.sleep(delay_seconds)
    _send_fcm_notification(token, title, body)


@router.post("/test-sleep")
async def test_sleep_notification(req: PushTestRequest, background_tasks: BackgroundTasks):
    """5秒後にスリープ画面へプッシュ通知を送信するテストエンドポイント。

    iPhone の電源ボタンを押して画面をロックした状態で待機すると、ポップアップ通知が表示されます。
    """
    if not req.token:
        raise HTTPException(status_code=400, detail="FCM token is required")

    background_tasks.add_task(_delayed_send, req.delay_seconds, req.token, req.title, req.body)
    msg = (
        f"{req.delay_seconds}秒後にプッシュ通知を送信します。"
        "スマホをスリープ状態にしてお待ちください。"
    )
    return {
        "status": "scheduled",
        "delay_seconds": req.delay_seconds,
        "message": msg,
    }

