# Tono 0.0.64

- Claude's own addresses now stay on the residential hop. Browser and Claude Code traffic to `claude.ai`, `claude.com`, `anthropic.com` and Anthropic's first-party IPv4/IPv6 ranges (`160.79.104.0/21`, `2607:6bc0::/48`, `2607:6bc0:11::/48`) no longer fall through to the datacenter exit when the catalog has a home route. Claude Code's versioned launcher (`2.1.x`) is matched by install path, so it is not split across two networks.
- Browser Perplexity and Gemini product hosts take the same residential hop. Search, YouTube, and `gstatic.com` stay off it.
- Activity groups Claude, Claude Code, ChatGPT and WeChat helpers under one row each, and colours WeChat China-direct as direct instead of proxy. The residential bar now counts a catalog `homeProxy` node, not only the SOCKS5 chain.
- The traffic log no longer records a healthy Claude home route as unclassified.
