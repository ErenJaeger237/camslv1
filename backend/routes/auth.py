from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from .. import db_users

router = APIRouter()


class Credentials(BaseModel):
    username: str
    password: str


@router.post("/auth/register")
def register(body: Credentials):
    try:
        result = db_users.register(body.username.strip(), body.password)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/auth/login")
def login(body: Credentials):
    try:
        result = db_users.login(body.username.strip(), body.password)
        return result
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.get("/auth/me")
def me(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    user = db_users.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    return user
