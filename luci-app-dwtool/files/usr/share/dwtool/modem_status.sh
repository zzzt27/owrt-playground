#!/bin/sh
# /usr/share/dwtool/modem_status.sh
# 100% native AT serial status script for Dell DW5821e
# Fully independent of mmcli/ModemManager (bypasses DBus/RPCD permission issues)
# Output: JSON

# Safeguard PATH for RPCD execution
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

PORT=$(uci -q get dwtool.global.port 2>/dev/null || echo "/dev/ttyUSB0")

if [ ! -c "$PORT" ]; then
	echo '{"error":"Modem serial port not found or not a character device"}'
	exit 1
fi

# ── 1. Query basic info ──
O_ATI=$(sms_tool -d "$PORT" at "ATI" 2>/dev/null)
manufacturer=$(echo "$O_ATI" | awk -F': ' '/Manufacturer:/ {print $2; exit}' | tr -d '\r\n')
[ -z "$manufacturer" ] && manufacturer=$(echo "$O_ATI" | head -2 | tail -1 | tr -d '\r\n')
model=$(echo "$O_ATI" | awk -F': ' '/Model:/ {print $2; exit}' | tr -d '\r\n')
revision=$(echo "$O_ATI" | awk -F': ' '/Revision:/ {print $2; exit}' | tr -d '\r\n')
imei=$(echo "$O_ATI" | awk -F': ' '/IMEI:/ {print $2; exit}' | tr -d '\r\n')
[ -z "$imei" ] && imei=$(sms_tool -d "$PORT" at "AT+GSN" 2>/dev/null | grep -oE '^[0-9]{15}' | head -1)

# ── 2. Query IMSI & ICCID ──
imsi=$(sms_tool -d "$PORT" at "AT+CIMI" 2>/dev/null | grep -oE '^[0-9]{15}' | head -1)
iccid=$(sms_tool -d "$PORT" at "AT+ICCID" 2>/dev/null | grep -oE '[0-9A-Fa-f]{19,}' | head -1)

# ── 3. Query Diagnostics (AT^DEBUG?) ──
O_DBG=$(sms_tool -d "$PORT" at "AT^DEBUG?" 2>/dev/null)

rsrp=$(echo "$O_DBG" | awk '/^RSRP:/ {print $2}' | sed 's/dBm//' | head -1 | tr -d '\r\n')
rsrq=$(echo "$O_DBG" | awk '/^RSRQ:/ {print $2}' | sed 's/dB//' | head -1 | tr -d '\r\n')
rssi=$(echo "$O_DBG" | awk '/^RSSI:/ {print $2}' | sed 's/dBm//' | head -1 | tr -d '\r\n')
sinr=$(echo "$O_DBG" | awk '/^RS-SNR:/ {print $2}' | sed 's/dB//' | head -1 | tr -d '\r\n')
[ -z "$sinr" ] && sinr=$(echo "$O_DBG" | awk '/^RS-SINR:/ {print $2}' | sed 's/dB//' | head -1 | tr -d '\r\n')

bands_cur=$(echo "$O_DBG" | awk -F: '/^BAND:/ {print $2}' | tr -d ' \r\n')
[ -n "$bands_cur" ] && bands_cur="B$bands_cur"

tech=$(echo "$O_DBG" | awk -F: '/^RAT:/ {print $2}' | tr -d ' \r\n')
[ -z "$tech" ] && tech="LTE"
state=$(echo "$O_DBG" | awk -F: '/^STATUS:/ {print $2}' | tr -d ' \r\n')
[ -z "$state" ] && state="Unknown"

# Additional 3GInfo diagnostic parameters from AT^DEBUG?
plmn=$(echo "$O_DBG" | awk -F: '/^PLMN:/ {print $2}' | tr -d ' \r\n')
tac=$(echo "$O_DBG" | awk -F: '/^TAC:/ {print $2}' | tr -d ' \r\n')
enb_pci=$(echo "$O_DBG" | grep -i "eNB ID" | cut -d: -f2- | tr -d '\r\n' | sed 's/^[ \t]*//')
rrc_status=$(echo "$O_DBG" | awk -F: '/^RRC Status:/ {print $2}' | tr -d ' \r\n')
bw_cur=$(echo "$O_DBG" | awk -F: '/^BW:/ {print $2}' | tr -d '\r\n' | sed 's/^[ \t]*//')

