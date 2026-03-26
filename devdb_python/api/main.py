# main.py
# FastAPI application entry point.
#
# Run:
#   cd devdb_python
#   uvicorn api.main:app --reload

from fastapi import FastAPI

from api.routers import lots

app = FastAPI(title="DevDB API", version="0.1.0")

app.include_router(lots.router)
