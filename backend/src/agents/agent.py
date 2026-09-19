"""Root ADK agent for this project.

Add multi-agent orchestration by creating modules under `sub_agents/`
and wiring them into `sub_agents=[...]` below (see ADK docs on
multi-agent systems). Keep this file's `root_agent` as the single
entry point the FastAPI layer and `scripts/deploy_agents.py` import.
"""

from google.adk.agents import Agent

root_agent = Agent(
    name="root_agent",
    model="gemini-2.0-flash",
    description="Template root agent — replace with your project's agent.",
    instruction=(
        "You are a helpful assistant for this hackathon project. "
        "Replace this instruction with project-specific behavior."
    ),
    tools=[],
    # sub_agents=[],  # マルチエージェント構成にする場合はここに追加
)
