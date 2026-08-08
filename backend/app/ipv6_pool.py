from __future__ import annotations

import logging
import socket
import subprocess
from pathlib import Path

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Path to the persistent systemd-networkd drop-in that lists per-user IPv6 addresses.
_NETWORKD_DROP_IN = Path(
    "/etc/systemd/network/70-ens5.network.d/90-client-static-ips.conf"
)


def _is_bindable(ipv6: str) -> bool:
    """Return True if the OS can bind a socket to this IPv6 address right now."""
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        s.bind((ipv6, 0))
        s.close()
        return True
    except OSError:
        return False


def _provision_ipv6(ipv6: str, interface: str) -> bool:
    """
    Add the IPv6 /128 address to the OS network interface so it can be
    used immediately for outbound connections.

    Also appends it to the persistent systemd-networkd drop-in so it
    survives reboots.

    Returns True on success, False if the process lacks privileges.
    """
    # ── 1. Add live to the interface ──────────────────────────────────────────
    # Use full path — systemd services don't have /usr/sbin in PATH.
    IP_BIN = "/usr/sbin/ip"
    try:
        result = subprocess.run(
            [IP_BIN, "addr", "add", f"{ipv6}/128", "dev", interface],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            # "RTNETLINK answers: File exists" is fine — already present
            if "exists" not in result.stderr.lower():
                # Try with sudo as fallback
                result2 = subprocess.run(
                    ["sudo", IP_BIN, "addr", "add", f"{ipv6}/128", "dev", interface],
                    capture_output=True, text=True, timeout=10,
                )
                if result2.returncode != 0 and "exists" not in result2.stderr.lower():
                    logger.error(
                        "Failed to add IPv6 %s to %s: %s | sudo: %s",
                        ipv6, interface, result.stderr.strip(), result2.stderr.strip(),
                    )
                    return False
    except Exception as exc:
        logger.error("Exception while adding IPv6 %s to interface: %s", ipv6, exc)
        return False

    logger.info("IPv6 %s added live to interface %s", ipv6, interface)

    # ── 2. Append to persistent networkd drop-in ───────────────────────────────
    try:
        # Derive the correct drop-in path from the actual interface name
        drop_in = Path(
            f"/etc/systemd/network/70-{interface}.network.d/90-client-static-ips.conf"
        )
        drop_in.parent.mkdir(parents=True, exist_ok=True)

        # Only append if not already present
        existing = drop_in.read_text() if drop_in.exists() else ""
        if ipv6 not in existing:
            with drop_in.open("a") as f:
                f.write(f"\n[Address]\nAddress={ipv6}/128\n")
            logger.info("IPv6 %s appended to %s", ipv6, drop_in)
    except PermissionError:
        # Not fatal — the live add already succeeded; admin can persist manually
        logger.warning(
            "Could not write to %s (permission denied). "
            "Add [Address] Address=%s/128 manually so it survives reboot.",
            drop_in, ipv6,
        )
    except Exception as exc:
        logger.warning("Could not update networkd config for %s: %s", ipv6, exc)

    return True


def assign_next_ipv6(db: Session) -> str | None:
    """
    Allocate the next free IPv6 address from the configured pool prefix,
    verify it is usable on the OS network interface, and provision it if not.

    Returns the assigned address, or None if no pool is configured.
    """
    from .config import settings
    from .models import User

    prefix = (settings.ipv6_pool_prefix or "").strip()
    if not prefix:
        return None

    # ── Determine next sequential address ─────────────────────────────────────
    rows = (
        db.query(User.assigned_ipv6)
        .filter(User.assigned_ipv6.like(f"{prefix}%"))
        .all()
    )

    max_suffix = settings.ipv6_pool_start - 1

    for (addr,) in rows:
        if not addr:
            continue
        suffix_str = addr[len(prefix):]
        try:
            suffix = int(suffix_str, 16)
            if suffix > max_suffix:
                max_suffix = suffix
        except ValueError:
            continue

    next_suffix = max_suffix + 1
    next_addr = f"{prefix}{next_suffix:x}"
    logger.info("IPv6 pool: candidate address %s (suffix 0x%x)", next_addr, next_suffix)

    # ── Check if the address is already on the interface ──────────────────────
    if _is_bindable(next_addr):
        logger.info("IPv6 %s is already bindable — no provisioning needed", next_addr)
        return next_addr

    # ── Not bindable — try to provision it ────────────────────────────────────
    if not settings.ipv6_auto_provision:
        logger.warning(
            "IPv6 %s is not on the network interface and IPV6_AUTO_PROVISION=false. "
            "Add it manually: sudo ip addr add %s/128 dev %s",
            next_addr, next_addr, settings.ipv6_interface,
        )
        return next_addr  # Assign in DB anyway; admin must add to interface manually

    provisioned = _provision_ipv6(next_addr, settings.ipv6_interface)
    if provisioned:
        # Verify it's now bindable
        if _is_bindable(next_addr):
            logger.info("IPv6 %s successfully provisioned and verified", next_addr)
        else:
            logger.warning(
                "IPv6 %s was provisioned but still not bindable — "
                "the interface may need a moment to apply the change",
                next_addr,
            )
    else:
        logger.warning(
            "Could not auto-provision IPv6 %s. "
            "Add it manually: sudo ip addr add %s/128 dev %s  "
            "and append [Address] Address=%s/128 to "
            "/etc/systemd/network/70-%s.network.d/90-client-static-ips.conf",
            next_addr, next_addr, settings.ipv6_interface,
            next_addr, settings.ipv6_interface,
        )

    return next_addr

