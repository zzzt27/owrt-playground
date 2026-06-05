'use strict';
'require view';
'require fs';
'require ui';
'require dom';

return view.extend({
	load: function() {
		return Promise.all([
			fs.exec('logread').then(function(res) { return res.stdout || ''; }).catch(function() { return ''; }),
			fs.read('/tmp/dwtool-watchdog.log').catch(function() { return ''; })
		]);
	},

	render: function(loadResults) {
		var self = this;
		var syslogText = loadResults[0] || '';
		var watchdogText = loadResults[1] || '';

		var logArea = E('pre', {
			id: 'dwtool-log-area',
			style: 'width:100%; height:480px; overflow-y:auto; font-family:monospace; font-size:0.9em; white-space:pre-wrap; background:transparent; color:var(--text-color-high,inherit); line-height:1.4'
		});

		var filterSelect = E('select', {
			class: 'cbi-input-select',
			change: function() {
				applyFilter(this.value);
			}
		}, [
			E('option', { value: 'all' }, 'All Modem & dwtool Logs'),
			E('option', { value: 'mm' }, 'ModemManager Logs'),
			E('option', { value: 'imei' }, 'IMEI Changer / NV550 Logs'),
			E('option', { value: 'qmi' }, 'Hotplug QMI Switch Logs (dw5821e-qmi)'),
			E('option', { value: 'telegram' }, 'Telegram Forwarder Logs (dwtool-forwarder)'),
			E('option', { value: 'boot' }, 'Boot Reset Logs (modem-atreset)'),
			E('option', { value: 'watchdog' }, 'Watchdog Logs (dwtool-watchdog)'),
			E('option', { value: 'usb' }, 'USB / Device Hotplug Logs'),
		]);

		var clearBtn = E('button', {
			class: 'btn cbi-button cbi-button-remove',
			style: 'display:none;',
			click: function(ev) {
				ev.preventDefault();
				if (confirm('Are you sure you want to clear the Watchdog logs?')) {
					fs.exec('/usr/share/dwtool/modem_control.sh', ['clear_watchdog_log']).then(function() {
						watchdogText = '';
						applyFilter('watchdog');
					});
				}
			}
		}, ['Clear Watchdog Log']);

		function applyFilter(filter) {
			var filtered = [];
			var autoScroll = (logArea.scrollTop + logArea.clientHeight >= logArea.scrollHeight - 20);

			if (filter === 'watchdog') {
				logArea.textContent = watchdogText ? watchdogText : 'No watchdog log entries found.';
				if (clearBtn) clearBtn.style.display = '';
				if (autoScroll) logArea.scrollTop = logArea.scrollHeight;
				return;
			}

			if (clearBtn) clearBtn.style.display = 'none';

			var logs = syslogText.split('\n');
			logs.forEach(function(line) {
				if (!line.trim()) return;

				var match = false;
				if (filter === 'all') {
					if (line.match(/uhttpd.*accepted login/i)) return;
					if (line.match(/ModemManager|dw5821e-qmi|dwtool-forwarder|modem-atreset|sms_tool|imei_manager|NV550|nv_item_550|CFUN|ttyUSB|dwtool-imei|dwtool-watchdog/i)) match = true;
				} else if (filter === 'mm') {
					if (line.match(/ModemManager/i)) match = true;
				} else if (filter === 'imei') {
					if (line.match(/imei_manager|NV550|nv_item_550|IMEI|CFUN|dwtool-imei|sms_tool.*at.*NV|sms_tool.*at.*GSN|sms_tool.*at.*CGSN/i)) {
						if (!line.match(/uhttpd|luci: accepted login/i)) {
							match = true;
						}
					}
				} else if (filter === 'qmi') {
					if (line.match(/dw5821e-qmi/i)) match = true;
				} else if (filter === 'telegram') {
					if (line.match(/dwtool-forwarder/i)) match = true;
				} else if (filter === 'boot') {
					if (line.match(/modem-atreset/i)) match = true;
				} else if (filter === 'usb') {
					if (line.match(/usb|ttyUSB|ttyACM|cdc_wdm|option[0-9]|dw5821|xhci/i)) match = true;
				}

				if (match) {
					filtered.push(line);
				}
			});

			if (filtered.length === 0) {
				logArea.textContent = 'No matching log entries found.';
			} else {
				logArea.textContent = filtered.join('\n');
				if (autoScroll) {
					logArea.scrollTop = logArea.scrollHeight;
				}
			}
		}

		/* Initial filter */
		applyFilter('all');
		logArea.scrollTop = logArea.scrollHeight;

		function refreshLogs() {
			return Promise.all([
				fs.exec('logread').then(function(res) { return res.stdout || ''; }).catch(function() { return ''; }),
				fs.read('/tmp/dwtool-watchdog.log').catch(function() { return ''; })
			]).then(function(res) {
				syslogText = res[0];
				watchdogText = res[1];
				applyFilter(filterSelect.value);
			}).catch(function(err) {
				logArea.textContent = 'Error loading logs: ' + err;
			});
		}

		// Setup live polling
		var pollInterval = setInterval(function() {
			var area = document.getElementById('dwtool-log-area');
			if (!area) {
				clearInterval(pollInterval);
				return;
			}
			refreshLogs();
		}, 2000);

		return E('div', { class: 'cbi-map' }, [
			E('h2', {}, 'Dell DW5821e — System Logs'),
			E('div', { class: 'cbi-map-descr' }, 'View live system and helper script logs related to the Dell DW5821e modem.'),
			E('hr'),

			E('div', { class: 'cbi-section' }, [
				E('div', { style: 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px' }, [
					E('div', { style: 'display:flex; align-items:center; gap:8px' }, [
						E('strong', {}, 'Filter logs:'),
						filterSelect
					]),
					clearBtn
				]),
				logArea
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
