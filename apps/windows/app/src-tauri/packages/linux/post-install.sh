#!/bin/bash
set -e

chmod +x /usr/bin/tono-service-install 2>/dev/null || true
chmod +x /usr/bin/tono-service-uninstall 2>/dev/null || true
chmod +x /usr/bin/tono-service 2>/dev/null || true

# Upgrade leftover: stop and forget the Clash Verge service names.
if [ -x /usr/bin/clash-verge-service-uninstall ]; then
    /usr/bin/clash-verge-service-uninstall >/dev/null 2>&1 || true
fi
rm -f /usr/bin/clash-verge-service \
      /usr/bin/clash-verge-service-install \
      /usr/bin/clash-verge-service-uninstall

. /etc/os-release

if [ "$ID" = "deepin" ] || [ "$ID" = "ubuntu" ]; then
    PACKAGE_NAME="${DPKG_MAINTSCRIPT_PACKAGE:-}"
    if [ -n "$PACKAGE_NAME" ]; then
        dpkg -L "$PACKAGE_NAME" 2>/dev/null | grep "\.desktop$" | while IFS= read -r f; do
            base=$(basename "$f")
            if [ "$base" = "Clash Verge.desktop" ] || [ "$base" = "clash-verge.desktop" ]; then
                echo "Replacing leftover desktop file $f"
                rm -vf "$f"
            fi
        done
    fi
    rm -vf /usr/share/applications/clash-verge.desktop
fi
