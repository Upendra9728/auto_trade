import pyotp

from app.token_refresh import sanitize_totp_secret


def test_sanitize_totp_secret_strips_common_noise():
    raw = " JBSWY3DPEHPK3PXP\n"
    assert sanitize_totp_secret(raw) == "JBSWY3DPEHPK3PXP"


def test_sanitize_totp_secret_handles_otpauth_uri():
    uri = "otpauth://totp/Dhan?secret=JBSWY3DPEHPK3PXP&issuer=Dhan"
    assert sanitize_totp_secret(uri) == "JBSWY3DPEHPK3PXP"


def test_sanitized_totp_is_accepted_by_pyotp():
    secret = sanitize_totp_secret("JBSWY3DPEHPK3PXP")
    code = pyotp.TOTP(secret).now()
    assert isinstance(code, str)
    assert len(code) == 6
