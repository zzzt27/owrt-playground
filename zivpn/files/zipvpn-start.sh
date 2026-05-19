#!/bin/sh
# /etc/zipvpn/action/zipvpn-start.sh
# ZipVPN — Start zivpn tunnel

BASE="/etc/zipvpn"
CORE="$BASE/core"
RUN="$BASE/run"
ZIVPN_BIN="$CORE/zivpn"
PID_FILE="$RUN/zivpn.pid"
LOG_FILE="$RUN/zivpn.log"
BYPASS_FILE="$RUN/bypass_ips"
ROUTE_FILE="$RUN/added_routes"

DEFAULT_OBFS="hu\`\`hqb\`c"
DEFAULT_PORTS="6000-7750,7751-9500,9501-11250,11251-13000,13001-14750,14751-16500,16501-18250,18251-19999"

mkdir -p "$RUN"

ts()  { date '+%H:%M:%S'; }
log() { printf "[%s] %s\n" "$(ts)" "$1" | tee -a "$LOG_FILE"; logger -t ZIPVPN "$1"; }

# ── Read UCI config ────────────────────────────────────────────────────────────
Z_SERVER="$(uci -q get zipvpn.main.z_server 2>/dev/null)"
Z_PASSWORD="$(uci -q get zipvpn.main.z_password 2>/dev/null)"
Z_OBFS="$(uci -q get zipvpn.main.z_obfs 2>/dev/null)"; Z_OBFS="${Z_OBFS:-$DEFAULT_OBFS}"
Z_PORTS="$(uci -q get zipvpn.main.z_port_ranges 2>/dev/null)"; Z_PORTS="${Z_PORTS:-$DEFAULT_PORTS}"
EXPOSE_PORT="$(uci -q get zipvpn.main.expose_port 2>/dev/null)"; EXPOSE_PORT="${EXPOSE_PORT:-2080}"
RESOLVER="$(uci -q get zipvpn.main.resolver 2>/dev/null)"; RESOLVER="${RESOLVER:-8.8.8.8:53}"
WAN_IFACE="$(uci -q get zipvpn.main.wan_iface 2>/dev/null)"
DOWN_MBPS="$(uci -q get zipvpn.main.down_mbps 2>/dev/null)"; DOWN_MBPS="${DOWN_MBPS:-50}"
UP_MBPS="$(uci -q get zipvpn.main.up_mbps 2>/dev/null)"; UP_MBPS="${UP_MBPS:-10}"
DISABLE_MTU="$(uci -q get zipvpn.main.disable_mtu_discovery 2>/dev/null)"; [ "$DISABLE_MTU" != "0" ] && DISABLE_MTU="true" || DISABLE_MTU="false"
RECV_CONN="$(uci -q get zipvpn.main.recvwindowconn 2>/dev/null)"; RECV_CONN="${RECV_CONN:-65536}"
RECV_WIN="$(uci -q get zipvpn.main.recvwindow 2>/dev/null)"; RECV_WIN="${RECV_WIN:-262144}"


# ── Validate ───────────────────────────────────────────────────────────────────
if [ -z "$Z_SERVER" ]; then
    log "ERROR: Server host not configured."
    log "       Go to Services > ZipVPN > Configuration"
    exit 1
fi
if [ ! -x "$ZIVPN_BIN" ]; then
    log "ERROR: Binary not found at $ZIVPN_BIN"
    log "       Click 'Download Binary' on the Dashboard"
    exit 1
fi

log "=== ZipVPN Starting ==="
log "Server      : $Z_SERVER"
log "Port Ranges : $Z_PORTS"
log "Obfs Key    : $Z_OBFS"
log "Listen      : 127.0.0.1:$EXPOSE_PORT"
log "DNS         : $RESOLVER"
[ -n "$WAN_IFACE" ] && log "WAN         : $WAN_IFACE" || log "WAN         : auto (default route)"

# ── Stop existing instances ────────────────────────────────────────────────────
sh "$BASE/action/zipvpn-stop.sh" 2>/dev/null

# ── Resolve server IP ──────────────────────────────────────────────────────────
resolve_ip() {
    local host="$1"
    echo "$host" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' && { echo "$host"; return; }
    
    # 1. Try DoH (bypass Mihomo Fake-IP DNS hijacking)
    local ip
    ip="$(curl -s -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=$host&type=A" 2>/dev/null | grep -oE '"data":"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | cut -d'"' -f4)"
    
    # 2. Fallback to standard nslookup/ping
    [ -z "$ip" ] && ip="$(nslookup "$host" 2>/dev/null | awk '/^Address:/ && !/53$/{print $2}' | head -1)"
    [ -z "$ip" ] && ip="$(ping -c1 -W2 "$host" 2>/dev/null | awk -F'[()]' '/^PING/{print $2}')"
    echo "$ip"
}

SERVER_IP="$(resolve_ip "$Z_SERVER")"
[ -n "$SERVER_IP" ] && log "Server IP: $SERVER_IP" || log "Warning: could not resolve $Z_SERVER"

