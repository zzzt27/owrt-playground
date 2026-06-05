#!/bin/sh
# /usr/share/dwtool/imei_manager.sh
# Dell DW5821e IMEI Changer — Full NV550 Flow
# Flow: read_nv → erase → reboot → wait → write → reboot → verify

PORT=$(uci -q get dwtool.global.port 2>/dev/null || echo "/dev/ttyUSB0")

if [ ! -c "$PORT" ] && [ "$1" != "convert" ]; then
	echo '{"status":"error","message":"Modem serial port not found."}'
	exit 1
fi

# AT command helper (no timeout — sms_tool has its own)
run_at() {
	sms_tool -d "$PORT" at "$1" 2>/dev/null
}

# Detached reboot via start-stop-daemon
fire_reboot() {
	local script="/tmp/_imei_cfun_$$.sh"
	printf '#!/bin/sh\nsleep 1\nsms_tool -d "%s" at "AT+CFUN=1,1" >/dev/null 2>&1\nrm -f "%s"\n' \
		"$PORT" "$script" > "$script"
	chmod +x "$script"
	start-stop-daemon -b -S -x "$script" -- 2>/dev/null
}

# 3GPP BCD encoding for Qualcomm NV550
# Prepend "80A", split into byte pairs, swap nibbles
# e.g. 863147047844704 → 80A863147047844704
#      pairs: 80,A8,63,14,70,47,84,47,04
#      swap:  08,8A,36,41,07,74,48,74,40
imei_to_hex() {
	local imei="$1"
	if ! echo "$imei" | grep -qE '^[0-9]{15}$'; then echo "ERROR"; return 1; fi
	local raw="80A${imei}"
	local out=""
	local i=1
	while [ "$i" -le 17 ]; do
		local c1=$(echo "$raw" | cut -c"$i")
		local c2=$(echo "$raw" | cut -c"$((i+1))")
		if [ -n "$out" ]; then
			out="${out},${c2}${c1}"
		else
			out="${c2}${c1}"
		fi
		i=$((i+2))
	done
	echo "$out"
}

case "$1" in
	"get")
		# Use ATI to read IMEI (most reliable on DW5821e)
		imei=$(run_at "ATI" | grep -i 'IMEI:' | grep -oE '[0-9]{15}' | head -1)
		# Fallback to AT+GSN
		[ -z "$imei" ] && imei=$(run_at "AT+GSN" | grep -oE '[0-9]{15}' | head -1)
		if [ -z "$imei" ] || echo "$imei" | grep -qE '^0+$'; then
			echo '{"status":"error","message":"IMEI is blank or unreadable."}'
		else
			echo "{\"status\":\"success\",\"imei\":\"$imei\"}"
		fi
		;;

	"read_nv")
		# Read raw NV550 data
		res=$(run_at "AT^NV=550")
		logger -t dwtool-imei "Reading NV550 data. Response: $(echo "$res" | tr -d '\r\n')"
		if echo "$res" | grep -qi "nv_item_550"; then
			hex=$(echo "$res" | grep -i 'nv_item_550' | sed 's/.*nv_item_550[, ]*//' | tr -d '\r')
			# Check if first byte is 00 or empty (no IMEI)
			first=$(echo "$hex" | cut -d',' -f1 | tr -d ' ')
			if [ "$first" = "00" ] || [ -z "$first" ]; then
				echo '{"status":"empty","message":"NV550 is empty (no IMEI data)."}'
			else
				echo "{\"status\":\"success\",\"hex\":\"$hex\"}"
			fi
		else
			echo '{"status":"empty","message":"NV550 not readable or cleared."}'
		fi
		;;

	"erase")
		# Clear NV550 IMEI data
		logger -t dwtool-imei "Erasing NV550 (AT^NV=550,\"0\")"
		run_at 'AT^NV=550,"0"' >/dev/null
		# Verify erasure
		sleep 1
		res=$(run_at "AT^NV=550")
		logger -t dwtool-imei "Erasure verification response: $(echo "$res" | tr -d '\r\n')"
		if echo "$res" | grep -qi "ERROR"; then
			echo '{"status":"success","message":"NV550 erased (confirmed: ERROR)."}'
		elif echo "$res" | grep -qi "nv_item_550"; then
			first=$(echo "$res" | grep -i 'nv_item_550' | sed 's/.*nv_item_550[, ]*//' | cut -d',' -f1 | tr -d ' \r')
			if [ "$first" = "00" ] || [ -z "$first" ]; then
				echo '{"status":"success","message":"NV550 erased (confirmed: zeroed)."}'
			else
				echo '{"status":"error","message":"NV550 erase may have failed. Data still present."}'
			fi
		else
			echo '{"status":"success","message":"NV550 erase command sent."}'
		fi
		;;

	"write")
		imei="$2"
		if ! echo "$imei" | grep -qE '^[0-9]{15}$'; then
			logger -t dwtool-imei "Write rejected: invalid IMEI format ($imei)"
			echo '{"status":"error","message":"Invalid IMEI. Must be 15 digits."}'; exit 1
		fi
		hex=$(imei_to_hex "$imei")
		if [ "$hex" = "ERROR" ]; then
			logger -t dwtool-imei "Write rejected: BCD conversion failed"
			echo '{"status":"error","message":"BCD conversion failed."}' && exit 1
		fi
		logger -t dwtool-imei "Writing IMEI $imei (hex: $hex) to NV550"
		run_at "AT^NV=550,9,\"$hex\"" >/dev/null
		echo "{\"status\":\"success\",\"imei\":\"$imei\",\"hex\":\"$hex\",\"message\":\"IMEI written to NV550.\"}"
		;;

	"reboot")
		logger -t dwtool-imei "Triggering detached modem reboot (AT+CFUN=1,1)..."
		fire_reboot
		echo '{"status":"success","message":"Reboot scheduled."}'
		;;

	"convert")
		hex=$(imei_to_hex "$2")
		[ "$hex" = "ERROR" ] && echo '{"status":"error","message":"Invalid IMEI."}' && exit 1
		echo "{\"status\":\"success\",\"hex\":\"$hex\"}"
		;;

	*)
		echo '{"status":"error","message":"Unknown command."}'; exit 1
		;;
esac
