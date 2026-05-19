'use strict';
'require view';
'require rpc';
'require uci';
'require ui';
'require poll';

// ── RPC declarations — all calls go through the custom zipvpn rpcd handler ──
// /usr/libexec/rpcd/zipvpn — runs as root, no file exec ACL needed
var callStatus   = rpc.declare({ object:'zipvpn', method:'status',   expect:{} });
var callStart    = rpc.declare({ object:'zipvpn', method:'start',    expect:{} });
var callStop     = rpc.declare({ object:'zipvpn', method:'stop',     expect:{} });
var callRestart  = rpc.declare({ object:'zipvpn', method:'restart',  expect:{} });
var callDownload = rpc.declare({ object:'zipvpn', method:'download', expect:{} });
var callClearLog = rpc.declare({ object:'zipvpn', method:'clearlog', expect:{} });

var callLog      = rpc.declare({ object:'zipvpn', method:'log',      expect:{ lines:'' } });

return view.extend({

    _dlActive: false,

    load: function() {
        return Promise.all([
            uci.load('zipvpn'),
            callStatus().catch(function(){ return {}; }),
            callLog().catch(function(){ return { lines:'' }; }),
        ]);
    },

    render: function(data) {
        var self       = this;
        var st         = data[1] || {};
        var logText    = (typeof data[2] === 'string') ? data[2].replace(/\|/g, '\n') : '(no log yet)';

        var running    = st.running  === true;
        var hasBin     = st.has_bin  === true;
        var binVer     = st.version  || '1.5.0';
        var dlProgress = st.progress || '';

        var exposePort = uci.get('zipvpn','main','expose_port') || '7777';
        var exposeAddr = uci.get('zipvpn','main','expose_addr') || '0.0.0.0';
        var zServer    = uci.get('zipvpn','main','z_server')   || '';
        var zPort      = uci.get('zipvpn','main','z_port')     || '';
        var wanIface   = uci.get('zipvpn','main','wan_iface')  || '';
        var configured = zServer.length > 0;

        // Resume download progress state if a download was in-progress
        var dlParts = dlProgress.trim().split(' ');
        var dlState = dlParts[0] || '';
        if (dlState === 'DOWNLOADING' || dlState === 'STARTING') {
            this._dlActive = true;
        }

        // ── Helpers ────────────────────────────────────────────────────────────
        function row(label, val) {
            return E('tr', {}, [
                E('td', { style:'width:150px;color:#888;padding:4px 8px 4px 0;font-size:13px;vertical-align:middle' }, label),
                E('td', { style:'padding:4px 0;font-size:13px' }, [val]),
            ]);
        }

        var pulseStyle = running ? 'animation: pulse 2s infinite; ' : '';
        var svcBadge = running
            ? E('span', { id:'zpvpn-badge', class:'label', style: pulseStyle + 'background-color:#28a745; color:#fff;' }, '● RUNNING')
            : E('span', { id:'zpvpn-badge', class:'label label-danger'  }, '● STOPPED');

        var cfgWarn = !configured
            ? E('span', { class:'label label-warning', style:'margin-left:6px' }, '! Configure server — go to Configuration tab')
            : E('span');

        // ── Binary cell — badge or progress bar ────────────────────────────────
        var binCell = E('td', { id:'zpvpn-bin-cell', style:'padding:4px 0;font-size:13px' });
        if (this._dlActive) {
            binCell.appendChild(self._buildProgress(dlParts));
        } else if (hasBin) {
            binCell.appendChild(E('code', {}, 'Version: ' + binVer));
            binCell.appendChild(document.createTextNode('  '));
            binCell.appendChild(E('button', {
                class: 'btn btn-xs btn-default',
                style: 'margin-left:8px',
                click: L.bind(self._download, self),
            }, '↻ Re-download'));
        } else {
            binCell.appendChild(E('span', { class:'label label-danger' }, '✗ Not downloaded'));
            binCell.appendChild(document.createTextNode('  '));
            binCell.appendChild(E('button', {
                class: 'btn btn-xs btn-default',
                click: L.bind(self._download, self),
            }, '⬇ Download Binary'));
        }

        // ── Control buttons ────────────────────────────────────────────────────
        var btnStart   = E('button', { id:'zpvpn-btn-start',   class:'btn btn-sm btn-success', click: L.bind(self._doStart,   self) }, 'Start');
        var btnStop    = E('button', { id:'zpvpn-btn-stop',    class:'btn btn-sm btn-danger',  click: L.bind(self._doStop,    self) }, 'Stop');
        var btnRestart = E('button', { id:'zpvpn-btn-restart', class:'btn btn-sm btn-default', click: L.bind(self._doRestart, self) }, 'Restart');

        if (running) {
            btnStart.disabled = true;
        } else {
            btnStop.disabled = true;
            btnRestart.disabled = true;
        }

        if (!hasBin || !configured) { btnStart.disabled = true; }

        // ── SOCKS5 snippet ─────────────────────────────────────────────────────
        var listenHost = exposeAddr === '0.0.0.0' ? '10.10.10.1' : exposeAddr;
        var copySnippet = 'proxies:\n' +
                          '  - name: "zivpn"\n' +
                          '    type: socks5\n' +
                          '    server: ' + listenHost + '\n' +
                          '    port: ' + exposePort + '\n' +
                          '    udp: true';

        var snippetNode = E('pre', { 
            style: 'background:#1e1e1e; color:#d4d4d4; padding:12px 14px; border-radius:6px; font-family:Consolas, monospace; font-size:13px; line-height:1.6; margin:8px 0; overflow-x:auto; border: 1px solid #333;'
        }, copySnippet);

        // ── Log textarea ───────────────────────────────────────────────────────
        var logEl = E('textarea', {
            id: 'zpvpn-log',
            readonly: true,
            style: [
                'width:100%', 'height:200px', 'resize:vertical',
                'font-family:monospace', 'font-size:11px',
                'background:#1a1a1a', 'color:#aef',
                'border:1px solid #555', 'border-radius:3px',
                'padding:6px', 'box-sizing:border-box',
            ].join(';'),
        }, logText);

        // ── Assemble page ──────────────────────────────────────────────────────
        var view = E('div', {}, [
            // Inject CSS for pulse animation
            E('style', {}, '\
                @keyframes pulse {\
                    0% { opacity: 1; }\
                    50% { opacity: 0.6; }\
                    100% { opacity: 1; }\
                }\
            '),

            E('div', { class:'cbi-section' }, [
                E('h3', {}, 'Status'),
                E('table', { class:'table' }, [
                    E('tbody', {}, [
                        row('Service',  E('span', {}, [svcBadge, cfgWarn])),
                        E('tr', {}, [
                            E('td', { style:'width:150px;color:#888;padding:4px 8px 4px 0;font-size:13px;vertical-align:middle;' }, 'Binary'),
                            binCell,
                        ]),
                        row('SOCKS5',   running
                            ? E('code', {}, exposeAddr + ':' + exposePort)
                            : E('span', { style:'color:#888' }, '–')),
                        row('WAN',      wanIface
                            ? E('code', {}, wanIface)
                            : E('span', { style:'color:#888' }, 'auto (default route)')),
                        row('Server',   configured
                            ? E('code', {}, zServer + (zPort ? ':' + zPort : ''))
                            : E('em', { style:'color:#888' }, 'not configured')),
                    ]),
                ]),
                E('div', { style:'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap' }, [
                    btnStart, btnStop, btnRestart,
                ]),
            ]),

            // SOCKS5 snippet — only when running
            running ? E('div', { class:'cbi-section' }, [
                E('h3', {}, 'SOCKS5 — Add to Mihomo'),
                snippetNode,
                E('button', {
                    class:'btn btn-xs btn-default',
                    click: function() {
                        try {
                            var ta = document.createElement('textarea');
                            ta.value = copySnippet;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            ui.addNotification(null, E('p', 'Copied to clipboard!'), 'info');
                        } catch(e) {
                            ui.addNotification(null, E('p', 'Failed to copy'), 'danger');
                        }
                    }
                }, '📋 Copy Snippet'),
            ]) : E('div'),

            E('div', { class:'cbi-section' }, [
                E('div', { style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
                    E('h3', { style:'margin:0' }, 'Log'),
                    E('button', {
                        class:'btn btn-xs btn-default',
                        click: function() {
                            callClearLog();
                            var el = document.getElementById('zpvpn-log');
                            if (el) el.value = '';
                        }
                    }, 'Clear'),
                ]),
                logEl,
            ]),
        ]);

        // ── Poll every 2s: status + log + download progress ───────────────────
        poll.add(L.bind(function() {
            return Promise.all([
                callStatus().catch(function(){ return {}; }),
                callLog().catch(function(){ return { lines:'' }; }),
            ]).then(function(r) {
                var st2 = r[0] || {};
                var isRunning  = st2.running  === true;
                var isStarting = st2.starting === true;

                // Update status badge
                var badge = document.getElementById('zpvpn-badge');
                if (badge) {
                    if (isRunning) {
                        badge.className = 'label';
                        badge.style.cssText = 'animation:pulse 2s infinite;background-color:#28a745;color:#fff;';
                        badge.textContent = '● RUNNING';
                    } else if (isStarting) {
                        badge.className = 'label';
                        badge.style.cssText = 'background-color:#f0ad4e;color:#fff;';
                        badge.textContent = '● STARTING...';
                    } else {
                        badge.className = 'label label-danger';
                        badge.style.cssText = '';
                        badge.textContent = '● STOPPED';
                    }
                }

                // Update button states
                var bStart = document.getElementById('zpvpn-btn-start');
                var bStop  = document.getElementById('zpvpn-btn-stop');
                var bRest  = document.getElementById('zpvpn-btn-restart');
                if (bStart && bStop && bRest) {
                    var busy = isRunning || isStarting;
                    bStart.disabled = busy || !st2.has_bin;
                    bStop.disabled  = !isRunning && !isStarting;
                    bRest.disabled  = !isRunning;
                    // Reset button text after action completes
                    if (bStart.textContent === 'Starting...' && isRunning) bStart.textContent = 'Start';
                    if (bStop.textContent === 'Stopping...' && !isRunning && !isStarting) bStop.textContent = 'Stop';
                    if (bRest.textContent === 'Restarting...' && isRunning) bRest.textContent = 'Restart';
                }

                // Update log
                var el = document.getElementById('zpvpn-log');
                if (el) {
                    var atBot = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                    var parsedLog = (typeof r[1] === 'string' && r[1].length > 0) ? r[1].replace(/\|/g, '\n') : '(no log)';
                    el.value = parsedLog;
                    if (atBot) el.scrollTop = el.scrollHeight;
                }

                // Update download progress bar
                if (self._dlActive) {
                    var parts = (st2.progress || '').trim().split(' ');
                    var state = parts[0] || '';
                    self._updateProgress(parts);

                    if (state === 'SUCCESS') {
                        self._dlActive = false;
                        self._showOverlay('Download complete!');
                        setTimeout(function() {
                            self._hideOverlay();
                            self.load().then(function(data) {
                                var container = document.querySelector('.cbi-map') || document.querySelector('[data-page]');
                                if (container) {
                                    var parent = container.parentNode;
                                    var newView = self.render(data);
                                    parent.replaceChild(newView, container);
                                }
                            });
                        }, 800);
                    } else if (state === 'ERROR') {
                        self._dlActive = false;
                        var cell = document.getElementById('zpvpn-bin-cell');
                        if (cell) {
                            cell.innerHTML = '';
                            cell.appendChild(E('span', { class:'label label-danger' }, '✗ Download failed — see Log'));
                        }
                    }
                }
            });
        }, this), 2);

        return view;
    },

    // ── Progress bar builder ──────────────────────────────────────────────────
    _buildProgress: function(parts) {
        var done  = parseInt(parts[1]) || 0;
        var total = parseInt(parts[2]) || 11329536;
        var pct   = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
        var mbD   = (done  / 1048576).toFixed(1);
        var mbT   = (total / 1048576).toFixed(1);

        return E('div', { id:'zpvpn-progress-wrap', style:'min-width:280px' }, [
            E('div', { style:'font-size:12px;color:#888;margin-bottom:4px', id:'zpvpn-progress-label' },
                'Downloading…  ' + mbD + ' / ' + mbT + ' MB  (' + pct + '%)'),
            E('div', { style:'width:100%;background:#ddd;border-radius:3px;height:10px;overflow:hidden' }, [
                E('div', {
                    id: 'zpvpn-progress-bar',
                    style: 'width:' + pct + '%;height:100%;background:#5a9;border-radius:3px;transition:width 0.5s ease',
                }),
            ]),
        ]);
    },

    _updateProgress: function(parts) {
        var state = parts[0] || '';
        var done  = parseInt(parts[1]) || 0;
        var total = parseInt(parts[2]) || 11329536;
        var pct   = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
        var mbD   = (done  / 1048576).toFixed(1);
        var mbT   = (total / 1048576).toFixed(1);

        var bar   = document.getElementById('zpvpn-progress-bar');
        var label = document.getElementById('zpvpn-progress-label');
        if (!bar || !label) return;

        if (state === 'SUCCESS') {
            label.textContent = '✓ Download complete — reloading…';
            label.style.color = '#5a9';
            bar.style.width   = '100%';
        } else if (state === 'ERROR') {
            label.textContent = '✗ Download failed — see Log tab';
            label.style.color = '#c55';
            bar.style.background = '#c55';
        } else {
            label.textContent = 'Downloading…  ' + mbD + ' / ' + mbT + ' MB  (' + pct + '%)';
            bar.style.width   = pct + '%';
        }
    },

    // ── Actions ───────────────────────────────────────────────────────────────
    _download: function() {
        var self = this;
        var cell = document.getElementById('zpvpn-bin-cell');
        if (cell) {
            cell.innerHTML = '';
            cell.appendChild(self._buildProgress(['STARTING','0','11329536']));
        }
        self._dlActive = true;
        callDownload().catch(function(e) {
            self._dlActive = false;
            ui.addNotification(null, E('p', 'Failed to start download: ' + e), 'danger');
        });
    },

    _doStart: function(ev) {
        var btn = ev.target;
        btn.disabled = true;
        btn.textContent = 'Starting...';
        callStart().catch(function(e) {
            btn.disabled = false;
            btn.textContent = 'Start';
            ui.addNotification(null, E('p', 'Error: ' + e), 'danger');
        });
    },

    _doStop: function(ev) {
        var btn = ev.target;
        btn.disabled = true;
        btn.textContent = 'Stopping...';
        callStop().catch(function(e) {
            btn.disabled = false;
            btn.textContent = 'Stop';
            ui.addNotification(null, E('p', 'Error: ' + e), 'danger');
        });
    },

    _doRestart: function(ev) {
        var btn = ev.target;
        btn.disabled = true;
        btn.textContent = 'Restarting...';
        callRestart().catch(function(e) {
            btn.disabled = false;
            btn.textContent = 'Restart';
            ui.addNotification(null, E('p', 'Error: ' + e), 'danger');
        });
    },

    handleSaveApply: null,
    handleSave:      null,
    handleReset:     null,
});
