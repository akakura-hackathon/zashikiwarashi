"""Chat turn orchestration.

Wires a user message to the ADK `root_agent` and returns its reply.
TODO: implement with `google.adk.runners.InMemoryRunner` (see docs/ARCHITECTURE.md).
"""


async def run_turn(session_id: str, message: str) -> str:
    raise NotImplementedError
