from __future__ import annotations

import datetime as dt
import os

os.environ.setdefault('DATABASE_URL', 'sqlite:///./test_export_ordering.db')

from app.db import Base, SessionLocal, engine
from app.models import Signal, SignalNotification, User
from app.routers.admin import _export_order_query


def test_export_order_query_orders_newest_first():
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        session.query(SignalNotification).delete()
        session.query(Signal).delete()
        session.query(User).delete()

        user_a = User(
            name='Alpha',
            email='alpha@example.com',
            phone_number='99999',
            password_hash='x',
            created_at=dt.datetime.utcnow(),
            updated_at=dt.datetime.utcnow(),
        )
        user_b = User(
            name='Beta',
            email='beta@example.com',
            phone_number='88888',
            password_hash='y',
            created_at=dt.datetime.utcnow(),
            updated_at=dt.datetime.utcnow(),
        )
        session.add_all([user_a, user_b])
        session.flush()

        signal = Signal(
            created_by_id=user_a.id,
            title='Signal A',
            exchange_segment='NSE_FNO',
            security_id='123',
            transaction_type='BUY',
            product_type='INTRADAY',
            order_type='LIMIT',
            quantity=10,
            lot_size=10,
            price=100.0,
            target_price=110.0,
            stop_loss_price=95.0,
            trailing_jump=0.0,
            status='active',
            created_at=dt.datetime.utcnow(),
            expires_at=None,
        )
        session.add(signal)
        session.flush()

        older = SignalNotification(
            signal_id=signal.id,
            user_id=user_a.id,
            status='placed',
            created_at=dt.datetime.utcnow() - dt.timedelta(days=2),
            confirmed_at=None,
            placed_at=None,
        )
        newer = SignalNotification(
            signal_id=signal.id,
            user_id=user_b.id,
            status='placed',
            created_at=dt.datetime.utcnow(),
            confirmed_at=None,
            placed_at=None,
        )
        session.add_all([older, newer])
        session.commit()

        rows = _export_order_query(session, date_from=None, date_to=None).all()
        assert [row.id for row in rows] == [newer.id, older.id]
    finally:
        session.query(SignalNotification).delete()
        session.query(Signal).delete()
        session.query(User).delete()
        session.close()
