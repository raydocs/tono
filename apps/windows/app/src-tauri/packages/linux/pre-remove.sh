#!/bin/bash
if [ -x /usr/bin/tono-service-uninstall ]; then
    /usr/bin/tono-service-uninstall >/dev/null 2>&1 || true
fi
if [ -x /usr/bin/clash-verge-service-uninstall ]; then
    /usr/bin/clash-verge-service-uninstall >/dev/null 2>&1 || true
fi

. /etc/os-release

if [ "$ID" = "deepin" ] || [ "$ID" = "ubuntu" ]; then
    rm -vf /usr/share/applications/clash-verge.desktop
fi
