'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var callLog      = rpc.declare({ object:'zipvpn', method:'log',      expect:{ lines:'' } });
var callClearLog = rpc.declare({ object:'zipvpn', method:'clearlog', expect:{} });

return view.extend({

    load: function() {
        return callLog()
            .catch(function() { return { lines: '' }; });
    },

    render: function(data) {
        var logText = (typeof data === 'string') ? data.replace(/\|/g, '\n') : '(no log yet)';

        var logEl = E('textarea', {
            id: 'zpvpn-log-view',
            readonly: true,
            style: [
                'width:100%', 'height:500px', 'resize:vertical',
                'font-family:monospace', 'font-size:12px',
                'background:#1a1a1a', 'color:#aef',
                'border:1px solid #555', 'border-radius:3px',
                'padding:8px', 'box-sizing:border-box',
            ].join(';'),
        }, logText);

        // Scroll to bottom on load
        setTimeout(function() {
            if (logEl.scrollHeight) logEl.scrollTop = logEl.scrollHeight;
        }, 100);

        var view = E('div', {}, [
            E('div', { class:'cbi-section' }, [
                E('div', { style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' }, [
                    E('h3', { style:'margin:0' }, 'ZipVPN Log'),
                    E('div', { style:'display:flex;gap:6px' }, [
                        E('button', {
                            class: 'btn btn-xs btn-default',
                            click: function() {
                                callClearLog();
                                document.getElementById('zpvpn-log-view').value = '';
                            }
                        }, 'Clear'),
                        E('button', {
                            class: 'btn btn-xs btn-default',
                            click: function() {
                                return callFileRead('/etc/zipvpn/run/zivpn.log')
                                    .catch(function(){ return { data:'' }; })
                                    .then(function(r) {
                                        var el = document.getElementById('zpvpn-log-view');
                                        if (el) {
                                            el.value = (r && r.data) ? r.data : '(no log)';
                                            el.scrollTop = el.scrollHeight;
                                        }
                                    });
                            }
                        }, '↻ Refresh'),
                    ]),
                ]),
                E('p', { style:'color:#888;font-size:12px;margin:0 0 6px' },
                    'Auto-refreshes every 5 seconds. Scroll up to see older entries.'),
                logEl,
            ]),
        ]);

        // Auto-poll
        poll.add(L.bind(function() {
            return callLog()
                .catch(function(){ return ''; })
                .then(function(r) {
                    var el = document.getElementById('zpvpn-log-view');
                    if (!el) return;
                    var atBot = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                    el.value = (typeof r === 'string' && r.length > 0) ? r.replace(/\|/g, '\n') : '(no log)';
                    if (atBot) el.scrollTop = el.scrollHeight;
                });
        }, this), 5);

        return view;
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null,
});
