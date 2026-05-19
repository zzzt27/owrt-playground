#!/bin/sh
# ZiVPN Installer — Downloads files directly from GitHub
# Usage: wget -qO- https://raw.githubusercontent.com/zzzt27/owrt-playground/master/zivpn/installer.sh | sh

set -e

REPO="https://raw.githubusercontent.com/zzzt27/owrt-playground/master/zivpn/files"

echo "========================================="
echo "  ZiVPN — OpenWrt Installer (Beta 0.0.1)"
echo "========================================="

# Check dependencies
for cmd in wget uci ubus; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: '$cmd' not found!"; exit 1; }
done

echo ""
echo "[1/4] Creating directories..."
mkdir -p /etc/zipvpn/action
mkdir -p /etc/zipvpn/core
mkdir -p /etc/zipvpn/run
mkdir -p /usr/libexec/rpcd
mkdir -p /usr/share/luci/menu.d
mkdir -p /usr/share/rpcd/acl.d
mkdir -p /www/luci-static/resources/view/zipvpn
mkdir -p /etc/hotplug.d/iface

echo "[2/4] Downloading files..."

_dl() {
    local src="$1" dst="$2"
    wget -qO "$dst" "$REPO/$src" || { echo "ERROR: Failed to download $src"; exit 1; }
}

_dl "zipvpn-start.sh"                    /etc/zipvpn/action/zipvpn-start.sh
_dl "zipvpn-stop.sh"                     /etc/zipvpn/action/zipvpn-stop.sh
_dl "download_bins.sh"                   /etc/zipvpn/action/download_bins.sh
_dl "watchdog.sh"                        /etc/zipvpn/action/watchdog.sh
_dl "zipvpn-rpc.sh"                      /usr/libexec/rpcd/zipvpn
_dl "luci-app-zipvpn.menu.json"          /usr/share/luci/menu.d/luci-app-zipvpn.menu.json
_dl "luci-app-zipvpn.acl.json"           /usr/share/rpcd/acl.d/luci-app-zipvpn.acl.json
_dl "zipvpn.init"                        /etc/init.d/zipvpn
_dl "99-zipvpn"                          /etc/hotplug.d/iface/99-zipvpn
_dl "view/zipvpn/dashboard.js"           /www/luci-static/resources/view/zipvpn/dashboard.js
_dl "view/zipvpn/config.js"              /www/luci-static/resources/view/zipvpn/config.js
_dl "view/zipvpn/log.js"                 /www/luci-static/resources/view/zipvpn/log.js

echo "[3/4] Setting permissions..."
chmod +x /etc/zipvpn/action/*.sh
chmod +x /usr/libexec/rpcd/zipvpn
chmod +x /etc/init.d/zipvpn
chmod +x /etc/hotplug.d/iface/99-zipvpn

echo "[4/4] Enabling service & restarting LuCI..."
/etc/init.d/zipvpn enable

if ! uci -q get zipvpn.main >/dev/null 2>&1; then
    touch /etc/config/zipvpn
    uci batch <<-'UCI'
        set zipvpn.main='global'
        set zipvpn.main.enabled='0'
        set zipvpn.main.expose_port='2080'
        set zipvpn.main.resolver='8.8.8.8:53'
        set zipvpn.main.down_mbps='50'
        set zipvpn.main.up_mbps='10'
        set zipvpn.main.disable_mtu_discovery='1'
        set zipvpn.main.recvwindowconn='1048576'
        set zipvpn.main.recvwindow='4194304'
        commit zipvpn
UCI
fi

rm -f /tmp/luci-*
rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart

echo ""
echo "========================================="
echo "  Done! Open LuCI > Services > ZiVPN"
echo "  1. Configuration tab — enter your account"
echo "  2. Dashboard tab — Download Binary"
echo "  3. Click Start!"
echo "========================================="
