from __future__ import annotations

from cryptography.fernet import Fernet

from .config import settings


def _fernet() -> Fernet:
    return Fernet(settings.token_encryption_key.encode("utf-8"))


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode("utf-8")).decode("utf-8")


def decrypt_token(token_encrypted: str) -> str:
    return _fernet().decrypt(token_encrypted.encode("utf-8")).decode("utf-8")
