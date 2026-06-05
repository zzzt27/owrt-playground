#!/bin/sh
# /usr/share/dwtool/telegram_forward.sh
# SMS Telegram Forwarder Script for dwtool

ENABLED=$(uci -q get dwtool.telegram.enabled || echo "0")
[ "$ENABLED" = "1" ] || exit 0

BOT_TOKEN=$(uci -q get dwtool.telegram.bot_token)
CHAT_ID=$(uci -q get dwtool.telegram.chat_id)
[ -n "$BOT_TOKEN" ] && [ -n "$CHAT_ID" ] || exit 1

m_idx=$(basename "$(mmcli -L 2>/dev/null | grep -oE '/org/freedesktop/ModemManager1/Modem/[0-9]+' | head -1)" 2>/dev/null)
[ -n "$m_idx" ] || exit 1

# List all SMS
sms_list=$(mmcli -m "$m_idx" --messaging-list-sms 2>/dev/null | grep -o "/org/freedesktop/ModemManager1/SMS/[0-9]\+")

for sms_path in $sms_list; do
    sms_id=$(basename "$sms_path")
    
    sms_info=$(mmcli -s "$sms_id" 2>/dev/null)
    [ -n "$sms_info" ] || continue
    
    # Extract PDU Type and State
    sms_type=$(echo "$sms_info" | grep -i "pdu type:" | sed 's/.*pdu type:[[:space:]]*//' | tr -d ' \r\n')
    [ -z "$sms_type" ] && sms_type=$(echo "$sms_info" | grep -i "state:" | sed 's/.*state:[[:space:]]*//' | tr -d ' \r\n')

    # Only include received/deliver messages
    [ "$sms_type" = "received" ] || [ "$sms_type" = "deliver" ] || continue

    number=$(echo "$sms_info" | grep -i "number:" | sed 's/.*number:[[:space:]]*//' | tr -d ' \r\n')
    timestamp=$(echo "$sms_info" | grep -i "timestamp:" | sed 's/.*timestamp:[[:space:]]*//' | tr -d '\r\n')

    sms_key="${number}_${timestamp}"
    
    # Check if this SMS has already been forwarded (in case previous delete failed)
    if [ -f /tmp/dwtool_forwarded_sms ] && grep -qF "$sms_key" /tmp/dwtool_forwarded_sms; then
        # Already forwarded, just try to delete it again to clean SIM memory
        mmcli -m "$m_idx" --messaging-delete-sms="$sms_id" >/dev/null 2>&1
        continue
    fi

    # Smart multiline text extraction
    text=$(echo "$sms_info" | awk '/[ \t]text:/ {flag=1; print substr($0, index($0,$2)); next} /-------/ {flag=0} flag {print}' | sed 's/^[ \t]*//')
    [ -z "$text" ] && text=$(echo "$sms_info" | grep -i "text:" | sed 's/.*text:[[:space:]]*//')
    
    # Clean leading 'text: ' prefix if present
    text=$(echo "$text" | sed 's/^text:[[:space:]]*//')
    
    # Escape HTML special characters in text to prevent Telegram parser errors
    text_escaped=$(echo "$text" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')

    # Format telegram message in HTML
    msg="📩 <b>SMS Baru Diterima</b>\n\n<b>Dari:</b> <code>${number}</code>\n<b>Waktu:</b> <code>${timestamp}</code>\n\n<b>Pesan:</b>\n%s"
    # Format message body properly using jq
    msg_formatted=$(printf "$msg" "$text_escaped")
    
    # Send via Telegram API using HTML parse mode
    res=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg chat_id "$CHAT_ID" --arg text "$msg_formatted" --arg parse_mode "HTML" '{chat_id: $chat_id, text: $text, parse_mode: $parse_mode}')" 2>/dev/null)
        
    is_ok=$(echo "$res" | jq -r '.ok' 2>/dev/null)
    
    if [ "$is_ok" = "true" ]; then
        logger -t dwtool-forwarder "SMS ID $sms_id from $number forwarded successfully"
        
        # Save a copy to the local persistent history database before deleting from SIM
        text_json_esc=$(echo "$text" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')
        msg_json="[{\"index\": \"${sms_id}\", \"from\": \"${number}\", \"date\": \"${timestamp}\", \"text\": \"${text_json_esc}\"}]"
        echo "$msg_json" | /usr/share/dwtool/sms_db.lua list >/dev/null 2>&1

        # Add to forwarded cache
        echo "$sms_key" >> /tmp/dwtool_forwarded_sms
        # Keep only the last 100 entries to prevent memory growth
        tail -n 100 /tmp/dwtool_forwarded_sms > /tmp/dwtool_forwarded_sms.tmp 2>/dev/null && mv /tmp/dwtool_forwarded_sms.tmp /tmp/dwtool_forwarded_sms

        # Delete SMS from SIM storage to avoid full memory issues
        if mmcli -m "$m_idx" --messaging-delete-sms="$sms_id" >/dev/null 2>&1; then
            logger -t dwtool-forwarder "SMS ID $sms_id deleted from SIM storage"
        else
            logger -t dwtool-forwarder "Warning: failed to delete SMS ID $sms_id from SIM storage (will retry)"
        fi
    else
        logger -t dwtool-forwarder "Failed to forward SMS ID $sms_id: $res"
    fi
done
