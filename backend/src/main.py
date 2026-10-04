from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import get_settings
from src.routers import audit, chat, emergency, governance, health, me, push, tasks


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="zashikiwarashi backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_origin_regex=r"https://.*\.web\.app|https://.*\.firebaseapp\.com|http://localhost:\d+",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(me.router)
    app.include_router(push.router)
    app.include_router(emergency.router)
    app.include_router(tasks.router)
    app.include_router(audit.router)
    app.include_router(governance.router)
    app.include_router(chat.router, prefix="/api")

    return app


app = create_app()
