#!/bin/sh
# /usr/share/dwtool/watchdog.sh
# Watchdog daemon script for Dell DW5821e modem connectivity

export PATH="/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

# Track failures and recovery states
fail_count=0
last_enabled_state="-1"

LOG_FILE="/tmp/dwtool-watchdog.log"
log() {
	local timestamp=$(date '+%a %b %e %H:%M:%S %Y')
	# Append to our local log file
	echo "$timestamp user.notice dwtool-watchdog: $1" >> "$LOG_FILE"
	# Also write to syslog
	logger -t dwtool-watchdog "$1"

	# Truncate log file if it grows too large (> 50KB)
	if [ -f "$LOG_FILE" ]; then
		local size=$(wc -c < "$LOG_FILE")
		if [ "$size" -gt 50000 ]; then
			local tmp=$(tail -n 100 "$LOG_FILE")
			echo "$tmp" > "$LOG_FILE"
		fi
	fi
}

# Wait for system boot and initial network establishment
log "Watchdog daemon started. Waiting 30s before first run..."
sleep 30

while true; do


	# Always reload configs on every iteration to adapt dynamically
	enabled=$(uci -q get dwtool.watchdog.enabled || echo "0")
	if [ "$enabled" -ne 1 ]; then
		if [ "$last_enabled_state" != "0" ]; then
			log "Watchdog connectivity checks disabled in configuration. Traffic logger remains active."
			last_enabled_state="0"
		fi
		sleep 30
		fail_count=0
		continue
	fi
	if [ "$last_enabled_state" != "1" ]; then
		log "Watchdog connectivity checks enabled."
		last_enabled_state="1"
	fi

	interval=$(uci -q get dwtool.watchdog.check_interval || echo "60")
	retry_interval=$(uci -q get dwtool.watchdog.retry_interval || echo "10")
	check_type=$(uci -q get dwtool.watchdog.check_type || echo "direct")
	direct_method=$(uci -q get dwtool.watchdog.direct_method || echo "curl")
	if [ "$direct_method" = "ping" ]; then
		direct_target=$(uci -q get dwtool.watchdog.direct_target_ping || echo "8.8.8.8")
	else
		direct_target=$(uci -q get dwtool.watchdog.direct_target || echo "https://connectivitycheck.gstatic.com/generate_204")
	fi
	direct_interface=$(uci -q get dwtool.watchdog.direct_interface || echo "")
	failure_threshold=$(uci -q get dwtool.watchdog.failure_threshold || echo "3")
	action_type=$(uci -q get dwtool.watchdog.action_type || echo "airplane")
	enable_custom_script=$(uci -q get dwtool.watchdog.enable_custom_script || echo "0")
	custom_script=$(uci -q get dwtool.watchdog.custom_script || echo "")
	
	mihomo_api_url=$(uci -q get dwtool.watchdog.mihomo_api_url || echo "http://127.0.0.1:9090")
	mihomo_api_secret=$(uci -q get dwtool.watchdog.mihomo_api_secret || echo "")
	mihomo_proxies=$(uci -q get dwtool.watchdog.mihomo_proxy || echo "")

	# Resolve logical interface name to physical device name (e.g. wan_dw -> wwan0)
	if [ -n "$direct_interface" ]; then
		phys_dev=$(ubus call network.interface."$direct_interface" status 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null)
		if [ -n "$phys_dev" ]; then
			direct_interface="$phys_dev"
		fi
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

	# Perform connection test
	success=0

	if [ "$check_type" = "direct" ]; then
		# ── Direct Connection Test ──
		if [ "$direct_method" = "ping" ]; then
			# Extract host/IP if target is URL
			clean_target=$(echo "$direct_target" | sed -E 's|https?://||' | cut -d/ -f1 | cut -d: -f1)
			# Resolve real IP if it is a hostname
			if ! echo "$clean_target" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
				real_ip=$(curl -s -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=$clean_target&type=A" 2>/dev/null | grep -oE '"data":"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | cut -d'"' -f4)
				[ -n "$real_ip" ] && clean_target="$real_ip"
			fi
			
			if [ -n "$real_ip" ]; then
				ip rule add to "$real_ip" table main pref 10 2>/dev/null
			fi
			
			if [ -n "$direct_interface" ]; then
				ping -c 3 -W 5 -Q $tos_val -I "$direct_interface" "$clean_target" >/dev/null 2>&1
			else
				ping -c 3 -W 5 -Q $tos_val "$clean_target" >/dev/null 2>&1
			fi
			[ $? -eq 0 ] && success=1
			
			if [ -n "$real_ip" ]; then
				ip rule del to "$real_ip" table main pref 10 2>/dev/null
			fi
		elif [ "$direct_method" = "curl" ]; then
			clean_host=$(echo "$direct_target" | sed -E 's|https?://||' | cut -d/ -f1 | cut -d: -f1)
			real_ip=$(curl -s -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=$clean_host&type=A" 2>/dev/null | grep -oE '"data":"[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+"' | head -1 | cut -d'"' -f4)
			
			case "$direct_target" in
				http://*|https://*) ;;
				*) direct_target="https://$direct_target" ;;
			esac
			
			if [ -n "$real_ip" ]; then
				ip rule add to "$real_ip" table main pref 10 2>/dev/null
			fi
			
			curl_cmd="curl -I -s --connect-timeout 5 --ip-tos $tos_val"
			if [ -n "$real_ip" ]; then
				port=443
				echo "$direct_target" | grep -q '^http://' && port=80
				curl_cmd="$curl_cmd --resolve $clean_host:$port:$real_ip"
			fi
			if [ -n "$direct_interface" ]; then
				curl_cmd="$curl_cmd --interface $direct_interface"
			fi
			
			eval "$curl_cmd \"$direct_target\"" >/dev/null 2>&1
			[ $? -eq 0 ] && success=1
			
			if [ -n "$real_ip" ]; then
				ip rule del to "$real_ip" table main pref 10 2>/dev/null
			fi
		elif [ "$direct_method" = "wget" ]; then
			case "$direct_target" in
				http://*|https://*) ;;
				*) direct_target="https://$direct_target" ;;
			esac
			# Wget fallback
			wget -q --spider --timeout=5 "$direct_target" >/dev/null 2>&1
			[ $? -eq 0 ] && success=1
		fi
	elif [ "$check_type" = "mihomo" ]; then
		# ── Mihomo Proxy API Test ──
		if [ -z "$mihomo_proxies" ]; then
			log "Mihomo Proxy check failed: No proxy node configured."
			success=0
		else
			success=0
			old_ifs="$IFS"
			IFS="|"
			for proxy in $mihomo_proxies; do
				IFS="$old_ifs"
				# Trim whitespace
				proxy=$(echo "$proxy" | sed -e 's/^[ \t]*//' -e 's/[ \t]*$//')
				[ -z "$proxy" ] && continue

				# URL encode the proxy name
				encoded_proxy=$(lua -e "local s=[=[$proxy]=]; s=s:gsub('([^%w%.%-_])', function(c) return string.format('%%%02X', string.byte(c)) end); print(s)")
				url="${mihomo_api_url}/proxies/${encoded_proxy}/delay?timeout=5000&url=http%3A%2F%2Fwww.gstatic.com%2Fgenerate_204"
				
				headers=""
				if [ -n "$mihomo_api_secret" ]; then
					headers="-H \"Authorization: Bearer $mihomo_api_secret\""
				fi

				# Run check
				response=$(eval "curl -s -m 6 $headers \"$url\"")
				delay=$(echo "$response" | grep -oE '"delay":[0-9]+' | grep -oE '[0-9]+')
				
				if [ -n "$delay" ] && [ "$delay" -gt 0 ]; then
					success=1
					log "Mihomo Proxy '$proxy' is online (delay: ${delay}ms)"
					break  # Succeeded on this proxy, no need to check other fallback proxies!
				else
					log "Mihomo Proxy '$proxy' check failed. Response: $response"
				fi
				IFS="|"
			done
			IFS="$old_ifs"
		fi
	fi
	# Clean up policy routing rules
	ip rule del table 40 2>/dev/null
	ip route del default table 40 2>/dev/null

	# Process results
	if [ "$success" -eq 1 ]; then
		if [ "$check_type" = "direct" ]; then
			log "Connectivity check succeeded ($check_type via $direct_method)."
		fi
		if [ "$fail_count" -gt 0 ]; then
			log "Connectivity restored. Resetting failure counter."
			fail_count=0
		fi
	else
		fail_count=$((fail_count + 1))
		log "Connectivity check failed (failure count: $fail_count/$failure_threshold)"

		if [ "$fail_count" -ge "$failure_threshold" ]; then
			log "Threshold reached! Triggering recovery actions..."

			# 1. Primary Action
			if [ "$action_type" = "airplane" ]; then
				log "Action: Toggling Airplane Mode..."
				/usr/share/dwtool/modem_control.sh airplane_on
				sleep 5
				/usr/share/dwtool/modem_control.sh airplane_off
			elif [ "$action_type" = "softreboot" ]; then
				log "Action: Soft resetting modem (AT^RESET)..."
				/usr/share/dwtool/modem_control.sh softreboot
			elif [ "$action_type" = "hardreboot" ]; then
				log "Action: Hard rebooting modem (CFUN=1,1)..."
				/usr/share/dwtool/modem_control.sh hardreboot
			elif [ "$action_type" = "renew" ]; then
				log "Action: Renewing IP connection..."
				/usr/share/dwtool/modem_control.sh renew
			fi

			# 2. Secondary Custom Script Action
			if [ "$enable_custom_script" -eq 1 ] && [ -n "$custom_script" ]; then
				log "Action: Executing custom script..."
				eval "$custom_script" 2>&1 | while read -r line; do
					log "Custom Script: $line"
				done
			fi

			# Reset counter and wait recovery buffer
			fail_count=0
			log "Recovery executed. Sleeping 90 seconds to allow network stabilization..."
			sleep 90
			continue
		fi
	fi

	if [ "$fail_count" -gt 0 ]; then
		sleep "$retry_interval"
	else
		sleep "$interval"
	fi
done
