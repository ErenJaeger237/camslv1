"""
password_reset.py — Forgot-password and reset-password endpoints.

POST /api/auth/forgot-password  body: {email}
     Generates a 1-hour token, emails a reset link from jordanebua2@gmail.com.
     Always returns {ok, message} — never reveals whether the email is registered.

POST /api/auth/reset-password   body: {token, new_password}
     Verifies the token, updates the password, invalidates all sessions.

Requires on Render:
  GMAIL_APP_PASSWORD  — Google App Password for jordanebua2@gmail.com
  FRONTEND_URL        — Your Vercel app URL, e.g. https://camslv1.vercel.app
"""

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db_users

router = APIRouter()

GMAIL_USER        = os.getenv("GMAIL_USER", "jordanebua2@gmail.com")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
FRONTEND_URL      = os.getenv("FRONTEND_URL", "http://localhost:5173")


def _send_reset_email(to_email: str, reset_link: str) -> None:
    if not GMAIL_APP_PASSWORD:
        raise RuntimeError("GMAIL_APP_PASSWORD is not configured on Render")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "CamSL Translator - Password Reset"
    msg["From"]    = f"CamSL Translator <{GMAIL_USER}>"
    msg["To"]      = to_email

    plain = (
        "Reset your CamSL Translator password\n\n"
        f"Click the link below to reset your password (valid for 1 hour):\n{reset_link}\n\n"
        "If you did not request a password reset, you can safely ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a1628">
<div style="font-family:sans-serif;max-width:480px;margin:40px auto;padding:32px;
            background:#0d1b2a;border-radius:16px;border:1px solid #1e3a5f">
  <h2 style="color:#2dd4bf;margin:0 0 4px;font-size:20px">CamSL Translator</h2>
  <p style="color:#64748b;margin:0 0 28px;font-size:13px">Cameroon Sign Language Bridge</p>
  <p style="color:#cbd5e1;margin:0 0 8px;font-size:15px">
    You requested a password reset. Click the button below — the link expires in <strong>1 hour</strong>.
  </p>
  <p style="color:#94a3b8;margin:0 0 24px;font-size:13px">
    If you did not request this, ignore the email — your password will not change.
  </p>
  <a href="{reset_link}"
     style="display:inline-block;padding:13px 32px;background:#14b8a6;color:#042f2e;
            font-weight:700;border-radius:10px;text-decoration:none;font-size:15px">
    Reset Password
  </a>
  <p style="margin:24px 0 0;font-size:11px;color:#475569;word-break:break-all">
    Or copy this link: {reset_link}
  </p>
</div>
</body></html>"""

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_USER, to_email, msg.as_string())


class ForgotRequest(BaseModel):
    email: str


class ResetRequest(BaseModel):
    token: str
    new_password: str


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotRequest):
    email = body.email.strip().lower()
    token = db_users.create_reset_token(email)
    if token:
        reset_link = f"{FRONTEND_URL}?reset_token={token}"
        try:
            _send_reset_email(email, reset_link)
        except Exception as exc:
            # Log the error server-side but never expose it to the client
            logging.error("Reset email failed for %s: %s", email, exc)
    # Always return the same response — prevents email enumeration
    return {
        "ok": True,
        "message": "If that email is registered, a reset link has been sent. Check your inbox.",
    }


@router.post("/auth/reset-password")
def reset_password(body: ResetRequest):
    try:
        db_users.consume_reset_token(body.token.strip(), body.new_password)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
