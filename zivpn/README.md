# Test ZiVPN Client for OpenWrt (LuCI Dashboard)

A lightweight LuCI web interface to manage a **Hysteria V1** (QUIC/UDP) tunnel on OpenWrt.
Provides a SOCKS5 proxy that can be used as an upstream for **Mihomo / Clash**.

## Features

- 🎛️ **LuCI Dashboard** — Start/Stop/Restart with live status badge & real-time log
- ⚙️ **Configuration UI** — Server, auth, WAN interface selection, SOCKS5 listen address
- 🚀 **Advanced Optimization** — Tune `down_mbps`, `up_mbps`, receive windows, MTU discovery
- 🔄 **WAN Hotplug** — Auto re-routes when ISP changes IP (e.g. XL resets every 2h)
- 📦 **Binary Downloader** — Downloads the correct `zivpn` binary for your architecture from the dashboard
- 🔁 **Auto-start on boot** — Proper OpenWrt `init.d` + `procd` integration with configurable delay

## Quick Install

SSH into your OpenWrt router and run this single command:

```bash
wget -qO- https://raw.githubusercontent.com/zzzt27/owrt-playground/master/zivpn/installer.sh | sh
```

That's it. No extraction, no cleanup needed.

## After Installation

1. Open **LuCI → Services → ZiVPN**
2. Go to **Configuration** tab — enter your server, password, and obfs key
3. Go to **Dashboard** tab — click **Download Binary** (auto-detects your architecture)
4. Click **Start**!

## Add to Mihomo / Clash

Once running, add this to your Mihomo config:

```yaml
proxies:
  - name: "zivpn"
    type: socks5
    server: 127.0.0.1
    port: 2080
    udp: true
```

## File Structure

```
/etc/zipvpn/
├── action/
│   ├── zipvpn-start.sh        # Start script (route, bypass, launch)
│   ├── zipvpn-stop.sh         # Stop script (cleanup routes/rules)
│   └── download_bins.sh       # Binary downloader
├── core/
│   └── zivpn                  # Binary (downloaded via dashboard)
└── run/
    ├── zivpn.log              # Runtime log
    └── zivpn.pid              # PID file

/www/luci-static/resources/view/zipvpn/
├── dashboard.js               # Dashboard UI
├── config.js                  # Configuration UI
└── log.js                     # Log viewer

/usr/libexec/rpcd/zipvpn       # RPC handler
/etc/init.d/zipvpn             # Init script (procd)
/etc/hotplug.d/iface/99-zipvpn # Auto re-route on WAN change
/etc/config/zipvpn             # UCI config (created by installer)
```

## Advanced Configuration

All settings are stored in `/etc/config/zipvpn` and can be edited via LuCI or UCI:

| UCI Key | Default | Description |
|---------|---------|-------------|
| `z_server` | — | Server hostname or IP |
| `z_password` | — | Auth password |
| `z_obfs` | `hu``hqb`c` | Obfuscation key |
| `wan_iface` | (auto) | Force a specific WAN interface |
| `expose_port` | `2080` | SOCKS5 listen port |
| `expose_addr` | `127.0.0.1` | SOCKS5 listen address (localhost only) |
| `down_mbps` | `50` | Downstream bandwidth hint (Mbps) |
| `up_mbps` | `10` | Upstream bandwidth hint (Mbps) |
| `recvwindowconn` | `1048576` | Per-connection receive window |
| `recvwindow` | `4194304` | Global receive window |
| `disable_mtu_discovery` | `1` | Disable Path MTU Discovery |
| `enabled` | `0` | Auto-start on boot |
| `start_delay` | `0` | Delay (seconds) before starting on boot |

## Uninstall

```bash
/etc/init.d/zipvpn disable
/etc/init.d/zipvpn stop
rm -rf /etc/zipvpn
rm -f /etc/init.d/zipvpn
rm -f /etc/hotplug.d/iface/99-zipvpn
rm -f /usr/libexec/rpcd/zipvpn
rm -f /usr/share/luci/menu.d/luci-app-zipvpn.menu.json
rm -f /usr/share/rpcd/acl.d/luci-app-zipvpn.acl.json
rm -rf /www/luci-static/resources/view/zipvpn
rm -f /etc/config/zipvpn
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
```

## License

MIT
