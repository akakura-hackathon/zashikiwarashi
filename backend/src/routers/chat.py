from fastapi import APIRouter

from src.models.schemas import ChatRequest, ChatResponse
from src.services.chat_service import run_turn

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    reply = await run_turn(session_id=request.session_id, message=request.message)
    return ChatResponse(reply=reply)
