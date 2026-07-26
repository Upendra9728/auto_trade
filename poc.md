# POC: Multi-Client IPv6 Egress for Dhan Order Placement

## Problem

Telegram bot parses trading signals (e.g. `NIFTY 23800PE PRICE: 3 STOPLOSS: 0 TARGETS: 15 QTY: 1300 EXPIRY: 2026-07-21 Dhan BO`) and calls a backend `place-order/` API against Dhan's broker API. Currently bot + backend run on a single Hostinger VPS with one public IP.

**Constraint:** Dhan (per SEBI mandate) requires each client's trading account to whitelist a specific static IP via `/v2/ip/setIP`, and only that IP can place orders for that account. One server IP = one client. Need to support ~1000 clients.

## Why Hostinger didn't work

Hostinger VPS showed a routed `2a02:4780:63::/48` IPv6 block in `ip -6 route show`, but this was misleading — it's just the route to their gateway, not proof of usable egress. Manually adding a second address from that block (`ip -6 addr add`) and testing egress (`curl -6 --interface <ip>`) resulted in connection timeouts. Root cause: upstream anti-spoofing / uRPF filtering — Hostinger only allows egress traffic from the single IP they explicitly provisioned, regardless of what's routed to the box locally. Provider-side provisioning is required for multi-IP egress, and Hostinger's plan doesn't support this.

## Chosen solution: AWS EC2 + IPv6 prefix delegation

Instead of leasing many IPv4s or running 1000 servers/proxies, use a single EC2 instance with an **IPv6 prefix delegated to its network interface (ENI)**. A `/80` prefix delegation counts as one "slot" against the ENI's address limit but yields ~2^48 usable addresses — enough for thousands of clients from one cheap instance, with no per-address AWS API calls needed at runtime (addresses are carved out and managed at the OS level).

### Why not plain per-address assignment
Each ENI has a hard cap on individually-assigned IPv6 addresses tied to instance size (e.g. `t3.micro` = 2 per ENI, `c5.4xlarge` ≈ 30 per ENI). Reaching 1000 this way would require oversized instances and/or many ENIs, and each address requires an individual `assign-ipv6-addresses` API call. Prefix delegation avoids this entirely.

## What was actually built and verified (this session)

