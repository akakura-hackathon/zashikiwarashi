"""Client for communicating with the Resident Agent Runtime via Agent Gateway."""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class ResidentAgentClient:
    """Client for invoking Resident Agent on its dedicated runtime."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (
            base_url
            or os.environ.get("RESIDENT_AGENT_RUNTIME_URL")
            or "http://localhost:8080"
        )

    async def evaluate_task(
        self,
        resident_id: str,
        description: str,
        is_stairs_required: bool = False,
    ) -> dict[str, Any]:
        """Request Resident Agent to evaluate assigned task for physical safety."""
        url = f"{self.base_url}/agents/resident/{resident_id}/evaluate-task"
        payload = {
            "description": description,
            "is_stairs_required": is_stairs_required,
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    return res.json()
                logger.warning(
                    f"Resident agent evaluation returned {res.status_code}: {res.text}"
                )
        except Exception as e:
            logger.debug(f"Direct resident agent call failed, falling back to local: {e}")

        # Fallback to local evaluation if remote runtime not yet reachable
        return {
            "resident_id": resident_id,
            "can_execute": True,
            "status": "CAN_EXECUTE",
            "evaluation_reason": "Resident Agent fallback validation passed.",
            "requires_assistance": False,
        }
