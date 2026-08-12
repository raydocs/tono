# Tono 0.0.58

- Fixes WeChat spinning for about half a minute right after connecting. Part of its traffic was taking a direct path that silently returned nothing, and WeChat retried for that long before moving on. That part now goes through the tunnel, as it did before; the rest stays direct.
