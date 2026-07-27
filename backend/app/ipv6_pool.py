from __future__ import annotations

import logging
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def assign_next_ipv6(db: Session) -> str | None:
    """
    Allocate the next free IPv6 address from the configured pool prefix.

    Strategy:
    - All assigned addresses in the DB that start with the pool prefix are
      collected and their host suffixes are parsed as integers.
    - The next address is max(existing_suffixes) + 1, or pool_start if none.
    - Returns None when no pool is configured (admin assigns manually).

    This is safe for sequential registration but is not race-condition-proof
    under heavy concurrent load.  For that, wrap the registration transaction
    in a SELECT FOR UPDATE on the users table or use a DB sequence.
    """
    from .config import settings
    from .models import User

    prefix = (settings.ipv6_pool_prefix or "").strip()
    if not prefix:
        return None

    # Normalise: the prefix should end with '::' (e.g. '2406:da1a:c1e:f000:a79e::')
    # Addresses are generated as prefix + hex_number (e.g. '2406:da1a:c1e:f000:a79e::1')

    # Fetch all currently-assigned addresses that belong to this pool
    rows = (
        db.query(User.assigned_ipv6)
        .filter(User.assigned_ipv6.like(f"{prefix}%"))
        .all()
    )

    max_suffix = settings.ipv6_pool_start - 1  # will become start if no rows

    for (addr,) in rows:
        if not addr:
            continue
        # suffix is everything after the prefix (e.g. '1', 'a', 'ff')
        suffix_str = addr[len(prefix):]
        # Treat suffix as hex (standard IPv6 notation)
        try:
            suffix = int(suffix_str, 16)
            if suffix > max_suffix:
                max_suffix = suffix
        except ValueError:
            continue

    next_suffix = max_suffix + 1
    # Format as lowercase hex without leading zeros
    next_addr = f"{prefix}{next_suffix:x}"

    logger.info("IPv6 pool: assigning %s (suffix 0x%x)", next_addr, next_suffix)
    return next_addr