**Account/region:** AWS account `182102543815`, region `ap-south-1` (Mumbai — chosen for lowest latency to Dhan's servers).

**Note on CloudShell gotcha:** `aws configure set region` alone did NOT work in CloudShell — `AWS_DEFAULT_REGION` env var (tied to the Console's region dropdown, top-right of browser UI) takes precedence and overrode it. Must set region via the Console UI dropdown, not just the CLI, or CloudShell keeps creating resources in the wrong region.

### Resources created
- VPC: `vpc-048a5db13a659e2ba` — CIDR `10.0.0.0/16`, IPv6 `2406:da1a:c1e:f000::/56` (Amazon-provided)
- Subnet: `subnet-076cffc61dfc8d348` — `10.0.1.0/24`, IPv6 `2406:da1a:c1e:f000::/64`, AZ `ap-south-1a`
- Internet Gateway: `igw-0b7a31f0ecb895e1a` (attached to VPC)
- Route table: `rtb-0891f2ef4272b674a` — added `0.0.0.0/0` and `::/0` routes via the IGW
- Security group: `sg-063e1eb8d758a57c5` — inbound TCP 22 (SSH) open (would need tightening for production)
- Key pair: `dhan-test-key` (saved as `dhan-test-key.pem` in CloudShell home dir)
- EC2 instance: `i-0cbb6ceca01ea6569` — `t3.micro`, AMI `ami-08e8e63035c905918` (Amazon Linux 2023), public IP `13.234.232.51`
- ENI: `eni-02aef9ca37c47a950`
- Delegated IPv6 prefix on the ENI: `2406:da1a:c1e:f000:bb82::/80`

### Instance sizing note
`t3.micro` allows only 2 total IPv6 "slots" per ENI (individual addresses + prefixes combined). Had to unassign a manually-added test address before the prefix delegation call would succeed (`AddressLimitExceeded` otherwise). For production, a slightly larger instance or multiple ENIs may be worth it for headroom, but a single `/80` prefix alone is enough address space for 1000+ clients regardless of instance size — the per-ENI slot limit only affects how many prefixes/individual addresses you can attach, not how many usable addresses exist within an already-attached prefix.

### 15 client addresses provisioned
Carved from the delegated prefix: `2406:da1a:c1e:f000:bb82::1` through `::f` (hex 1–15).

### Persistence (the critical requirement — IPs must never change once assigned)

Amazon Linux 2023 uses `systemd-networkd`. The interface config (`ens5`) is managed via `/usr/lib/systemd/network/80-ec2.network` (base AWS config, DHCP-based) plus a runtime drop-in at `/run/systemd/network/70-ens5.network.d/eni.conf` — this runtime drop-in is **auto-regenerated on every boot by `amazon-ec2-net-utils`' `policy-routes@ens5.service`** and lives in tmpfs (`/run/`), so it must NOT be hand-edited (changes would be wiped).

**Correct approach:** created a separate, persistent drop-in in `/etc/systemd/network/` (not `/run/`), which systemd-networkd merges alongside the auto-generated one without conflict:

```
/etc/systemd/network/70-ens5.network.d/90-client-static-ips.conf
```
Contents: 15 repeated `[Address]` stanzas, one per client IP, e.g.:
```ini
[Address]
Address=2406:da1a:c1e:f000:bb82::1/128
[Address]
Address=2406:da1a:c1e:f000:bb82::2/128
...
```

Applied with `sudo systemctl restart systemd-networkd`.

**Verified via full reboot (`sudo reboot`):** all 15 addresses came back automatically post-reboot with zero manual intervention, and each still egressed correctly and independently afterward (tested via `curl -6 --interface <addr> https://icanhazip.com` for all 15 — each returned its own address).

### Gotchas encountered along the way
- `https://ifconfig.co` returns a Cloudflare JS challenge page when curled from a datacenter/AWS IP — false negative, not a routing failure. Switched to `https://icanhazip.com` (plain text responder, no bot challenge) for all egress tests.
- Pasting multi-line piped/looped shell blocks into CloudShell sometimes silently swallowed output or merged command boundaries, causing false alarms about failed writes (a `tee` write actually succeeded but appeared not to). Heredocs (`<< 'EOF' ... EOF`) proved more paste-reliable than piped loops for multi-line file creation. Running one command at a time resolved ambiguity when needed.
- SELinux was in `Permissive` mode — ruled out as a cause during debugging, not actually relevant here.

## Current state / what's proven vs. not yet proven

**Proven (network layer, fully working):**
- AWS correctly routes egress traffic for many IPv6 addresses on one ENI (unlike Hostinger, which silently drops non-provisioned source IPs)
- Prefix delegation (`/80`) is a viable, cheap way to get far more usable addresses than instance-size-based per-address limits would otherwise allow
- Static address assignment via a persistent systemd-networkd drop-in survives full reboots without any AWS API calls or manual re-configuration

**Not yet proven (the one real remaining unknown):**
- Whether Dhan's `/v2/ip/setIP` whitelist actually accepts and correctly matches one of these AWS-assigned IPv6 addresses on a live order-placement call. This requires whitelisting one address (e.g. `2406:da1a:c1e:f000:bb82::1`) on a real Dhan client account, generating an access token, and placing one real (small) order bound to that address via a source-IP-bound HTTP client (Python `requests` + custom `HTTPAdapter` using `source_address`, or equivalent).

## Next steps (not yet started)
1. **Live Dhan order test** (see above) — closes the last open risk.
2. **Client registry** — DB table: `client_id, dhan_client_id, access_token, totp_secret, assigned_ipv6`. Map the 15 test clients to `bb82::1`–`bb82::f`.
3. **Order-placement code change** — modify backend's `place-order/` handler to look up the client's `assigned_ipv6` and bind the outbound Dhan API call to it.
4. **Daily token refresh job** — Dhan access tokens expire every 24h (API key + secret + TOTP flow); needs an automated cron per client before market open.
5. **Scale-out** — repeat the address-carving + persistent-config pattern for the full 1000-client range (still within the same `/80` prefix — no new AWS resources needed, just more `[Address]` stanzas and registry rows).
6. **Production hardening** — restrict SG SSH ingress to a specific IP (currently `0.0.0.0/0`), move off root AWS credentials to a scoped IAM user, consider redundancy/failover for the egress instance.
