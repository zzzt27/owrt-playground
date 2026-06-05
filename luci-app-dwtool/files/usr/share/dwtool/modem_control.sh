#!/bin/sh
# /usr/share/dwtool/modem_control.sh
# Dell DW5821e Control Actions Script (Simplified commands with diagnostics)

ACTION="$1"
PORT=$(uci -q get dwtool.global.port 2>/dev/null || echo "/dev/ttyUSB0")

logger -t dwtool-control "Executing action: $ACTION"

case "$ACTION" in
	"renew")
		logger -t dwtool-control "Attempting to renew IP by restarting network interfaces..."
		# Find network interfaces matching modem protocols
		interfaces=$(uci show network 2>/dev/null | grep -E "proto='(modemmanager|qmi|mbim)'" | cut -f2 -d.)
		if [ -z "$interfaces" ]; then
			interfaces="wan wwan"
		fi
		for iface in $interfaces; do
			logger -t dwtool-control "Restarting network interface: $iface"
			/sbin/ifdown "$iface"
			sleep 2
			/sbin/ifup "$iface"
		done
		echo "OK"
		;;
		
	"airplane_on")
		logger -t dwtool-control "Enabling Airplane Mode (AT+CFUN=4)"
		sms_tool -d "$PORT" at "AT+CFUN=4" >/dev/null 2>&1
		echo "OK"
		;;
		
	"airplane_off")
		logger -t dwtool-control "Disabling Airplane Mode (AT+CFUN=1)"
		sms_tool -d "$PORT" at "AT+CFUN=1" >/dev/null 2>&1
		echo "OK"
		;;

	"softreboot")
		logger -t dwtool-control "Soft resetting modem processor (AT^RESET)"
		sms_tool -d "$PORT" at "AT^RESET" >/dev/null 2>&1
		echo "OK"
		;;

	"hardreboot")
		logger -t dwtool-control "Hard rebooting modem (AT+CFUN=1,1)"
		sms_tool -d "$PORT" at "AT+CFUN=1,1" >/dev/null 2>&1
		echo "OK"
		;;

	"get_mihomo_proxies")
		api_url="$2"
		secret="$3"
		headers=""
		if [ -n "$secret" ] && [ "$secret" != "none" ]; then
			headers="-H \"Authorization: Bearer $secret\""
		fi
		out=$(eval "curl -s -m 4 $headers \"$api_url/proxies\"" 2>&1)
		if [ $? -eq 0 ]; then
			echo "$out"
		else
			echo "ERROR: $out"
		fi
		;;

	"test_proxy_delay")
		api_url="$2"
		secret="$3"
		proxy_name="$4"
		headers=""
		if [ -n "$secret" ] && [ "$secret" != "none" ]; then
			headers="-H \"Authorization: Bearer $secret\""
		fi
		encoded=$(echo "$proxy_name" | sed 's| |%20|g')
		out=$(eval "curl -s -m 6 $headers \"${api_url}/proxies/${encoded}/delay?timeout=5000&url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204\"" 2>&1)
		if [ $? -eq 0 ]; then
			echo "$out"
		else
			echo "ERROR: $out"
		fi
		;;

	"test_connection")
		method="$2"
		interface="$3"
		target="$4"
		
		# Resolve logical interface name to physical device name (e.g. wan_dw -> wwan0)
		phys_dev=""
		if [ -n "$interface" ] && [ "$interface" != "none" ]; then
			phys_dev=$(ubus call network.interface."$interface" status 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null)
			[ -z "$phys_dev" ] && phys_dev="$interface"
		fi

		# Determine the TOS value from Nikki's bypass_dscp set dynamically (default to 16)
		tos_val=16
		if command -v nft >/dev/null 2>&1; then
			dscp_hex=$(nft list set inet nikki bypass_dscp 2>/dev/null | grep -oE '0x[0-9a-fA-F]+' | head -n 1)
			if [ -n "$dscp_hex" ]; then
				dscp_dec=$(printf "%d" "$dscp_hex" 2>/dev/null)
				if [ -n "$dscp_dec" ] && [ "$dscp_dec" -gt 0 ] 2>/dev/null; then
					tos_val=$((dscp_dec * 4))
				fi
			fi
		fi

		# Clean up any leftover rules from table 40 first just in case
		ip rule del table 40 2>/dev/null
		ip route del default table 40 2>/dev/null

		# Extract host/domain
		clean_host=$(echo "$target" | sed -E 's|https?://||' | cut -d/ -f1 | cut -d: -f1)
		
		# Resolve real IP via Cloudflare DoH (bypassing local DNS hijackers like Nikki/Clash)
		real_ip=""
		if ! echo "$clean_host" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
			real_ip=$(curl -s -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=$clean_host&type=A" 2>/dev/null | grep -oE '"data":"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | cut -d'"' -f4)
		fi

		# Determine the bypass IP target
		bypass_ip=""
		if [ -n "$real_ip" ]; then
			bypass_ip="$real_ip"
		elif echo "$clean_host" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
			bypass_ip="$clean_host"
		fi

		case "$method" in
			"ping")
				ping_target="${real_ip:-$clean_host}"
				if [ -n "$bypass_ip" ]; then
					ip rule add to "$bypass_ip" table main pref 10 2>/dev/null
				fi
				
				cmd="ping -c 2 -W 3 -Q $tos_val"
				if [ -n "$phys_dev" ] && [ "$phys_dev" != "none" ]; then
					cmd="$cmd -I $phys_dev"
				fi
				
				out=$(eval "$cmd $ping_target" 2>&1)
				code=$?
				
				if [ -n "$bypass_ip" ]; then
					ip rule del to "$bypass_ip" table main pref 10 2>/dev/null
				fi
				
				if [ $code -eq 0 ]; then
					echo "SUCCESS: Connection established"
				else
					echo "FAILED: $out"
				fi
				;;
				
			"curl")
				case "$target" in
					http://*|https://*) ;;
					*) target="https://$target" ;;
				esac
				
				if [ -n "$bypass_ip" ]; then
					ip rule add to "$bypass_ip" table main pref 10 2>/dev/null
				fi
				
				cmd="curl -I -s --connect-timeout 4 --ip-tos $tos_val"
				if [ -n "$real_ip" ]; then
					port=443
					echo "$target" | grep -q '^http://' && port=80
					cmd="$cmd --resolve $clean_host:$port:$real_ip"
				fi
				if [ -n "$phys_dev" ] && [ "$phys_dev" != "none" ]; then
					cmd="$cmd --interface $phys_dev"
				fi
				
				out=$(eval "$cmd \"$target\"" 2>&1)
				code=$?
				
				if [ -n "$bypass_ip" ]; then
					ip rule del to "$bypass_ip" table main pref 10 2>/dev/null
				fi
				
				if [ $code -eq 0 ]; then
					echo "SUCCESS: Connection established"
				else
					echo "FAILED: $out"
				fi
				;;
				
			"wget")
				case "$target" in
					http://*|https://*) ;;
					*) target="https://$target" ;;
				esac
				
				if [ -n "$bypass_ip" ]; then
					ip rule add to "$bypass_ip" table main pref 10 2>/dev/null
				fi
				
				cmd="wget -q --spider --timeout=4"
				out=$(eval "$cmd \"$target\"" 2>&1)
				code=$?
				
				if [ -n "$bypass_ip" ]; then
					ip rule del to "$bypass_ip" table main pref 10 2>/dev/null
				fi
				
				if [ $code -eq 0 ]; then
					echo "SUCCESS: Connection established"
				else
					echo "FAILED: $out"
				fi
				;;
				
			*)
				echo "FAILED: Unknown check method '$method'"
				;;
		esac
		;;

	"clear_watchdog_log")
		echo "" > /tmp/dwtool-watchdog.log
		echo "OK"
		;;

	*)
		echo "Usage: $0 {renew|airplane_on|airplane_off|softreboot|hardreboot|get_mihomo_proxies|test_proxy_delay|test_connection|clear_watchdog_log}"
		exit 1
		;;
esac
