#!/bin/sh
# /etc/zipvpn/action/zipvpn-stop.sh
BASE="/etc/zipvpn"
RUN="$BASE/run"

log() { printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$1" | tee -a "$RUN/zivpn.log"; logger -t ZIPVPN "$1"; }

# Kill zivpn
if [ -f "$RUN/zivpn.pid" ]; then
    kill "$(cat "$RUN/zivpn.pid")" 2>/dev/null
    rm -f "$RUN/zivpn.pid"
fi
killall -q zivpn 2>/dev/null
log "zivpn stopped"

# Kill watchdog
if [ -f "$RUN/watchdog.pid" ]; then
    kill "$(cat "$RUN/watchdog.pid")" 2>/dev/null
    rm -f "$RUN/watchdog.pid"
    log "watchdog stopped"
fi

# Remove ip rule bypasses
if [ -f "$RUN/bypass_ips" ]; then
    while read -r ip; do
        [ -z "$ip" ] && continue
        ip rule del to "$ip" table main pref 10 2>/dev/null
        # Cleanup old iptables just in case
        iptables -t nat -D OUTPUT      -d "$ip" -j RETURN 2>/dev/null
        iptables -t nat -D PREROUTING  -d "$ip" -j RETURN 2>/dev/null
    done < "$RUN/bypass_ips"
    rm -f "$RUN/bypass_ips"
fi

# Remove WAN routes added at start
if [ -f "$RUN/added_routes" ]; then
    while read -r route; do
        [ -z "$route" ] && continue
        ip route del $route 2>/dev/null
    done < "$RUN/added_routes"
    rm -f "$RUN/added_routes"
fi

log "ZipVPN stopped"