# Diversity antennas extraction
rx_div_raw=$(echo "$O_DBG" | grep -oE 'rx_diversity:[[:space:]]*[0-9]+[[:space:]]*\([^)]+\)' | head -1)
rx_diversity_num=$(echo "$rx_div_raw" | grep -oE 'rx_diversity:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1)
rx_diversity_ants=$(echo "$rx_div_raw" | grep -oE '\([^)]+\)' | tr -d '()\r\n')

# ── 4. CSQ Signal % calculation ──
CSQ_RAW=$(sms_tool -d "$PORT" at "AT+CSQ" 2>/dev/null | grep -oE '[0-9]+' | head -1)
signal_pct="0"
if [ -n "$CSQ_RAW" ] && [ "$CSQ_RAW" -ge 0 ] && [ "$CSQ_RAW" -le 31 ]; then
	signal_pct=$((CSQ_RAW * 100 / 31))
fi

# ── 5. Query Operator (AT+COPS?) ──
O_COPS=$(sms_tool -d "$PORT" at "AT+COPS?" 2>/dev/null)
operator=$(echo "$O_COPS" | cut -d'"' -f2 | tr -d '\r\n')
if [ -n "$operator" ]; then
	# Clean duplicates like XL Axiata XL Axiata
	first_word=$(echo "$operator" | cut -d' ' -f1)
	second_word=$(echo "$operator" | cut -d' ' -f2)
	third_word=$(echo "$operator" | cut -d' ' -f3)
	fourth_word=$(echo "$operator" | cut -d' ' -f4)
	if [ -n "$first_word" ] && [ -n "$third_word" ] && [ "$first_word $second_word" = "$third_word $fourth_word" ]; then
		operator="$first_word $second_word"
	fi
fi

# Query format 2 for numerical ID (MCCMNC)
operator_id=$(sms_tool -d "$PORT" at "AT+COPS=3,2;+COPS?" 2>/dev/null | cut -d'"' -f2 | tr -d '\r\n')
# Revert format back to 0
sms_tool -d "$PORT" at "AT+COPS=3,0" >/dev/null 2>&1

# ── 6. Query Registration (CREG / CEREG) ──
reg_status="Unknown"
c_reg=$(sms_tool -d "$PORT" at "AT+CEREG?" 2>/dev/null | grep -oE '\+CEREG:[[:space:]]*[0-9]+,[0-9]+' | grep -oE '[0-9]+$' | tr -d '\r\n')
if [ -z "$c_reg" ] || [ "$c_reg" = "Unknown" ]; then
	c_reg=$(sms_tool -d "$PORT" at "AT+CREG?" 2>/dev/null | grep -oE '\+CREG:[[:space:]]*[0-9]+,[0-9]+' | grep -oE '[0-9]+$' | tr -d '\r\n')
fi

case "$c_reg" in
	0) reg_status="Not registered, searching...";;
	1) reg_status="Registered (Home)";;
	2) reg_status="Not registered, searching...";;
	3) reg_status="Registration denied";;
	4) reg_status="Unknown";;
	5) reg_status="Registered (Roaming)";;
	*) reg_status="Unknown ($c_reg)";;
esac

# ── 7. Query Temperature (AT^TEMP?) ──
O_TEMP=$(sms_tool -d "$PORT" at "AT^TEMP?" 2>/dev/null)
temp_pa=$(echo "$O_TEMP" | grep -i "PA:" | grep -oE '[0-9]+' | head -1 | tr -d '\r\n')
temp_tsens=$(echo "$O_TEMP" | grep -i "TSENS:" | grep -oE '[0-9]+' | head -1 | tr -d '\r\n')
temp=""
if [ -n "$temp_tsens" ]; then
	temp="${temp_tsens}°C (PA: ${temp_pa}°C)"
else
	# Fallback to general TEMP
	temp=$(sms_tool -d "$PORT" at "AT+TEMP?" 2>/dev/null | grep -oE '[0-9]+' | head -1 | tr -d '\r\n')
	[ -n "$temp" ] && temp="${temp}°C"
fi

# ── 8. Query Voltage ──
volt_raw=$(sms_tool -d "$PORT" at "AT+VOLT?" 2>/dev/null | tr '\r' '\n' | grep -iv '^AT\|^OK\|^$' | head -1 | tr -d '\r\n')
volt=""
if [ -n "$volt_raw" ]; then
	uv=$(echo "$volt_raw" | grep -oE '[0-9]+')
	if [ -n "$uv" ] && [ "$uv" -gt 100000 ]; then
		volt=$(awk "BEGIN {printf \"%.2f V\", $uv/1000000}")
	else
		volt="$volt_raw"
	fi
fi

