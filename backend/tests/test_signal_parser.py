from app.signal_parser import parse_signal_message


def test_trading_floor_message_uses_first_target_and_average_price():
    text = """Trading Floor :-

SENSEX

📈📉 76800CE

📊 PRICE @ 165-170

STOPLOSS 160

🎯 TARGET 200/240/350

10th September EXPIRY"""

    parsed = parse_signal_message(text)

    assert parsed is not None
    assert parsed.symbol == "SENSEX"
    assert parsed.strike == 76800.0
    assert parsed.option_type == "CE"
    assert parsed.price == 167.5
    assert parsed.stop_loss_price == 160.0
    assert parsed.target_price == 200.0
    assert parsed.expiry == "2026-09-10"  # current year, since no explicit year is provided


def test_trading_floor_message_single_target_and_price_still_parses():
    text = """Trading Floor :-

SENSEX

📈📉 76800CE

📊 PRICE @ 165

STOPLOSS 160

🎯 TARGET 200

10th September EXPIRY"""

    parsed = parse_signal_message(text)

    assert parsed is not None
    assert parsed.price == 165.0
    assert parsed.stop_loss_price == 160.0
    assert parsed.target_price == 200.0
    assert parsed.expiry == "2026-09-10"
