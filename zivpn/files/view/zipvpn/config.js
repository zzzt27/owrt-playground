'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require network';

var DEFAULT_OBFS  = 'hu``hqb`c';
var DEFAULT_PORTS = '6000-19999';

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

        // ── DNS Resolver ─────────────────────────────────────────────────────
        s = m.section(form.NamedSection, 'main', 'global', 'DNS Resolver');
        s.addremove = false;
        s.description = 'DNS server used by ZiVPN to resolve the server hostname. ' +
            'Choose a preset or type a custom address.';

        o = s.option(form.Value, 'resolver', 'DNS Server');
        o.value('8.8.8.8:53',         'Google DNS (8.8.8.8)');
        o.value('8.8.4.4:53',         'Google DNS 2 (8.8.4.4)');
        o.value('1.1.1.1:53',         'Cloudflare (1.1.1.1)');
        o.value('1.0.0.1:53',         'Cloudflare 2 (1.0.0.1)');
        o.value('9.9.9.9:53',         'Quad9 (9.9.9.9)');
        o.value('208.67.222.222:53',   'OpenDNS (208.67.222.222)');
        o.value('119.29.29.29:53',     'DNSPod CN (119.29.29.29)');
        o.value('223.5.5.5:53',        'AliDNS (223.5.5.5)');
        o.placeholder = 'e.g. 8.8.8.8:53';
        o.default     = '8.8.8.8:53';
        o.rmempty     = false;

        // ── Options ──────────────────────────────────────────────────────────
        s = m.section(form.NamedSection, 'main', 'global', 'Options');
        s.addremove = false;

        o = s.option(form.Value, 'expose_port', 'SOCKS5 Port',
            'Local SOCKS5 proxy port that Mihomo/Clash connects to. ' +
            'Change if port 2080 is already in use.');
        o.datatype    = 'port';
        o.placeholder = '2080';
        o.default     = '2080';


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
        s.description = 'Tune these Hysteria parameters to optimize speed. ' +
            'Set Download/Upload to ~1.5x your real ISP speed for best results.';

        o = s.option(form.Value, 'down_mbps', 'Download Speed (Mbps)',
            'Bandwidth hint for the server. Set to ~1.5x your ISP download speed.');
        o.datatype = 'uinteger';
        o.default  = '50';

        o = s.option(form.Value, 'up_mbps', 'Upload Speed (Mbps)',
            'Bandwidth hint for the server. Set to ~1.5x your ISP upload speed.');
        o.datatype = 'uinteger';
        o.default  = '10';

        o = s.option(form.Flag, 'disable_mtu_discovery', 'Disable MTU Discovery',
            'Disable Path MTU Discovery. Enable this on unstable or mobile connections.');
        o.enabled  = '1';
        o.disabled = '0';
        o.default  = o.enabled;

        o = s.option(form.Value, 'recvwindowconn', 'Receive Window (Conn)',
            'Per-connection receive buffer (bytes). Affects download throughput. ' +
            'Keep Conn:Stream ratio close to 2:5. Select a preset or type a custom value.');
        o.value('65536',    'Default (64 KB)');
        o.value('1048576',  'Light (1 MB)');
        o.value('4194304',  'Medium (4 MB)');
        o.value('8388608',  'Heavy (8 MB)');
        o.value('20971520', 'Max (20 MB)');
        o.default  = '65536';
        o.rmempty  = false;

        o = s.option(form.Value, 'recvwindow', 'Receive Window (Stream)',
            'Per-stream receive buffer (bytes). Affects single-stream download speed. ' +
            'Keep Conn:Stream ratio close to 2:5. Select a preset or type a custom value.');
        o.value('262144',    'Default (256 KB)');
        o.value('524288',    'Light (512 KB)');
        o.value('2097152',   'Medium (2 MB)');
        o.value('4194304',   'Heavy (4 MB)');
        o.value('8388608',   'Max (8 MB)');
        o.default  = '262144';
        o.rmempty  = false;

        o = s.option(form.Value, 'hop_interval', 'Port Hop Interval',
            'How often to switch to a different port from your port range. ' +
            'Helps avoid throttling on some ISPs. Set to 0 or leave empty to disable.');
        o.placeholder = 'e.g. 30s, 1m';
        o.default     = '';
        o.optional    = true;

        o = s.option(form.Flag, 'fast_open', 'QUIC Fast Open (0-RTT)',
            'Send data before handshake completes. Reduces latency on reconnect, ' +
            'but slightly less secure against replay attacks.');
        o.enabled  = '1';
        o.disabled = '0';
        o.default  = o.disabled;

        o = s.option(form.Flag, 'lazy_mode', 'Lazy Mode',
            'Delay connecting to the server until the first client request. ' +
            'Saves resources when ZiVPN is idle.');
        o.enabled  = '1';
        o.disabled = '0';
        o.default  = o.disabled;

        return m.render();
    }
});