# ── WAN: force route for server ────────────────────────────────────────────────
: > "$ROUTE_FILE"
if [ -n "$WAN_IFACE" ] && [ -n "$SERVER_IP" ]; then

    # --- Resolve logical interface name → real Linux device ---
    resolve_l3_dev() {
        local iface="$1" dev=""
        # 1. Try ubus l3_device (works when interface is UP)
        dev="$(ubus call network.interface."$iface" status 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null)"
        [ -n "$dev" ] && { echo "$dev"; return; }
        # 2. Try ubus device (sometimes available even when down)
        dev="$(ubus call network.interface."$iface" status 2>/dev/null | jsonfilter -e '@.device' 2>/dev/null)"
        [ -n "$dev" ] && { echo "$dev"; return; }
        # 3. Try UCI 'device' — for standard interfaces (dhcp, pppoe, static)
        dev="$(uci -q get network."$iface".device)"
        # If UCI device is a sysfs path (modemmanager), scan for wwan* device
        echo "$dev" | grep -q '^/sys/' && dev=""
        [ -n "$dev" ] && { echo "$dev"; return; }
        # 4. For modemmanager/qmi: find the wwan/wlan device by scanning
        local uci_dev="$(uci -q get network."$iface".device)"
        if echo "$uci_dev" | grep -q '^/sys/'; then
            # Find which wwan* device belongs to this USB path
            local usb_path="$(echo "$uci_dev" | sed 's|/sys/devices/||')"
            for netdev in /sys/class/net/wwan*; do
                [ -e "$netdev/device" ] || continue
                local real="$(readlink -f "$netdev/device" 2>/dev/null)"
                if echo "$real" | grep -q "$usb_path"; then
                    basename "$netdev"
                    return
                fi
            done
            # Last resort: just use wwan0 if only one exists
            [ -e /sys/class/net/wwan0 ] && { echo "wwan0"; return; }
        fi
        # 5. Try ifname (legacy OpenWrt)
        dev="$(uci -q get network."$iface".ifname)"
        [ -n "$dev" ] && { echo "$dev"; return; }
    }

    L3_DEV="$(resolve_l3_dev "$WAN_IFACE")"
    if [ -z "$L3_DEV" ]; then
        log "WARNING: Cannot resolve device for '$WAN_IFACE' — will use default route"
        log "         Route will auto-fix when the interface comes up (hotplug)"
    else
        log "Setting route: $SERVER_IP via $WAN_IFACE ($L3_DEV)"

        # Ensure the kernel device is UP (ModemManager sometimes doesn't do this)
        if ! ip link show "$L3_DEV" 2>/dev/null | grep -q 'state UP\|state UNKNOWN'; then
            log "Device $L3_DEV is DOWN at kernel level — bringing UP..."
            ip link set "$L3_DEV" up 2>/dev/null
            sleep 1
        fi

        # Try to get gateway and add route (best effort — don't block if WAN is down)
        WAN_GW="$(ubus call network.interface."$WAN_IFACE" status 2>/dev/null | jsonfilter -e '@.route[@.target="0.0.0.0"].nexthop' 2>/dev/null)"
        [ -z "$WAN_GW" ] && WAN_GW="$(ip route show dev "$L3_DEV" 2>/dev/null | awk '/^default/{print $3; exit}')"

        if [ -n "$WAN_GW" ]; then
            ip route replace "$SERVER_IP" via "$WAN_GW" dev "$L3_DEV" 2>/dev/null && {
                echo "$SERVER_IP via $WAN_GW dev $L3_DEV" >> "$ROUTE_FILE"
                log "Route added: $SERVER_IP via $WAN_GW dev $L3_DEV"
            } || log "Warning: could not add route (WAN may be down)"
        else
            log "WARNING: $WAN_IFACE has no gateway yet — route will be added by hotplug when WAN comes up"
        fi
    fi
fi


# ── Mihomo/Clash bypass ────────────────────────────────────────────────────────
: > "$BYPASS_FILE"
if [ -n "$SERVER_IP" ]; then
    log "Adding ip rule bypass so ZiVPN server isn't intercepted by Mihomo..."
    ip rule add to "$SERVER_IP" table main pref 10 2>/dev/null
    echo "$SERVER_IP" >> "$BYPASS_FILE"
    log "ip rule bypass added"
fi

# ── Build zivpn JSON config ────────────────────────────────────────────────────
CFG="{\"server\":\"${SERVER_IP:-$Z_SERVER}:$Z_PORTS\""
CFG="$CFG,\"obfs\":\"$Z_OBFS\""
[ -n "$Z_PASSWORD"  ] && CFG="$CFG,\"auth\":\"$Z_PASSWORD\""
CFG="$CFG,\"socks5\":{\"listen\":\"127.0.0.1:$EXPOSE_PORT\"}"
CFG="$CFG,\"insecure\":true,\"recvwindowconn\":$RECV_CONN,\"recvwindow\":$RECV_WIN,\"disable_mtu_discovery\":$DISABLE_MTU,\"resolver\":\"$RESOLVER\",\"down_mbps\":$DOWN_MBPS,\"up_mbps\":$UP_MBPS}"

# ── Launch zivpn ──────────────────────────────────────────────────────────────
log "Launching zivpn..."
log "Config: $CFG"
"$ZIVPN_BIN" -s "$Z_OBFS" --config "$CFG" >> "$LOG_FILE" 2>&1 &
ZPID=$!
echo "$ZPID" > "$PID_FILE"
log "PID: $ZPID"

# ── Wait for SOCKS5 port to open (max 15s) ────────────────────────────────────
for i in $(seq 1 15); do
    sleep 1
    if ! kill -0 "$ZPID" 2>/dev/null; then
        log "ERROR: zivpn exited unexpectedly"
        log "Check log above for details (wrong password / server unreachable)"
        exit 1
    fi
    if netstat -tunlp 2>/dev/null | grep -q ":$EXPOSE_PORT"; then
        log ""
        log "=== ZipVPN READY ==="
        log "SOCKS5 on 127.0.0.1:$EXPOSE_PORT"
        log ""
        log "Mihomo config:"
        log "  - name: zipvpn"
        log "    type: socks5"
        log "    server: 10.10.10.1"
        log "    port: $EXPOSE_PORT"
        log "    udp: true"
        exit 0
    fi
done

log "WARNING: Port $EXPOSE_PORT not detected after 15s"
log "zivpn (PID $ZPID) may still be connecting..."
