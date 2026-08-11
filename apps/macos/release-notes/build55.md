# Tono 0.0.55

- Long-lived connections are no longer severed while connected. A periodic internal refresh reloaded the core roughly every twenty minutes, which closed every open connection — the "connection closed mid-response" seen in AI tools and long downloads. That refresh existed to keep pinned addresses fresh; routing no longer reads those addresses, so it no longer runs.
- Thirty China sites that were reaching the internet through the tunnel now take the direct path, including Baidu, Zoom, and the mainland finance and education sites. Their rules were accepted by the service but never applied.
- Direct web routes now fall back to the tunnel when the direct path is unreachable, instead of failing.
- The activity log stream no longer reconnects every half minute while idle.
- Aggregated routing research is now off unless you turn it on, matching its own description and the other collection settings.
