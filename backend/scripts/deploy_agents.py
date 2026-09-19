"""Deploy the root ADK agent to Vertex AI Agent Engine.

Usage: uv run python scripts/deploy_agents.py

Requires GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION env vars and
application-default credentials (or Workload Identity Federation in CI).
"""

# TODO: implement with `vertexai.agent_engines.create(agent_engine=root_agent, ...)`.


def main() -> None:
    raise NotImplementedError


if __name__ == "__main__":
    main()
