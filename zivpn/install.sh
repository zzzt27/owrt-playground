#!/bin/sh
# ZiVPN Installer for OpenWrt
# Installs the LuCI dashboard, service scripts, and hotplug

set -e

echo "========================================="
echo "  ZiVPN — OpenWrt Installer (Beta 0.0.1)"
echo "========================================="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "[1/5] Creating directories..."
mkdir -p /etc/zipvpn/action
mkdir -p /etc/zipvpn/core
mkdir -p /etc/zipvpn/run
mkdir -p /usr/libexec/rpcd
mkdir -p /usr/share/luci/menu.d
mkdir -p /usr/share/rpcd/acl.d
mkdir -p /www/luci-static/resources/view/zipvpn
mkdir -p /etc/hotplug.d/iface

echo "[2/5] Copying files..."
cp "$SCRIPT_DIR/files/zipvpn-start.sh"              /etc/zipvpn/action/
cp "$SCRIPT_DIR/files/zipvpn-stop.sh"               /etc/zipvpn/action/
cp "$SCRIPT_DIR/files/download_bins.sh"             /etc/zipvpn/action/
cp "$SCRIPT_DIR/files/zipvpn-rpc.sh"                /usr/libexec/rpcd/zipvpn
cp "$SCRIPT_DIR/files/luci-app-zipvpn.menu.json"    /usr/share/luci/menu.d/
cp "$SCRIPT_DIR/files/luci-app-zipvpn.acl.json"     /usr/share/rpcd/acl.d/
cp "$SCRIPT_DIR/files/zipvpn.init"                  /etc/init.d/zipvpn
cp "$SCRIPT_DIR/files/99-zipvpn"                    /etc/hotplug.d/iface/99-zipvpn
cp "$SCRIPT_DIR/files/view/zipvpn/dashboard.js"     /www/luci-static/resources/view/zipvpn/
cp "$SCRIPT_DIR/files/view/zipvpn/config.js"        /www/luci-static/resources/view/zipvpn/
cp "$SCRIPT_DIR/files/view/zipvpn/log.js"           /www/luci-static/resources/view/zipvpn/

echo "[3/5] Setting permissions..."
chmod +x /etc/zipvpn/action/*.sh
chmod +x /usr/libexec/rpcd/zipvpn
chmod +x /etc/init.d/zipvpn
chmod +x /etc/hotplug.d/iface/99-zipvpn

echo "[4/5] Enabling auto-start & restarting services..."
/etc/init.d/zipvpn enable
rm -f /tmp/luci-*
rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart

echo ""
echo "[5/5] Creating default UCI config (if not exists)..."
if ! uci -q get zipvpn.main >/dev/null 2>&1; then
    touch /etc/config/zipvpn
    uci batch <<-'UCI'
        set zipvpn.main='global'
        set zipvpn.main.enabled='0'
        set zipvpn.main.expose_port='7777'
        set zipvpn.main.expose_addr='0.0.0.0'
        set zipvpn.main.down_mbps='100'
        set zipvpn.main.up_mbps='30'
        set zipvpn.main.disable_mtu_discovery='1'
        set zipvpn.main.recvwindowconn='4194304'
        set zipvpn.main.recvwindow='16777216'
        commit zipvpn
UCI
    echo "  Default config created at /etc/config/zipvpn"
else
    echo "  Config already exists — skipping"
fi

echo ""
echo "========================================="
echo "  Installation Complete!"
echo ""
echo "  Next steps:"
echo "  1. Open LuCI > Services > ZiVPN"
echo "  2. Go to Configuration — enter your account"
echo "  3. Go to Dashboard — click 'Download Binary'"
echo "  4. Click Start!"
echo "========================================="
