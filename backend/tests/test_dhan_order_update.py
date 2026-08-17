from app.dhan_order_update import LEG_NO_TO_NAME, _coerce_leg_no, _extract_super_order_item


def test_leg_no_to_name_mapping():
    assert LEG_NO_TO_NAME.get(_coerce_leg_no(1)) == "ENTRY_LEG"
    assert LEG_NO_TO_NAME.get(_coerce_leg_no(2)) == "STOP_LOSS_LEG"
    assert LEG_NO_TO_NAME.get(_coerce_leg_no(3)) == "TARGET_LEG"
    assert LEG_NO_TO_NAME.get(_coerce_leg_no("1")) == "ENTRY_LEG"
    assert LEG_NO_TO_NAME.get(_coerce_leg_no("2")) == "STOP_LOSS_LEG"
    assert LEG_NO_TO_NAME.get(_coerce_leg_no("3")) == "TARGET_LEG"
    assert _coerce_leg_no(None) is None
    assert _coerce_leg_no("invalid") is None


def test_extract_super_order_item():
    orders = [
        {"orderId": "111", "orderStatus": "PENDING"},
        {"orderId": "222", "orderStatus": "CLOSED", "legDetails": [{"legName": "TARGET_LEG", "orderStatus": "TRADED"}]},
    ]
    item = _extract_super_order_item(orders, "222")
    assert item is not None
    assert item["orderId"] == "222"
    assert item["orderStatus"] == "CLOSED"

    missing = _extract_super_order_item(orders, "999")
    assert missing is None
