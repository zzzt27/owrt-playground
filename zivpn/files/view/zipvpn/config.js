'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require network';

var DEFAULT_OBFS  = 'hu``hqb`c';
var DEFAULT_PORTS = '6000-7750,7751-9500,9501-11250,11251-13000,13001-14750,14751-16500,16501-18250,18251-19999';

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('zipvpn'),
            network.getNetworks(),
        ]);
    },

    render: function(data) {
        var nets = data[1] || [];
        var m, s, o;

        m = new form.Map('zipvpn', 'ZipVPN — Configuration',
            'Enter your ZipVPN account details. After saving, go to Dashboard → Start.');

        // ── ZiVPN Account ────────────────────────────────────────────────────
        s = m.section(form.NamedSection, 'main', 'global', 'ZiVPN Account');
        s.addremove = false;

        o = s.option(form.Value, 'z_server', 'Server Host',
            'Hostname or IP of your ZiVPN server (no port — port is handled by Port Ranges below)');
        o.placeholder = 'e.g.  server.zivpn.net';
        o.rmempty = false;

        o = s.option(form.Value, 'z_password', 'Server Password',
            'Your ZiVPN account password');
        o.placeholder = '(your account password)';
        o.password = true;
        o.rmempty = true;

        o = s.option(form.Value, 'z_obfs', 'Obfs Key',
            'Obfuscation key — leave as default unless your provider gives a different one');
        o.placeholder = DEFAULT_OBFS;
        o.default     = DEFAULT_OBFS;
        o.rmempty     = false;

        o = s.option(form.Value, 'z_port_ranges', 'Port Ranges',
            'Comma-separated UDP port ranges the server listens on — default works for most accounts');
        o.placeholder = DEFAULT_PORTS;
        o.default     = DEFAULT_PORTS;
        o.rmempty     = false;
        // ── WAN Interface ────────────────────────────────────────────────────
        s = m.section(form.NamedSection, 'main', 'global', 'WAN Interface');
        s.addremove = false;
        s.description = 'Choose which WAN ZipVPN uses to reach the server. ' +
            'Leave blank for automatic (uses default route).';

        o = s.option(form.ListValue, 'wan_iface', 'WAN Interface');
        o.value('', '— Auto (default route) —');

        var wanProtos = { dhcp:1, pppoe:1, qmi:1, modemmanager:1, mbim:1, ncm:1, static:1 };
        var added = {};
        nets.forEach(function(net) {
            var name  = net.getName();
            var proto = net.getProtocol ? net.getProtocol() : '';
            if (name === 'loopback' || added[name]) return;
            added[name] = true;
            var label = name;
            if (proto) label += '  (' + proto + ')';
            if (wanProtos[proto]) label += ' ↑';
            o.value(name, label);
        });
        o.default  = '';
        o.optional = true;


        // ── SOCKS5 Listen ────────────────────────────────────────────────────
        s = m.section(form.NamedSection, 'main', 'global', 'SOCKS5 Listen');
        s.addremove = false;
        s.description = 'The local SOCKS5 proxy that Mihomo / Clash connects to on this router.';

        o = s.option(form.Value, 'expose_port', 'Listen Port',
            'Default 7777. Change if this port is already in use.');
        o.placeholder = '7777';
        o.datatype    = 'port';
        o.default     = '7777';

        o = s.option(form.ListValue, 'expose_addr', 'Listen Address');
        o.value('0.0.0.0',   '0.0.0.0  —  all interfaces (LAN + router itself)');
        o.value('127.0.0.1', '127.0.0.1  —  loopback only (Mihomo on this router only)');
        o.default = '0.0.0.0';

        // ── Options ──────────────────────────────────────────────────────────
        s = m.section(form.NamedSection, 'main', 'global', 'Options');
        s.addremove = false;

        o = s.option(form.Flag, 'enabled', 'Start on boot',
            'Automatically start ZiVPN when the router boots');
        o.enabled  = '1';
        o.disabled = '0';
        o.default  = o.disabled;

        o = s.option(form.Value, 'start_delay', 'Start Delay (seconds)',
            'Wait this many seconds after boot before starting ZiVPN. ' +
            'Useful to let WAN interfaces come up first. (Default: 0 = no delay)');
        o.datatype    = 'uinteger';
        o.placeholder = '0';
        o.default     = '0';
        o.depends('enabled', '1');

        // ── Advanced Optimization (Hysteria) ─────────────────────────────────
        s = m.section(form.NamedSection, 'main', 'global', 'Advanced Optimization');
        s.addremove = false;
        s.description = 'Tune these Hysteria parameters to optimize your internet speed and fix throttling.';

        o = s.option(form.Value, 'down_mbps', 'Download Speed (Mbps)', 'Your expected max download speed in Megabits per second. (Default: 50)');
        o.datatype = 'uinteger';
        o.default  = '50';

        o = s.option(form.Value, 'up_mbps', 'Upload Speed (Mbps)', 'Your expected max upload speed in Megabits per second. (Default: 10)');
        o.datatype = 'uinteger';
        o.default  = '10';

        o = s.option(form.Flag, 'disable_mtu_discovery', 'Disable MTU Discovery', 'If true, disables Path MTU Discovery (helps on some networks).');
        o.enabled  = '1';
        o.disabled = '0';
        o.default  = o.enabled;

        o = s.option(form.Value, 'recvwindowconn', 'Receive Window (Conn)', 'Default: 65536');
        o.datatype = 'uinteger';
        o.default  = '65536';

        o = s.option(form.Value, 'recvwindow', 'Receive Window (Global)', 'Default: 262144');
        o.datatype = 'uinteger';
        o.default  = '262144';

        return m.render();
    }
});
