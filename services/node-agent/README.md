# Tono node agent (self-registration v1)

Backlog A20, decision D7-A: every node reports itself to the control plane with
its own token, instead of the fleet being known only from SSH and a hand-kept
table. Every 5 minutes `tono_node_agent.py` sends one heartbeat:

| Field | Source |
|---|---|
| `node` | `TONO_NODE_NAME` in `/etc/tono/node-agent.conf`, the catalog name exactly as in the ops console |
| `ip` | the node's primary outbound address (reported; may be a private address behind NAT) |
| `roles` | Tono services running now: `xray` (`tono-xray` active), `hy2` (`tono-hy2` active), `relay` (`nginx` active and `/etc/nginx/tono-relay.stream.conf` present) |
| `agentVersion` | `AGENT_VERSION` in the script |

The control plane stores the heartbeat in `ops_node_agents` (migration 0097),
one row per catalog name, next to the address Cloudflare saw
(`CF-Connecting-IP`). Read it with `GET /api/v1/ops/node-agents`.

What a heartbeat cannot do: list, unlist or publish a node, change the
customer catalog, change `ops_node_profiles.public_ip` or the verdict tables,
or write any other node's row. Self-registration never adds a node to the
customer catalog (ops plan §2 rule 10); listing stays the operator's
`publish-managed-catalog.rb` step. The reported IP is recorded, never routed to.

The token is not the exit node token (`exit_nodes`): that one reads the client
roster. This one authenticates the heartbeat and nothing else.

## Fleet record

The control plane is now the source for a node's address, roles, agent version
and last heartbeat. The Notion fleet table is a backup copy: update it from
`GET /api/v1/ops/node-agents` when convenient, and when the two disagree, the
control plane wins. SSH credentials stay where they are (Notion / keychain),
never in this repository or the control plane.

## Install (per node)

Node install is pending: the agent has not been installed on any node yet.

1. Issue the token (owner only; Access session to the ops API). The response
   carries the token once; it is never shown again. Issuing again replaces the
   old token at once.

   ```sh
   # name is URL-encoded, e.g. "Tokyo · Kite" -> Tokyo%20%C2%B7%20Kite
   POST https://admin.afk.ccwu.cc/api/v1/ops/nodes/<name>/agent-token
   ```

2. On the node, as root:

   ```sh
   install -d -m 0755 /opt/tono-node-agent /etc/tono
   install -m 0644 tono_node_agent.py /opt/tono-node-agent/
   install -o root -g root -m 0644 node-agent.conf.example /etc/tono/node-agent.conf   # then edit TONO_NODE_NAME
   umask 077; printf '%s\n' '<tna1.… token>' > /etc/tono/node-agent.token; chmod 0600 /etc/tono/node-agent.token
   install -m 0644 tono-node-agent.service tono-node-agent.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl start tono-node-agent.service && journalctl -u tono-node-agent -n 3 --no-pager
   systemctl enable --now tono-node-agent.timer
   ```

   The unit runs as a dynamic user with a private copy of the token
   (`LoadCredential`). It has no `EnvironmentFile`: the config file holds only
   `TONO_API_BASE` and `TONO_NODE_NAME`, the script parses those two keys
   itself and refuses any other line, and no output line ever carries a
   configured value, a path or the token. Never put the token in the config
   file or in any environment variable. It does not touch `tono-xray`, `tono-hy2` or nginx; it
   only asks systemd whether they are active.

3. Check `GET /api/v1/ops/node-agents`: the node's `lastHeartbeatAt` is recent,
   `observedIp` is the node's public address.

## Revoke

`DELETE /api/v1/ops/nodes/<name>/agent-token` (owner only). The next heartbeat
gets `403 NODE_AGENT_REVOKED`. Then stop the timer on the node:
`systemctl disable --now tono-node-agent.timer`.

## Answers

| Status | Meaning |
|---|---|
| 200 | stored |
| 401 | unknown or wrong token, or rotated since |
| 403 `NODE_AGENT_MISMATCH` | `TONO_NODE_NAME` is not the node this token was issued for |
| 403 `NODE_AGENT_REVOKED` | the token was revoked |
| 429 | more than 30 requests per 15 min from one address, or 10 per token |

## Test

```sh
python3 services/node-agent/test_tono_node_agent.py
```
