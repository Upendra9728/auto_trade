from app.routers.admin import _is_entry_leg_modifiable, _sanitize_modify_payload
from app.schemas import SignalOrderModifyRequest


def test_sanitize_modify_payload_removes_blank_values():
    payload = SignalOrderModifyRequest(
        price=None,
        target_price=150.0,
        stop_loss_price=None,
        trailing_jump=10.0,
    )

    assert _sanitize_modify_payload(payload) == {
        "target_price": 150.0,
        "trailing_jump": 10.0,
    }


def test_entry_leg_is_not_open_once_market_reports_traded():
    assert _is_entry_leg_modifiable("TRADED") is False
    assert _is_entry_leg_modifiable("PENDING") is True
    assert _is_entry_leg_modifiable(None) is True