# ── 9. CA Info & Category ──
ca_info=$(sms_tool -d "$PORT" at "AT^CA_INFO?" 2>/dev/null | tr '\r' '\n' | grep -iv '^AT\|^OK\|^$\ lock' | grep -iv '^ERROR' | tr '\n' ' ')
ca_info=$(echo "$ca_info" | tr -s ' ')
lte_cat=$(sms_tool -d "$PORT" at "AT^GETLTECAT?" 2>/dev/null | tr '\r' '\n' | grep 'GETLTECAT' | grep -oE '[0-9]+' | head -1)

# ── 9.5 Query CFUN status ──
cfun=$(sms_tool -d "$PORT" at "AT+CFUN?" 2>/dev/null | grep -oE '\+CFUN:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1 | tr -d '\r\n')

# ── 10. USB Mode (QMI/MBIM) ──
usb_cfg=""
for dev in /sys/bus/usb/devices/*; do
	if [ -f "$dev/idVendor" ] && [ -f "$dev/idProduct" ]; then
		vid=$(cat "$dev/idVendor" 2>/dev/null)
		pid=$(cat "$dev/idProduct" 2>/dev/null)
		if [ "$vid" = "413c" ] && [ "$pid" = "81d7" ]; then
			usb_cfg=$(cat "$dev/bConfigurationValue" 2>/dev/null)
			break
		fi
	fi
done

# ── 11. Network Interface stats ──
SEC=""
for s in $(uci show network 2>/dev/null | grep "proto='modemmanager'" | cut -f2 -d.); do
	SEC="$s"
	break
done

conn_time="-"
rx="-"
tx="-"
iface=""
if [ -n "$SEC" ]; then
	NETUP=$(ifstatus "$SEC" 2>/dev/null | grep '"up": true')
	if [ -n "$NETUP" ]; then
		CT=$(ifstatus "$SEC" 2>/dev/null | jsonfilter -e '@.uptime' 2>/dev/null)
		if [ -n "$CT" ] && [ "$CT" -gt 0 ]; then
			D=$((CT / 86400))
			H=$((CT % 86400 / 3600))
			M=$((CT % 3600 / 60))
			S=$((CT % 60))
			conn_time=$(printf "%dd %02d:%02d:%02d" "$D" "$H" "$M" "$S")
		fi

		IFACE=$(ifstatus "$SEC" 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null)
		if [ -n "$IFACE" ]; then
			iface="$IFACE"
			rx_b=$(cat /sys/class/net/$IFACE/statistics/rx_bytes 2>/dev/null || echo 0)
			tx_b=$(cat /sys/class/net/$IFACE/statistics/tx_bytes 2>/dev/null || echo 0)
			rx=$(awk "BEGIN {v=$rx_b; if(v>1073741824) printf \"%.1f GB\",v/1073741824; else if(v>1048576) printf \"%.1f MB\",v/1048576; else printf \"%.0f KB\",v/1024}")
			tx=$(awk "BEGIN {v=$tx_b; if(v>1073741824) printf \"%.1f GB\",v/1073741824; else if(v>1048576) printf \"%.1f MB\",v/1048576; else printf \"%.0f KB\",v/1024}")
		fi
	fi
fi

# ── Output JSON ──
cat <<EOF
{
"manufacturer":"${manufacturer:-Dell Inc.}",
"model":"${model:-DW5821e}",
"revision":"${revision:-Unknown}",
"imei":"${imei:-Unknown}",
"imsi":"${imsi:-Unknown}",
"iccid":"${iccid:-Unknown}",
"state":"${state:-Unknown}",
"tech":"${tech:-Unknown}",
"signal":"${signal_pct:-0}",
"operator":"${operator:-Unknown}",
"operator_id":"${operator_id:-Unknown}",
"registration":"${reg_status:-Unknown}",
"primary_port":"${PORT}",
"bands":"${bands_cur:-Unknown}",
"rsrp":"${rsrp}",
"rsrq":"${rsrq}",
"rssi":"${rssi}",
"sinr":"${sinr}",
"temperature":"${temp}",
"voltage":"${volt}",
"ca_info":"$(echo "$ca_info" | tr -d '"')",
"lte_cat":"${lte_cat}",
"conn_time":"${conn_time}",
"rx":"${rx}",
"tx":"${tx}",
"interface":"${iface}",
"usb_cfg":"${usb_cfg}",
"cfun":"${cfun}",
"port":"${PORT}",
"plmn":"${plmn}",
"tac":"${tac}",
"enb_pci":"${enb_pci}",
"rrc_status":"${rrc_status}",
"bandwidth":"${bw_cur}",
"rx_diversity_num":"${rx_diversity_num}",
"rx_diversity_ants":"${rx_diversity_ants}"
}
EOF
