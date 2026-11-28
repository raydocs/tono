#!/usr/bin/env python3
"""Add per-account metering to a deployed xray configuration, additively.

The deployed config has one unlabelled client and no management interface, so an
exit can count bytes but cannot say whose — which is why no usage has ever been
recorded for anyone. Three things are missing: statistics, per-user counters, and
an API to add and remove accounts without a restart.

Two rules govern the edit, and both exist to avoid taking a working exit down:

  * **Additive.** The existing client is kept. It is the credential every current
    client still holds, so removing it here would disconnect the entire fleet the
    moment this runs. It is removed later, after accounts have their own.

  * **Idempotent.** Applying twice changes nothing and needs no restart. Adding
    the API interface does require one — the interface it would be added through
    does not exist yet — so a run that has nothing to do must not spend a
    disconnection to discover that.

Read on stdin, written to stdout. The caller validates the result with
`xray run -test` before putting it anywhere, because this cannot know what the
installed xray accepts.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys

API_TAG = "api"
API_INBOUND_TAG = "tono-api"
# Loopback only. This interface can add and remove accounts, so it must never be
# reachable from off the host.
API_LISTEN = "127.0.0.1"
API_PORT = 10085
# The label a legacy client's counters are filed under. Not a user id, because it
# is not one account — it is everyone who has not yet been issued their own
# identity, and calling it a user id would put that shared total on somebody's
# bill.
LEGACY_CLIENT_EMAIL = "shared-legacy"

DIRECT_OUTBOUND_TAG = "direct"
HOME_BLACKHOLE_TAG = "home-blackhole"
ROUTING_SERVICE = "RoutingService"
API_RULE_TAG = "tono-api-rule"
HOME_PRIVATE_CIDRS_RULE_TAG = "tono-home-private-cidrs"
HOME_CATCHALL_RULE_TAG = "tono-home-catchall"
# Explicit literal CIDRs instead of `geoip:private` because provisioned exit
# nodes intentionally omit geoip.dat / geosite.dat.
PRIVATE_HOME_CIDRS: tuple[str, ...] = (
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "100.64.0.0/10",
    "fc00::/7",
    "fe80::/10",
    "::1/128",
)


class Unsupported(RuntimeError):
    """The configuration is not the shape this knows how to edit."""


def _vless_inbounds(config: dict) -> list[dict]:
    return [
        inbound for inbound in config.get("inbounds", [])
        if isinstance(inbound, dict) and inbound.get("protocol") == "vless"
    ]


def needs_changes(config: dict, *, node_home: bool = False) -> bool:
    """Whether applying would change anything.

    Consulted before a restart is spent, so it must consider every part of the
    edit rather than just the most obvious one.
    """
    transformed = with_node_home(config) if node_home else with_metering(config)
    return json.dumps(transformed, sort_keys=True) != json.dumps(
        config, sort_keys=True
    )


def with_metering(config: dict) -> dict:
    if not isinstance(config, dict):
        raise Unsupported("configuration root is not an object")
    inbounds = config.get("inbounds")
    if not isinstance(inbounds, list) or not inbounds:
        raise Unsupported("configuration has no inbounds")
    vless = _vless_inbounds(config)
    if not vless:
        raise Unsupported("configuration has no vless inbound to meter")

    result = copy.deepcopy(config)

    # Statistics collection, and the per-user counters that make it attributable.
    # Without `statsUserUplink`/`statsUserDownlink` the stats API reports totals
    # per inbound and nothing per account, which is the situation being fixed.
    result["stats"] = result.get("stats") if isinstance(result.get("stats"), dict) else {}
    policy = result.get("policy") if isinstance(result.get("policy"), dict) else {}
    levels = policy.get("levels") if isinstance(policy.get("levels"), dict) else {}
    level0 = levels.get("0") if isinstance(levels.get("0"), dict) else {}
    level0["statsUserUplink"] = True
    level0["statsUserDownlink"] = True
    levels["0"] = level0
    policy["levels"] = levels
    result["policy"] = policy

    # The management service. `HandlerService` adds and removes accounts without a
    # restart; `StatsService` reads the counters.
    api = result.get("api") if isinstance(result.get("api"), dict) else {}
    api["tag"] = API_TAG
    services = api.get("services") if isinstance(api.get("services"), list) else []
    for service in ("HandlerService", "StatsService"):
        if service not in services:
            services.append(service)
    api["services"] = services
    result["api"] = api

    # The inbound the API is served on, and the route that sends it there.
    if not any(
        isinstance(inbound, dict) and inbound.get("tag") == API_INBOUND_TAG
        for inbound in result["inbounds"]
    ):
        result["inbounds"].append({
            "tag": API_INBOUND_TAG,
            "listen": API_LISTEN,
            "port": API_PORT,
            "protocol": "dokodemo-door",
            "settings": {"address": API_LISTEN},
        })
    routing = result.get("routing") if isinstance(result.get("routing"), dict) else {}
    rules = routing.get("rules") if isinstance(routing.get("rules"), list) else []
    if not any(
        isinstance(rule, dict)
        and rule.get("outboundTag") == API_TAG
        and API_INBOUND_TAG in (rule.get("inboundTag") or [])
        for rule in rules
    ):
        # First: a later catch-all would otherwise swallow the management traffic
        # and the API would answer nothing while appearing configured.
        rules.insert(0, {
            "type": "field",
            "inboundTag": [API_INBOUND_TAG],
            "outboundTag": API_TAG,
        })
    routing["rules"] = rules
    result["routing"] = routing

    # Every existing client keeps its credential and gains a label, because a
    # client without one produces counters nobody can file. Labelled as shared
    # rather than as a user: it is the credential the whole fleet still holds.
    for inbound in _vless_inbounds(result):
        settings = inbound.get("settings")
        if not isinstance(settings, dict):
            raise Unsupported("vless inbound has no settings object")
        clients = settings.get("clients")
        if not isinstance(clients, list) or not clients:
            raise Unsupported("vless inbound has no clients to keep")
        for client in clients:
            if not isinstance(client, dict) or "id" not in client:
                raise Unsupported("vless client is not an object with an id")
            client.setdefault("email", LEGACY_CLIENT_EMAIL)

    return result


def with_node_home(config: dict) -> dict:
    """Add fail-closed node-side residential (`^h:`) routing & blackhole guards.

    Extends `with_metering` additively while keeping index-0 `freedom` intact
    for existing `u:`, `shared-legacy`, static, and hand-added clients.
    """
    result = with_metering(config)

    services = result["api"]["services"]
    if ROUTING_SERVICE not in services:
        services.append(ROUTING_SERVICE)

    outbounds = result.get("outbounds")
    if not isinstance(outbounds, list) or not outbounds or not isinstance(outbounds[0], dict):
        raise Unsupported("configuration has no primary freedom outbound at index 0")
    if outbounds[0].get("protocol") != "freedom":
        raise Unsupported("configuration outbounds[0] must use protocol freedom")
    outbounds[0].setdefault("tag", DIRECT_OUTBOUND_TAG)

    existing_blackhole = [
        outbound for outbound in outbounds
        if isinstance(outbound, dict) and outbound.get("tag") == HOME_BLACKHOLE_TAG
    ]
    if existing_blackhole:
        if any(outbound.get("protocol") != "blackhole" for outbound in existing_blackhole):
            raise Unsupported("existing home-blackhole outbound does not use protocol blackhole")
    else:
        outbounds.append({"tag": HOME_BLACKHOLE_TAG, "protocol": "blackhole"})

    for inbound in _vless_inbounds(result):
        inbound["sniffing"] = {"enabled": False}

    routing = result["routing"]
    routing["domainStrategy"] = "AsIs"

    head_tags = {API_RULE_TAG, HOME_PRIVATE_CIDRS_RULE_TAG, HOME_CATCHALL_RULE_TAG}
    other_rules = [
        rule for rule in routing.get("rules", [])
        if not (
            isinstance(rule, dict)
            and (
                rule.get("ruleTag") in head_tags
                or (rule.get("outboundTag") == API_TAG and API_INBOUND_TAG in (rule.get("inboundTag") or []))
                or (rule.get("outboundTag") == HOME_BLACKHOLE_TAG and rule.get("user") == ["regexp:^h:"])
            )
        )
    ]
    routing["rules"] = [
        {
            "type": "field",
            "ruleTag": API_RULE_TAG,
            "inboundTag": [API_INBOUND_TAG],
            "outboundTag": API_TAG,
        },
        {
            "type": "field",
            "ruleTag": HOME_PRIVATE_CIDRS_RULE_TAG,
            "user": ["regexp:^h:"],
            "ip": list(PRIVATE_HOME_CIDRS),
            "outboundTag": HOME_BLACKHOLE_TAG,
        },
        {
            "type": "field",
            "ruleTag": HOME_CATCHALL_RULE_TAG,
            "user": ["regexp:^h:"],
            "outboundTag": HOME_BLACKHOLE_TAG,
        },
        *other_rules,
    ]
    return result


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--node-home",
        action="store_true",
        help="also enforce RoutingService, AsIs DNS, and ^h: home-blackhole static guards",
    )
    args = parser.parse_args(argv)

    raw = sys.stdin.read()
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as error:
        print(f"configuration is not JSON: {error}", file=sys.stderr)
        raise SystemExit(2)
    try:
        updated = with_node_home(config) if args.node_home else with_metering(config)
    except Unsupported as error:
        print(f"refusing: {error}", file=sys.stderr)
        raise SystemExit(2)
    json.dump(updated, sys.stdout, indent=2, sort_keys=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
