// Which connect failures a node can be blamed for, and how customers vote
// with them. Kept apart from verdict-facts.ts so it stays under its budget.

// A failure the exit can be blamed for: the client never got a usable path to
// it. Older clients report that as a handshake/dial/tls stage; today's Windows
// client as TONO_NODE_OR_CORE_UNREACHABLE (controller, TUN and loopback all
// failed after the barrier locked), TONO_EXIT_UNREACHABLE (the exit never
// answered the dial before any tunnel existed) or the plain text below; the
// macOS client as CORE_EXIT_UNREACHABLE (controller and TUN probes both failed
// after the lock; its stage is the UI stage label, never a wire stage).
// Everything else in connectFail is the client's own plumbing.
export const EXIT_SIDE_SQL = `(
  stage IN ('handshake', 'dial', 'tls')
  OR lower(COALESCE(stage, '')) LIKE '%handshake%'
  OR code IN ('TONO_NODE_OR_CORE_UNREACHABLE', 'TONO_EXIT_UNREACHABLE', 'CORE_EXIT_UNREACHABLE')
  OR COALESCE(error, '') LIKE 'tcp connect to the selected exit%'
)`;

export type ExitFailPair = { node: string; userId: string };

/**
 * Customers are the probes (owner, 2026-10-26). A user whose exit-side
 * failures in the window all landed on one node is counted for that node; a
 * user who could not reach two different exits is reporting their own path
 * (ISP, TUN, a client release), not either node, and counts for none.
 */
export function exitUnreachableUsers(pairs: ReadonlyArray<ExitFailPair>): Map<string, number> {
  const nodesByUser = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const nodes = nodesByUser.get(pair.userId) ?? new Set<string>();
    nodes.add(pair.node);
    nodesByUser.set(pair.userId, nodes);
  }
  const out = new Map<string, number>();
  for (const nodes of nodesByUser.values()) {
    if (nodes.size !== 1) continue;
    for (const node of nodes) out.set(node, (out.get(node) ?? 0) + 1);
  }
  return out;
}
