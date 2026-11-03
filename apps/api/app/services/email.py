import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import get_settings

logger = logging.getLogger("aether.email")


def send_email(to_email: str, subject: str, text_content: str, html_content: str | None = None) -> bool:
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_user:
        logger.info("[MOCK EMAIL] To: %s | Subject: %s\n%s", to_email, subject, text_content)
        return True

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to_email

    msg.attach(MIMEText(text_content, "plain"))
    if html_content:
        msg.attach(MIMEText(html_content, "html"))

    try:
        if settings.smtp_ssl:
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10)
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
            if settings.smtp_tls:
                server.starttls()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password.replace(" ", ""))
        server.sendmail(settings.smtp_from, [to_email], msg.as_string())
        server.quit()
        logger.info("Email sent to %s with subject: %s", to_email, subject)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False


def send_verification_email(to_email: str, code: str) -> bool:
    settings = get_settings()
    ttl = settings.verification_code_ttl_minutes
    subject = f"Your Aether Analytics Verification Code: {code}"
    text_content = (
        f"Welcome to Aether Analytics!\n\n"
        f"Your verification code is: {code}\n\n"
        f"This code will expire in {ttl} minutes.\n"
        f"If you did not request this, please ignore this email."
    )
    html_content = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verification Code</title>
</head>
<body style="font-family: sans-serif; background-color: #f8fafc; margin: 0; padding: 24px;">
  <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #0f172a; margin: 0;">Aether Analytics</h1>
      <p style="font-size: 14px; color: #64748b; margin-top: 6px;">Email Verification</p>
    </div>
    <p style="font-size: 15px; color: #334155; line-height: 1.5; margin: 0 0 16px 0;">
      Hello,
    </p>
    <p style="font-size: 15px; color: #334155; line-height: 1.5; margin: 0 0 24px 0;">
      Thank you for signing up. Please enter the following 6-digit verification code to complete your registration:
    </p>
    <div style="background: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <span style="font-family: monospace; font-size: 30px; font-weight: 700; letter-spacing: 6px; color: #0284c7;">
        {code}
      </span>
    </div>
    <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0;">
      This code is valid for {ttl} minutes. If you did not create an account, you can safely ignore this email.
    </p>
  </div>
</body>
</html>
"""
    return send_email(to_email, subject, text_content, html_content)
