#!/bin/sh
# /usr/share/dwtool/switch_qmi.sh
# Manually switch Dell DW5821e USB configuration mode
# Usage: /usr/share/dwtool/switch_qmi.sh [qmi|mbim]

MODE=$1
if [ "$MODE" = "mbim" ]; then
	TARGET=2
	logger -t dw5821e-qmi "Manual switch: targeting MBIM (cfg=2)"
else
	TARGET=1
	logger -t dw5821e-qmi "Manual switch: targeting QMI (cfg=1)"
fi

found=0
for dev in /sys/bus/usb/devices/*; do
	if [ -f "$dev/idVendor" ] && [ -f "$dev/idProduct" ]; then
		vid=$(cat "$dev/idVendor" 2>/dev/null)
		pid=$(cat "$dev/idProduct" 2>/dev/null)
		if [ "$vid" = "413c" ] && [ "$pid" = "81d7" ]; then
			found=1
			# Unbind drivers
			for intf in "$dev"/*:*; do
				[ -d "$intf" ] || continue
				[ -L "$intf/driver" ] || continue
				intf_name=$(basename "$intf")
				driver_path=$(readlink -f "$intf/driver")
				logger -t dw5821e-qmi "  unbinding $intf_name"
				echo "$intf_name" > "$driver_path/unbind" 2>/dev/null
			done
			sleep 1
			# Write target configuration
			echo "$TARGET" > "$dev/bConfigurationValue" 2>/dev/null
			sleep 2
			new_cfg=$(cat "$dev/bConfigurationValue" 2>/dev/null)
			echo "Switched to cfg=$new_cfg"
			exit 0
		fi
	fi
done

if [ "$found" -eq 0 ]; then
	echo "Error: Dell DW5821e modem not found on USB bus."
	exit 1
fi
