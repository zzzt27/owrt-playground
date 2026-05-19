#!/bin/sh
# /usr/libexec/rpcd/zipvpn
# Custom rpcd handler — exposes ZipVPN control as ubus methods
# Called by rpcd as: zipvpn list | zipvpn call <method>

BASE="/etc/zipvpn"
RUN="$BASE/run"
CORE="$BASE/core"
LOG="$RUN/zivpn.log"
PROGRESS="/tmp/zpvpn_dl_progress"

# Ensure log and run directory exist
mkdir -p "$RUN"
touch "$LOG" 2>/dev/null

_status() {
    local running=false has_bin=false pid="" bin_version=""

    if test -x "$CORE/zivpn"; then
        has_bin=true
        bin_version="$("$CORE/zivpn" --help 2>&1 | grep -oE 'Version:[[:space:]]+[0-9]+\.[0-9]+\.[0-9]+' | awk '{print $2}')"
    fi

    pid="$(cat "$RUN/zivpn.pid" 2>/dev/null | tr -d '\n')"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        running=true
    fi

    local progress
    progress="$(cat "$PROGRESS" 2>/dev/null | tr -d '\n')"

    # Ensure log file exists and is non-empty (ubus file read returns "Not Found" for empty files)
    if [ ! -s "$LOG" ]; then
        printf '[%s] ZipVPN ready. Binary: %s\n' \
            "$(date '+%H:%M:%S')" \
            "$(test -x "$CORE/zivpn" && echo 'OK' || echo 'not downloaded')" \
            >> "$LOG"
    fi
    # Check if the start script itself is still running (waiting for WAN etc)
    local starting=false
    if pgrep -f 'zipvpn-start.sh' >/dev/null 2>&1; then
        starting=true
    fi

    printf '{"running":%s,"starting":%s,"has_bin":%s,"version":"%s","pid":"%s","progress":"%s"}\n' "$running" "$starting" "$has_bin" "$bin_version" "$pid" "$progress"
}

_start() {
    sh "$BASE/action/zipvpn-start.sh" > /dev/null 2>&1 &
    printf '{"result":"ok"}\n'
}

_stop() {
    sh "$BASE/action/zipvpn-stop.sh" > /dev/null 2>&1
    printf '{"result":"ok"}\n'
}

_restart() {
    sh "$BASE/action/zipvpn-stop.sh" > /dev/null 2>&1
    sleep 1
    sh "$BASE/action/zipvpn-start.sh" > /dev/null 2>&1 &
    printf '{"result":"ok"}\n'
}

_download() {
    # Reset progress file and start download in background
    printf 'STARTING 0 11329536\n' > "$PROGRESS"
    sh "$BASE/action/download_bins.sh" >> /tmp/zpvpn_dl_log.txt 2>&1 &
    printf '{"result":"ok"}\n'
}

_log() {
    local n="${1:-50}"
    local lines
    lines="$(tail -"$n" "$LOG" 2>/dev/null | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' '|')"
    printf '{"lines":"%s"}\n' "$lines"
}

_clearlog() {
    : > "$LOG"
    printf '{"result":"ok"}\n'
}

case "$1" in
    list)
        printf '{"status":{},"start":{},"stop":{},"restart":{},"download":{},"log":{},"clearlog":{}}\n'
        ;;
    call)
        read -r input
        case "$2" in
            status)   _status ;;
            start)    _start  ;;
            stop)     _stop   ;;
            restart)  _restart ;;
            download) _download ;;
            log)
                n="$(echo "$input" | grep -o '"n":[0-9]*' | cut -d: -f2)"
                _log "${n:-50}"
                ;;
            clearlog) _clearlog ;;
            *)
                printf '{"error":"unknown method"}\n'
                ;;
        esac
        ;;
esac
