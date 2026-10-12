"""Chat turn orchestration with Google ADK Agent and Model Armor."""

import logging

from src.agents.adk_agents import ADKAgentRunner, create_building_coordinator_agent
from src.agents.governance import AgentGovernanceEngine, AgentGovernanceError
from src.db.factory import get_repository

logger = logging.getLogger(__name__)

# Runner cache per session
_runners: dict[str, ADKAgentRunner] = {}


async def run_turn(session_id: str, message: str) -> str:
    """Wire a user message to the ADK Building Coordinator Agent and return its reply."""
    # 1. Model Armor による入力検査
    try:
        from src.agents.governance import AgentIdentity
        AgentGovernanceEngine.validate_ingress(
            caller_identity="admin",
            target_agent=AgentIdentity.BUILDING_AGENT,
            input_prompt=message,
        )
    except AgentGovernanceError as e:
        logger.warning(f"Model Armor blocked message: {e.message}")
        return (
            "【Model Armor 警告】セキュリティポリシーに違反する入力を検知したため"
            f"ブロックしました: {e.message}"
        )

    # 2. ADK Agent Runner の初期化（セッション再利用）
    if session_id not in _runners:
        repo = get_repository()
        agent = create_building_coordinator_agent(repo, building_id="bld-01")
        _runners[session_id] = ADKAgentRunner(agent)

    runner = _runners[session_id]

    # 3. エージェントの実行
    try:
        result = await runner.execute_prompt(
            prompt=message,
            user_id="resident-user",
            session_id=session_id,
        )
        reply = result.get("reply", "")
        if not reply and result.get("tool_calls"):
            reply = "【Building Coordinator Agent】ツールを実行し、協調計画を調整しました。"
        return reply or "【Building Coordinator Agent】了解しました。状況を監視しています。"
    except Exception as e:
        logger.error(f"Chat execution error: {e}", exc_info=True)
        return f"エージェント処理中にエラーが発生しました: {str(e)}"
