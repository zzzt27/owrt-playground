#!/bin/sh
# /etc/zipvpn/action/watchdog.sh
# Periodically checks if the VPN server route is still valid
# and re-applies it when the WAN gateway/IP changes.
# Started automatically by zipvpn-start.sh, killed by zipvpn-stop.sh.

BASE="/etc/zipvpn"
RUN="$BASE/run"
LOG_FILE="$RUN/zivpn.log"
PID_FILE="$RUN/zivpn.pid"
WATCHDOG_PID="$RUN/watchdog.pid"
ROUTE_FILE="$RUN/added_routes"

CHECK_INTERVAL=30  # seconds between each check

ts()  { date '+%H:%M:%S'; }
log() { printf "[%s] WD: %s\n" "$(ts)" "$1" | tee -a "$LOG_FILE"; logger -t ZIPVPN "WD: $1"; }

# Save our PID
echo "$$" > "$WATCHDOG_PID"

# Read config
WAN_IFACE="$(uci -q get zipvpn.main.wan_iface 2>/dev/null)"
Z_SERVER="$(uci -q get zipvpn.main.z_server 2>/dev/null)"

# No WAN iface selected = auto route, nothing to watch
[ -z "$WAN_IFACE" ] && { log "No WAN interface selected — watchdog not needed"; rm -f "$WATCHDOG_PID"; exit 0; }
[ -z "$Z_SERVER" ] && { rm -f "$WATCHDOG_PID"; exit 0; }

# Resolve server IP (same logic as start script)
echo "$Z_SERVER" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' && SERVER_IP="$Z_SERVER"
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="$(nslookup "$Z_SERVER" 2>/dev/null | awk '/^Address:/ && !/53$/{print $2}' | head -1)"
fi
[ -z "$SERVER_IP" ] && { log "Cannot resolve server IP — watchdog exit"; rm -f "$WATCHDOG_PID"; exit 1; }

# Helper: get current WAN gateway + device
get_wan_info() {
    local gw dev
    gw="$(ubus call network.interface."$WAN_IFACE" status 2>/dev/null | jsonfilter -e '@.route[@.target="0.0.0.0"].nexthop' 2>/dev/null)"
    dev="$(ubus call network.interface."$WAN_IFACE" status 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null)"
    echo "$gw|$dev"
}

# Helper: get current route for server
get_current_route() {
    ip route get "$SERVER_IP" 2>/dev/null | awk '/via/{print $3"|"$5; exit}'
}

LAST_GW=""
LAST_DEV=""
FAIL_COUNT=0

log "Watchdog started: monitoring $WAN_IFACE for route to $SERVER_IP (every ${CHECK_INTERVAL}s)"

while true; do
    sleep "$CHECK_INTERVAL"

    # Check if zivpn is still running
    if [ -f "$PID_FILE" ]; then
        ZPID="$(cat "$PID_FILE" 2>/dev/null)"
        if [ -n "$ZPID" ] && ! kill -0 "$ZPID" 2>/dev/null; then
            log "ZiVPN process died (PID $ZPID) — watchdog exit"
            rm -f "$WATCHDOG_PID"
            exit 0
        fi
    else
        log "PID file gone — watchdog exit"
        rm -f "$WATCHDOG_PID"
        exit 0
    fi

    # Get current WAN info
    WAN_INFO="$(get_wan_info)"
    CUR_GW="$(echo "$WAN_INFO" | cut -d'|' -f1)"
    CUR_DEV="$(echo "$WAN_INFO" | cut -d'|' -f2)"

    # WAN down? skip this cycle
    if [ -z "$CUR_GW" ] || [ -z "$CUR_DEV" ]; then
        FAIL_COUNT=$((FAIL_COUNT + 1))
        [ "$FAIL_COUNT" -eq 3 ] && log "WAN $WAN_IFACE appears down — waiting for it to come back..."
        continue
    fi
    FAIL_COUNT=0

    # Check if route needs updating
    CURRENT_ROUTE="$(get_current_route)"
    ROUTE_GW="$(echo "$CURRENT_ROUTE" | cut -d'|' -f1)"
    ROUTE_DEV="$(echo "$CURRENT_ROUTE" | cut -d'|' -f2)"

    if [ "$ROUTE_GW" != "$CUR_GW" ] || [ "$ROUTE_DEV" != "$CUR_DEV" ]; then
        log "Route change detected!"
        log "  Old: via $ROUTE_GW dev $ROUTE_DEV"
        log "  New: via $CUR_GW dev $CUR_DEV"

        # Ensure device is UP (ModemManager quirk)
        ip link set "$CUR_DEV" up 2>/dev/null

        # Apply new route
        ip route replace "$SERVER_IP" via "$CUR_GW" dev "$CUR_DEV" 2>/dev/null && {
            log "Route updated: $SERVER_IP via $CUR_GW dev $CUR_DEV"
            echo "$SERVER_IP via $CUR_GW dev $CUR_DEV" > "$ROUTE_FILE"
        } || log "WARNING: Failed to update route"

        # Refresh ip rule bypass
        ip rule del to "$SERVER_IP" lookup main 2>/dev/null
        ip rule add to "$SERVER_IP" lookup main prio 10 2>/dev/null
    fi
done
