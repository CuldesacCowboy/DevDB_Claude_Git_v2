# main.py
# FastAPI application entry point.
#
# Run:
#   cd devdb_python
#   uvicorn api.main:app --reload

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import developments, lots

app = FastAPI(title="DevDB API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lots.router)
app.include_router(developments.router)
