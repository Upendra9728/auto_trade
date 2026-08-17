from app.routers.auth import _to_profile
from app.models import User


def test_profile_includes_email_verified_flag():
    user = User(
        id=1,
        name='Test User',
        email='test@example.com',
        phone_number='+919999999999',
        password_hash='hash',
        role='user',
        assigned_ipv6='2406:da1a::1',
        is_active=True,
        email_verified=True,
    )

    profile = _to_profile(user)

    assert profile.email_verified is True
