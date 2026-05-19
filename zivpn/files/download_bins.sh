#!/bin/sh
# /etc/zipvpn/action/download_bins.sh
# Download zivpn binary with progress tracking
# Progress written to /tmp/zpvpn_dl_progress: "STATUS BYTES_DONE BYTES_TOTAL"

CORE="/etc/zipvpn/core"
PROGRESS="/tmp/zpvpn_dl_progress"
BASE_URL="https://github.com/zahidbd2/udp-zivpn/releases/download/udp-zivpn_1.4.9"

log() { echo "[DL] $1"; logger -t ZIPVPN-DL "$1"; }
progress() { echo "$1" > "$PROGRESS"; }

mkdir -p "$CORE"

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)       SUFFIX="amd64"; TOTAL=11329536 ;;
    aarch64)      SUFFIX="arm64"; TOTAL=10813440 ;;
    armv7l|armv7) SUFFIX="arm";   TOTAL=10878976 ;;
    armv6l)       SUFFIX="arm";   TOTAL=10878976 ;;
    *)
        log "Unknown arch: $ARCH, falling back to amd64"
        SUFFIX="amd64"; TOTAL=11329536
        ;;
esac

URL="${BASE_URL}/udp-zivpn-linux-${SUFFIX}"
TMP="$CORE/zivpn.tmp"

log "Arch: $ARCH → $SUFFIX  ($TOTAL bytes)"
log "URL: $URL"
progress "STARTING 0 $TOTAL"

rm -f "$TMP"

# Start download in background
wget -q -O "$TMP" "$URL" &
WGET_PID=$!

log "Download PID: $WGET_PID"

# Track progress while downloading
while kill -0 $WGET_PID 2>/dev/null; do
    BYTES=$(wc -c "$TMP" 2>/dev/null | awk '{print $1}')
    BYTES=${BYTES:-0}
    progress "DOWNLOADING $BYTES $TOTAL"
    sleep 1
done

# Wait for wget to finish and get exit code
wait $WGET_PID
RC=$?

if [ "$RC" != "0" ]; then
    log "ERROR: wget failed (exit $RC)"
    progress "ERROR 0 $TOTAL"
    rm -f "$TMP"
    exit 1
fi

if [ ! -s "$TMP" ]; then
    log "ERROR: Downloaded file is empty"
    progress "ERROR 0 $TOTAL"
    rm -f "$TMP"
    exit 1
fi

# Verify ELF magic bytes using hexdump or head -c
# od is not available on OpenWrt busybox - use hexdump or read raw bytes
MAGIC=""
if command -v hexdump >/dev/null 2>&1; then
    MAGIC=$(hexdump -n 4 -e '4/1 "%02x"' "$TMP" 2>/dev/null)
elif command -v xxd >/dev/null 2>&1; then
    MAGIC=$(xxd -p -l 4 "$TMP" 2>/dev/null)
else
    # Fallback: read first byte as decimal via printf trick
    MAGIC=$(head -c 4 "$TMP" 2>/dev/null | cat -v | grep -c '\^?' || true)
    # Just check file is not an HTML page (GitHub error)
    FIRST=$(head -c 15 "$TMP" 2>/dev/null)
    if echo "$FIRST" | grep -qi 'html\|404\|not found\|rate limit'; then
        log "ERROR: Downloaded file is an HTML error page, not a binary"
        log "       Content: $FIRST"
        progress "ERROR 0 $TOTAL"
        rm -f "$TMP"
        exit 1
    fi
    # Skip ELF check if we have no hex tool
    MAGIC="7f454c46"
fi

if ! echo "$MAGIC" | grep -qi '7f454c46'; then
    log "ERROR: Not a valid ELF binary (magic: $MAGIC)"
    FIRST=$(head -c 80 "$TMP" 2>/dev/null)
    log "       File content: $FIRST"
    progress "ERROR 0 $TOTAL"
    rm -f "$TMP"
    exit 1
fi

ACTUAL=$(wc -c "$TMP" | awk '{print $1}')
mv "$TMP" "$CORE/zivpn"
chmod +x "$CORE/zivpn"

log "SUCCESS: /etc/zipvpn/core/zivpn ($ACTUAL bytes)"
progress "SUCCESS $ACTUAL $TOTAL"
