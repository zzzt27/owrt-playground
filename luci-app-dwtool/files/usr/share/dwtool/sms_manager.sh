#!/bin/sh
# /usr/share/dwtool/sms_manager.sh
# Dual-mode SMS Manager with persistent history database

ACTION="$1"
ID="$2"

# Robust index extraction using basename to avoid ModemManager1 digit matching conflict
m_idx=$(basename "$(mmcli -L 2>/dev/null | grep -oE '/org/freedesktop/ModemManager1/Modem/[0-9]+' | head -1)" 2>/dev/null)
PORT=$(uci -q get dwtool.global.port 2>/dev/null || echo "/dev/ttyUSB0")

get_live_json() {
	if [ -n "$m_idx" ]; then
		# ── ModemManager Active Mode ──
		sms_list=$(mmcli -m "$m_idx" --messaging-list-sms 2>/dev/null | grep -o "/org/freedesktop/ModemManager1/SMS/[0-9]\+")
		echo "["
		first=1
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

			# Smart multiline text extraction
			text=$(echo "$sms_info" | awk '/[ \t]text:/ {flag=1; print substr($0, index($0,$2)); next} /-------/ {flag=0} flag {print}' | sed 's/^[ \t]*//')
			[ -z "$text" ] && text=$(echo "$sms_info" | grep -i "text:" | sed 's/.*text:[[:space:]]*//')
			
			# Clean leading 'text: ' prefix if present
			text=$(echo "$text" | sed 's/^text:[[:space:]]*//')
			
			text_esc=$(echo "$text" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')

			if [ "$first" -eq 0 ]; then
				echo ","
			fi
			first=0

			cat <<EOF
{
  "index": "${sms_id}",
  "from": "${number}",
  "date": "${timestamp}",
  "text": "${text_esc}"
}
EOF
		done
		echo "]"
	else
		# ── Fallback Mode (sms_tool recv) ──
		sms_tool -d "$PORT" recv 2>/dev/null | awk '
		BEGIN {
			print "["
			first = 1
		}
		/^MSG: [0-9]+/ {
			if (in_msg) {
				print_msg()
			}
			msg_id = $2
			from = ""
			date = ""
			text = ""
			in_msg = 1
			body = 0
			next
		}
		in_msg && /^From: / {
			from = substr($0, 7)
			next
		}
		in_msg && /^Date\/Time: / {
			date = substr($0, 12)
			body = 1
			next
		}
		in_msg && body {
			if (text == "") {
				text = $0
			} else {
				text = text "\n" $0
			}
		}
		END {
			if (in_msg) {
				print_msg()
			}
			print "]"
		}
		function print_msg() {
			if (first == 0) {
				print ","
			}
			first = 0
			gsub(/\\/, "\\\\", text)
			gsub(/"/, "\\\"", text)
			gsub(/\n/, "\\n", text)
			gsub(/\r/, "", text)
			gsub(/\r/, "", from)
			gsub(/\r/, "", date)
			printf "{\n  \"index\": \"%s\",\n  \"from\": \"%s\",\n  \"date\": \"%s\",\n  \"text\": \"%s\"\n}", msg_id, from, date, text
		}
		'
	fi
}

case "$ACTION" in
	"list")
		# Get live JSON and pipe through Lua DB merge manager
		get_live_json | /usr/share/dwtool/sms_db.lua list
		;;

	"delete")
		if [ -z "$ID" ]; then
			echo "Error: missing SMS ID"
			exit 1
		fi

		# Delete from DB first, retrieve active modem indices to clean up hardware
		modem_indices=$(/usr/share/dwtool/sms_db.lua delete "$ID")

		if [ -n "$modem_indices" ]; then
			for idx in $modem_indices; do
				if [ -n "$m_idx" ]; then
					mmcli -m "$m_idx" --messaging-delete-sms="/org/freedesktop/ModemManager1/SMS/$idx" >/dev/null 2>&1
				else
					sms_tool -d "$PORT" delete "$idx" >/dev/null 2>&1
				fi
			done
		fi
		echo "OK"
		;;

	*)
		echo "Usage: $0 {list|delete} [id]"
		exit 1
		;;
esac
