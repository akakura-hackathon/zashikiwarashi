from src.agents.agent import root_agent


def test_root_agent_is_configured():
    assert root_agent.name == "root_agent"
    assert root_agent.model == "gemini-2.0-flash"
