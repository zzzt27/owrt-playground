'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require poll';

return view.extend({
	// Storage for sensitive fields masking/revealing state
	_sensitiveFields: {
		'row-imei': { full: '', masked: '', revealed: false },
		'row-imsi': { full: '', masked: '', revealed: false },
		'row-iccid': { full: '', masked: '', revealed: false }
	},

	formatCAInfo: function(caStr) {
		if (!caStr || caStr === 'None' || caStr.trim() === '') return 'None';
		var parts = [];
		var regex = /(PCC|SCC\d+)\s*info:\s*Band is\s*([A-Za-z0-9_]+),\s*Band_width is\s*([0-9.]+)\s*MHz/g;
		var match;
		while ((match = regex.exec(caStr)) !== null) {
			var band = match[2].replace('LTE_', '');
			var bw = parseFloat(match[3]);
			parts.push(band + ' (' + bw + 'MHz)');
		}
		if (parts.length > 0) {
			return parts.join(' + ');
		}
		return caStr.trim();
	},

	formatBytes: function(bytes) {
		var b = parseFloat(bytes);
		if (isNaN(b) || b <= 0) return '0 B';
		var k = 1024;
		var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		var i = Math.floor(Math.log(b) / Math.log(k));
		return (b / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
	},

	load: function() {
		return fs.exec('/usr/share/dwtool/modem_status.sh').then(function(res) {
			try { return JSON.parse(res.stdout); }
			catch(e) { return {}; }
		}).catch(function() { return {}; });
	},

	maskSensitive: function(val) {
		if (!val || val === '-') return '-';
		var str = String(val).trim();
		if (str.length <= 8) return '********';
		return str.substring(0, 6) + '******' + str.substring(str.length - 3);
	},

	updateSensitiveRow: function(id, newVal) {
		var field = this._sensitiveFields[id];
		if (!field) return;
		field.full = newVal || '-';
		field.masked = this.maskSensitive(newVal);

		var td = document.getElementById(id);
		if (!td) return;
		var valSpan = td.querySelector('.val-span');
		if (valSpan) {
			valSpan.textContent = field.revealed ? field.full : field.masked;
		}
	},

	renderSensitiveRow: function(id, label, val) {
		var field = this._sensitiveFields[id] = {
			full: val || '-',
			masked: this.maskSensitive(val),
			revealed: false
		};

		var valSpan = E('span', { class: 'val-span', style: 'font-family:monospace; font-weight:bold' }, [ field.masked ]);
		var toggleBtn = E('button', {
			class: 'btn cbi-button',
			style: 'padding:2px 8px; font-size:0.85em; margin-left:10px; min-height:0; line-height:1.2',
			click: function(ev) {
				ev.preventDefault();
				field.revealed = !field.revealed;
				valSpan.textContent = field.revealed ? field.full : field.masked;
				toggleBtn.textContent = field.revealed ? 'Hide' : 'Show';
			}
		}, ['Show']);

		return E('tr', { class: 'tr' }, [
			E('td', { class: 'td', style: 'width:40%; font-weight:bold' }, label),
			E('td', { class: 'td', id: id }, [ valSpan, toggleBtn ])
		]);
	},

	render: function(data) {
		var self = this;
		var s = data || {};

		// Gauge styling ranges
		var csqR = [
			{ min: 80,  color: '#4caf50', grade: 'Excellent' },
			{ min: 60,  color: '#8bc34a', grade: 'Good' },
			{ min: 40,  color: '#ff9800', grade: 'Fair' },
			{ min: 0,   color: '#f44336', grade: 'Poor' }
		];
		var rssiR = [
			{ min: -65,  color: '#4caf50', grade: 'Excellent' },
			{ min: -75,  color: '#8bc34a', grade: 'Good' },
			{ min: -85,  color: '#ff9800', grade: 'Fair' },
			{ min: -999, color: '#f44336', grade: 'Poor' }
		];
		var rsrpR = [
			{ min: -80,  color: '#4caf50', grade: 'Excellent' },
			{ min: -90,  color: '#8bc34a', grade: 'Good' },
			{ min: -100, color: '#ff9800', grade: 'Fair' },
			{ min: -999, color: '#f44336', grade: 'Poor' }
		];
		var rsrqR = [
			{ min: -10,  color: '#4caf50', grade: 'Excellent' },
			{ min: -15,  color: '#ff9800', grade: 'Fair' },
			{ min: -99,  color: '#f44336', grade: 'Poor' }
		];
		var sinrR = [
			{ min: 20,   color: '#4caf50', grade: 'Excellent' },
			{ min: 13,   color: '#8bc34a', grade: 'Good' },
			{ min: 0,    color: '#ff9800', grade: 'Fair' },
			{ min: -99,  color: '#f44336', grade: 'Poor' }
		];

		function updateGauge(id, val, unit, minVal, maxVal, ranges) {
			var bar = document.getElementById(id + '-bar');
			var txt = document.getElementById(id + '-val');
			var grd = document.getElementById(id + '-grade');
			if (!bar || !txt || !grd) return;

			var n = parseFloat(val);
			if (isNaN(n)) {
				bar.style.width = '0%';
				txt.textContent = '-';
				txt.style.color = 'var(--text-color-low,#999)';
				grd.textContent = '-';
				grd.style.background = 'transparent';
				grd.style.color = 'var(--text-color-low,#999)';
				return;
			}

			var color = '#999', grade = '';
			for (var i = 0; i < ranges.length; i++) {
				if (n >= ranges[i].min) { color = ranges[i].color; grade = ranges[i].grade; break; }
			}

			var pct = Math.max(0, Math.min(100, ((n - minVal) / (maxVal - minVal)) * 100));
			bar.style.width = pct + '%';
			bar.style.background = color;
			txt.textContent = n.toFixed(1) + ' ' + unit;
			txt.style.color = color;
			grd.textContent = grade;
			grd.style.background = color + '22';
			grd.style.color = color;
		}

		function signalGauge(id, label, unit) {
			return E('div', {
				style: 'padding:12px; border:1px solid var(--border-color-low,#eee); border-radius:6px; background:var(--background-color-low,rgba(0,0,0,0.02)); display:flex; flex-direction:column; gap:6px; box-shadow:0 1px 3px rgba(0,0,0,0.05)'
			}, [
				E('div', { style: 'display:flex; justify-content:space-between; align-items:center; font-weight:bold' }, [
					E('span', { style: 'font-size:1.1em; color:var(--text-color-medium,#333)' }, label),
					E('span', { id: id + '-grade', style: 'font-size:0.85em; padding:2px 8px; border-radius:12px; font-weight:bold' }, '-')
				]),
				E('div', { style: 'background:var(--background-color-medium,rgba(0,0,0,0.08)); height:12px; border-radius:6px; overflow:hidden; margin:6px 0' }, [
					E('div', { id: id + '-bar', style: 'height:100%; width:0%; background:#999; border-radius:6px; transition:width .4s' })
				]),
				E('div', { style: 'display:flex; justify-content:flex-end; font-size:1.2em' }, [
					E('strong', { id: id + '-val', style: 'color:var(--text-color-low,#999)' }, '-')
				])
			]);
		}

		function updateRow(id, val, extra) {
			var el = document.getElementById(id);
			if (!el) return;
			if (extra) {
				dom.content(el, [ String(val || '-'), ' ', E('em', { style: 'color:#999;font-size:0.9em' }, '(' + extra + ')') ]);
			} else {
				dom.content(el, [ String(val || '-') ]);
			}
		}

		function row(id, label, val, extra) {
			return E('tr', { class: 'tr' }, [
				E('td', { class: 'td', style: 'width:40%;font-weight:bold' }, label),
				E('td', { class: 'td', id: id },
					extra
						? [ String(val || '-'), ' ', E('em', { style: 'color:#999;font-size:0.9em' }, '(' + extra + ')') ]
						: [ String(val || '-') ]
				)
			]);
		}

		function handleModeSwitch(mode) {
			ui.showModal('Switching Mode...', [
				E('p', { class: 'spinning' }, 'Sending USB configuration switch command for ' + mode.toUpperCase() + '...')
			]);
			return fs.exec('/usr/share/dwtool/switch_qmi.sh', [mode]).then(function(res) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Switch request sent. The modem may take a few seconds to re-enumerate.'), 'info');
				setTimeout(function() {
					window.location.reload();
				}, 4000);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Mode switch failed: ' + err), 'error');
			});
		}

		function renderUSBButtons(usb_cfg) {
			var label = 'Unknown';
			var buttons = [];
			if (usb_cfg === '1') {
				label = 'QMI Mode (cfg=1)';
				buttons.push(E('button', {
					class: 'btn cbi-button cbi-button-action important',
					style: 'font-size:0.85em',
					click: ui.createHandlerFn(self, function() { return handleModeSwitch('mbim'); })
				}, ['Switch to MBIM']));
			} else if (usb_cfg === '2') {
				label = 'MBIM Mode (cfg=2)';
				buttons.push(E('button', {
					class: 'btn cbi-button cbi-button-action important',
					style: 'font-size:0.85em',
					click: ui.createHandlerFn(self, function() { return handleModeSwitch('qmi'); })
				}, ['Switch to QMI']));
			} else {
				label = usb_cfg ? 'Config ' + usb_cfg : 'Unknown';
				buttons.push(E('button', {
					class: 'btn cbi-button cbi-button-action',
					style: 'margin-right:5px;font-size:0.85em',
					click: ui.createHandlerFn(self, function() { return handleModeSwitch('qmi'); })
				}, ['Switch to QMI']));
				buttons.push(E('button', {
					class: 'btn cbi-button cbi-button-action',
					style: 'font-size:0.85em',
					click: ui.createHandlerFn(self, function() { return handleModeSwitch('mbim'); })
				}, ['Switch to MBIM']));
			}

			return [
				E('span', { id: 'usb-cfg-val', style: 'font-weight:bold;margin-right:15px' }, [label]),
				E('span', { id: 'usb-btn-wrap' }, buttons)
			];
		}

		var usbModeRow = E('tr', { class: 'tr' }, [
			E('td', { class: 'td', style: 'width:40%;font-weight:bold' }, 'USB Mode'),
			E('td', { class: 'td', id: 'usb-mode-field' }, renderUSBButtons(s.usb_cfg))
		]);

		/* Neighbor cells */
		var neighborBody = E('div', { id: 'neighbor-body' }, [
			E('em', { style: 'color:#888' }, 'Click "Scan Neighbors" to load.')
		]);

		function loadNeighbors() {
			var port = s.port || '/dev/ttyUSB0';
			dom.content(neighborBody, [E('em', {}, '⏳ Scanning...')]);
			fs.exec('sms_tool', ['-d', port, 'at', 'AT+VZWRSRP?']).then(function(res) {
				var lines = (res.stdout || '').replace(/\r/g, '').split('\n').filter(function(l) {
					return l.trim() && !l.match(/^OK|^AT|^\s*$/);
				});
				if (lines.length === 0) {
					dom.content(neighborBody, [E('em', { style: 'color:#888' }, 'No neighbor data available.')]);
					return;
				}
				var rows = [];
				lines.forEach(function(line) {
					var clean = line.replace(/^\+VZWRSRP:\s*/, '').trim();
					var parts = clean.split(',');
					if (parts.length >= 3) {
						var pci = parts[0].trim();
						var earfcn = parts[1].trim();
						var rsrpVal = parseFloat(parts[2].replace(/"/g, '').trim()) / 10.0;
						var color = rsrpVal >= -80 ? '#4caf50' : rsrpVal >= -100 ? '#ff9800' : '#f44336';
						rows.push(E('tr', { class: 'tr' }, [
							E('td', { class: 'td', style: 'font-weight:bold' }, pci),
							E('td', { class: 'td' }, earfcn),
							E('td', { class: 'td', style: 'color:' + color + ';font-weight:bold' }, rsrpVal.toFixed(1) + ' dBm'),
						]));
					}
				});
				dom.content(neighborBody, [
					E('table', { class: 'table' }, [
						E('tr', { class: 'tr table-titles' }, [
							E('th', { class: 'th' }, 'PCI'),
							E('th', { class: 'th' }, 'EARFCN'),
							E('th', { class: 'th' }, 'RSRP'),
						])
					].concat(rows))
				]);
			}).catch(function(err) {
				dom.content(neighborBody, [E('em', { style: 'color:red' }, 'Error: ' + err)]);
			});
		}

		/* ── Render 4 Antennas ── */
		function renderAntennas(antsStr, divNum) {
			var wrap = E('div', {
				style: 'display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-top:8px'
			});

			var values = antsStr ? antsStr.split(',') : [];
			var names = ['Antenna 1 (PRX)', 'Antenna 2 (DRX)', 'Antenna 3 (MIMO1)', 'Antenna 4 (MIMO2)'];

			for (var i = 0; i < 4; i++) {
				var rawVal = values[i] || '-256.0dBm';
				var numVal = parseFloat(rawVal);
				var active = (numVal > -140.0 && numVal < 0.0);

				var valText = active ? numVal.toFixed(1) + ' dBm' : 'Inactive';
				var color = active ? (numVal >= -85 ? '#4caf50' : '#ff9800') : 'var(--text-color-low,#888)';
				var bg = active ? (numVal >= -85 ? '#4caf5015' : '#ff980015') : 'var(--background-color-medium,rgba(0,0,0,0.05))';
				var border = active ? '1px solid ' + color : '1px dashed var(--border-color-low,#ddd)';

				wrap.appendChild(E('div', {
					style: 'padding:8px; border-radius:6px; background:' + bg + '; border:' + border + '; text-align:center'
				}, [
					E('div', { style: 'font-size:0.85em; font-weight:bold; color:var(--text-color-medium,#666); margin-bottom:4px' }, names[i]),
					E('strong', { style: 'font-size:1.1em; color:' + color }, valText)
				]));
			}
			return wrap;
		}

		function updateAntennas(antsStr, divNum) {
			var el = document.getElementById('antenna-status-wrap');
			if (el) {
				dom.content(el, renderAntennas(antsStr, divNum));
			}
		}

		function handleAirplaneToggle() {
			var port = s.port || '/dev/ttyUSB0';
			ui.showModal('Airplane Mode...', [E('p', { class: 'spinning' }, 'Checking modem state...')]);
			return fs.exec('sms_tool', ['-d', port, 'at', 'AT+CFUN?']).then(function(res) {
				var out = (res.stdout || '') + (res.stderr || '');
				var is_airplane = out.indexOf('+CFUN: 4') !== -1;
				var target_fun = is_airplane ? '1' : '4';
				var action_text = is_airplane ? 'Disabling Airplane Mode (AT+CFUN=1)...' : 'Enabling Airplane Mode (AT+CFUN=4)...';
				
				ui.showModal('Airplane Mode...', [E('p', { class: 'spinning' }, action_text)]);
				return fs.exec('sms_tool', ['-d', port, 'at', 'AT+CFUN=' + target_fun]).then(function() {
					ui.hideModal();
					ui.addNotification(null, E('p', {}, 'Airplane Mode toggled successfully.'), 'info');
					setTimeout(function() { window.location.reload(); }, 2000);
				});
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Failed to toggle Airplane Mode: ' + err), 'error');
			});
		}

		function handleSoftReboot() {
			if (!confirm('Perform Soft Reboot?')) return;
			var port = s.port || '/dev/ttyUSB0';
			ui.showModal('Soft Rebooting...', [E('p', { class: 'spinning' }, 'Sending AT^RESET...')]);
			return fs.exec('sms_tool', ['-d', port, 'at', 'AT^RESET']).then(function() {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Soft reboot command sent.'), 'info');
				setTimeout(function() { window.location.reload(); }, 5000);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Failed to soft reboot modem: ' + err), 'error');
			});
		}

		function handleModemReboot() {
			if (!confirm('Perform Hard Reboot?')) return;
			var port = s.port || '/dev/ttyUSB0';
			ui.showModal('Hard Rebooting...', [E('p', { class: 'spinning' }, 'Sending AT+CFUN=1,1...')]);
			return fs.exec('sms_tool', ['-d', port, 'at', 'AT+CFUN=1,1']).then(function() {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Hard reboot command sent.'), 'info');
				setTimeout(function() { window.location.reload(); }, 5000);
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Failed to hard reboot modem: ' + err), 'error');
			});
		}

		function handleInterfaceReset() {
			ui.showModal('Renewing Connection...', [E('p', { class: 'spinning' }, 'Renewing IP and resetting interfaces...')]);
			return fs.exec('/usr/share/dwtool/modem_control.sh', ['renew']).then(function(res) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Renew IP command sent.'), 'info');
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Failed to renew connection: ' + err), 'error');
			});
		}

		function updateAirplaneButton(cfunVal) {
			var btn = document.getElementById('btn-airplane');
			if (!btn) return;
			if (cfunVal === '4') {
				btn.textContent = 'Airplane (ON)';
				btn.style.background = '#d32f2f';
				btn.style.color = '#fff';
			} else {
				btn.textContent = 'Airplane (OFF)';
				btn.style.background = '';
				btn.style.color = '';
			}
		}

		var viewDOM = E('div', { class: 'cbi-map', id: 'map' }, [
			E('h2', {}, 'Dell DW5821e — Status'),
			E('div', { class: 'cbi-map-descr' }, 'Modem status and signal quality parsed directly from serial commands.'),

			E('div', { class: 'cbi-section' }, [
				E('h3', { class: 'cbi-section-title' }, 'Quick Controls'),
				E('div', { class: 'cbi-section-descr' }, 'Quick actions for modem state, airplane mode, and IP renewal.'),
				E('div', { class: 'cbi-section-node', style: 'padding:15px; display:flex; gap:10px; flex-wrap:wrap; background:var(--background-color-low,rgba(0,0,0,0.02)); border:1px solid var(--border-color-low,#eee); border-radius:6px' }, [
					E('button', {
						class: 'btn cbi-button cbi-button-action important',
						id: 'btn-airplane',
						click: ui.createHandlerFn(self, handleAirplaneToggle)
					}, ['Airplane']),
					E('button', {
						class: 'btn cbi-button cbi-button-action',
						click: ui.createHandlerFn(self, handleSoftReboot)
					}, ['Soft Reboot']),
					E('button', {
						class: 'btn cbi-button cbi-button-reset',
						click: ui.createHandlerFn(self, handleModemReboot)
					}, ['Hard Reboot']),
					E('button', {
						class: 'btn cbi-button',
						click: ui.createHandlerFn(self, handleInterfaceReset)
					}, ['Renew'])
				])
			]),

			E('div', { class: 'cbi-section' }, [
				E('h3', { class: 'cbi-section-title' }, 'Device'),
				E('table', { class: 'table' }, [
					row('row-manufacturer', 'Manufacturer', s.manufacturer),
					row('row-model', 'Model', s.model),
					row('row-firmware', 'Firmware', s.revision),
					self.renderSensitiveRow('row-imei', 'IMEI', s.imei),
					self.renderSensitiveRow('row-imsi', 'IMSI', s.imsi),
					self.renderSensitiveRow('row-iccid', 'ICCID', s.iccid),
					row('row-ltecat', 'LTE Category', s.lte_cat ? 'CAT ' + s.lte_cat : '-'),
					row('row-temp', 'Temperature', s.temperature),
					row('row-volt', 'Voltage', s.voltage),
					row('row-port', 'AT Port', s.port),
					usbModeRow
				])
			]),

			E('div', { class: 'cbi-section' }, [
				E('h3', { class: 'cbi-section-title' }, 'Network'),
				E('table', { class: 'table' }, (function() {
					var showTrafficModal = function() {
						fs.read('/etc/dwtool_traffic.json').then(function(content) {
							var data = {};
							try { data = JSON.parse(content) || {}; } catch(e) {}
							
							var now = new Date();
							var pad = function(n) { return (n < 10 ? '0' : '') + n; };
							var todayKey = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
							var currentMonthKey = now.getFullYear() + '-' + pad(now.getMonth() + 1);

							function getISOWeekKey(d) {
								var date = new Date(d.getTime());
								date.setHours(0, 0, 0, 0);
								date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
								var week1 = new Date(date.getFullYear(), 0, 4);
								var weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
								return date.getFullYear() + '-W' + (weekNum < 10 ? '0' : '') + weekNum;
							}
							var currentWeekKey = getISOWeekKey(now);

							var todayUsage = (data.daily && data.daily[todayKey]) || { rx: 0, tx: 0 };
							var weekUsage = (data.weekly && data.weekly[currentWeekKey]) || { rx: 0, tx: 0 };
							var monthUsage = (data.monthly && data.monthly[currentMonthKey]) || { rx: 0, tx: 0 };

							var todayTotal = todayUsage.rx + todayUsage.tx;
							var weekTotal = weekUsage.rx + weekUsage.tx;
							var monthTotal = monthUsage.rx + monthUsage.tx;

							var summaryCards = E('div', {
								style: 'display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:20px; text-align:center'
							}, [
								E('div', { style: 'padding:12px; background:rgba(0,123,255,0.06); border-radius:8px; border:1px solid rgba(0,123,255,0.15)' }, [
									E('div', { style: 'font-size:0.85em; font-weight:bold; color:var(--text-color-medium,#666); margin-bottom:4px' }, 'Today'),
									E('strong', { style: 'font-size:1.2em; color:#007bff; display:block; margin-bottom:4px' }, self.formatBytes(todayTotal)),
									E('div', { style: 'font-size:0.75em; color:#888' }, '↓ ' + self.formatBytes(todayUsage.rx) + '  ↑ ' + self.formatBytes(todayUsage.tx))
								]),
								E('div', { style: 'padding:12px; background:rgba(40,167,69,0.06); border-radius:8px; border:1px solid rgba(40,167,69,0.15)' }, [
									E('div', { style: 'font-size:0.85em; font-weight:bold; color:var(--text-color-medium,#666); margin-bottom:4px' }, 'This Week'),
									E('strong', { style: 'font-size:1.2em; color:#28a745; display:block; margin-bottom:4px' }, self.formatBytes(weekTotal)),
									E('div', { style: 'font-size:0.75em; color:#888' }, '↓ ' + self.formatBytes(weekUsage.rx) + '  ↑ ' + self.formatBytes(weekUsage.tx))
								]),
								E('div', { style: 'padding:12px; background:rgba(23,162,184,0.06); border-radius:8px; border:1px solid rgba(23,162,184,0.15)' }, [
									E('div', { style: 'font-size:0.85em; font-weight:bold; color:var(--text-color-medium,#666); margin-bottom:4px' }, 'This Month'),
									E('strong', { style: 'font-size:1.2em; color:#17a2b8; display:block; margin-bottom:4px' }, self.formatBytes(monthTotal)),
									E('div', { style: 'font-size:0.75em; color:#888' }, '↓ ' + self.formatBytes(monthUsage.rx) + '  ↑ ' + self.formatBytes(monthUsage.tx))
								])
							]);

							var dailyRows = [];
							var dailyKeys = Object.keys(data.daily || {}).sort().reverse().slice(0, 30);
							var maxDaily = 0;
							dailyKeys.forEach(function(day) {
								var total = (data.daily[day].rx || 0) + (data.daily[day].tx || 0);
								if (total > maxDaily) maxDaily = total;
							});
							dailyKeys.forEach(function(day) {
								var rx = data.daily[day].rx || 0;
								var tx = data.daily[day].tx || 0;
								var total = rx + tx;
								var pct = maxDaily > 0 ? (total / maxDaily) * 100 : 0;
								var barColor = '#007bff';
								if (pct > 75) barColor = '#d32f2f';
								else if (pct > 40) barColor = '#ff9800';

								var progressBar = E('div', {
									style: 'width:100%; height:4px; background:var(--background-color-medium,rgba(0,0,0,0.08)); border-radius:2px; margin-top:4px; overflow:hidden'
								}, [
									E('div', { style: 'width:' + pct + '%; height:100%; background:' + barColor + '; border-radius:2px' })
								]);

								dailyRows.push(E('tr', { class: 'tr' }, [
									E('td', { class: 'td', style: 'font-weight:bold' }, day),
									E('td', { class: 'td' }, self.formatBytes(rx)),
									E('td', { class: 'td' }, self.formatBytes(tx)),
									E('td', { class: 'td' }, [
										E('span', { style: 'font-weight:bold' }, self.formatBytes(total)),
										progressBar
									])
								]));
							});
							var dailyDetails = E('details', { style: 'margin-top:12px; border:1px solid var(--border-color-low,rgba(0,0,0,0.15)); border-radius:6px; background:var(--background-color-low,rgba(0,0,0,0.02)); overflow:hidden' }, [
								E('summary', { style: 'cursor:pointer; font-weight:bold; padding:10px 15px; background:var(--background-color-medium,rgba(0,0,0,0.05)); outline:none; user-select:none; border-bottom:1px solid var(--border-color-low,rgba(0,0,0,0.15))' }, '📅 Daily Details (Last 30 Days)'),
								E('div', { style: 'padding:10px; max-height:250px; overflow-y:auto; background:transparent' }, [
									E('table', { class: 'table', style: 'margin:0; width:100%; background:transparent' }, [
										E('tr', { class: 'tr table-titles' }, [
											E('th', { class: 'th' }, 'Date'),
											E('th', { class: 'th' }, 'Download'),
											E('th', { class: 'th' }, 'Upload'),
											E('th', { class: 'th' }, 'Total')
										])
									].concat(dailyRows.length ? dailyRows : [E('tr', {}, [E('td', { colspan: 4, style: 'text-align:center;color:#888' }, 'No daily data.')])]))
								])
							]);

							var weeklyRows = [];
							var weeklyKeys = Object.keys(data.weekly || {}).sort().reverse().slice(0, 12);
							var maxWeekly = 0;
							weeklyKeys.forEach(function(wk) {
								var total = (data.weekly[wk].rx || 0) + (data.weekly[wk].tx || 0);
								if (total > maxWeekly) maxWeekly = total;
							});
							weeklyKeys.forEach(function(wk) {
								var rx = data.weekly[wk].rx || 0;
								var tx = data.weekly[wk].tx || 0;
								var total = rx + tx;
								var pct = maxWeekly > 0 ? (total / maxWeekly) * 100 : 0;
								var barColor = '#28a745';
								if (pct > 75) barColor = '#d32f2f';
								else if (pct > 40) barColor = '#ff9800';

								var progressBar = E('div', {
									style: 'width:100%; height:4px; background:var(--background-color-medium,rgba(0,0,0,0.08)); border-radius:2px; margin-top:4px; overflow:hidden'
								}, [
									E('div', { style: 'width:' + pct + '%; height:100%; background:' + barColor + '; border-radius:2px' })
								]);

								weeklyRows.push(E('tr', { class: 'tr' }, [
									E('td', { class: 'td', style: 'font-weight:bold' }, wk),
									E('td', { class: 'td' }, self.formatBytes(rx)),
									E('td', { class: 'td' }, self.formatBytes(tx)),
									E('td', { class: 'td' }, [
										E('span', { style: 'font-weight:bold' }, self.formatBytes(total)),
										progressBar
									])
								]));
							});
							var weeklyDetails = E('details', { style: 'margin-top:12px; border:1px solid var(--border-color-low,rgba(0,0,0,0.15)); border-radius:6px; background:var(--background-color-low,rgba(0,0,0,0.02)); overflow:hidden' }, [
								E('summary', { style: 'cursor:pointer; font-weight:bold; padding:10px 15px; background:var(--background-color-medium,rgba(0,0,0,0.05)); outline:none; user-select:none; border-bottom:1px solid var(--border-color-low,rgba(0,0,0,0.15))' }, '📅 Weekly Details (Last 12 Weeks)'),
								E('div', { style: 'padding:10px; max-height:250px; overflow-y:auto; background:transparent' }, [
									E('table', { class: 'table', style: 'margin:0; width:100%; background:transparent' }, [
										E('tr', { class: 'tr table-titles' }, [
											E('th', { class: 'th' }, 'Week'),
											E('th', { class: 'th' }, 'Download'),
											E('th', { class: 'th' }, 'Upload'),
											E('th', { class: 'th' }, 'Total')
										])
									].concat(weeklyRows.length ? weeklyRows : [E('tr', {}, [E('td', { colspan: 4, style: 'text-align:center;color:#888' }, 'No weekly data.')])]))
								])
							]);

							var monthlyRows = [];
							var monthlyKeys = Object.keys(data.monthly || {}).sort().reverse().slice(0, 12);
							var maxMonthly = 0;
							monthlyKeys.forEach(function(mth) {
								var total = (data.monthly[mth].rx || 0) + (data.monthly[mth].tx || 0);
								if (total > maxMonthly) maxMonthly = total;
							});
							monthlyKeys.forEach(function(mth) {
								var rx = data.monthly[mth].rx || 0;
								var tx = data.monthly[mth].tx || 0;
								var total = rx + tx;
								var pct = maxMonthly > 0 ? (total / maxMonthly) * 100 : 0;
								var barColor = '#17a2b8';
								if (pct > 75) barColor = '#d32f2f';
								else if (pct > 40) barColor = '#ff9800';

								var progressBar = E('div', {
									style: 'width:100%; height:4px; background:var(--background-color-medium,rgba(0,0,0,0.08)); border-radius:2px; margin-top:4px; overflow:hidden'
								}, [
									E('div', { style: 'width:' + pct + '%; height:100%; background:' + barColor + '; border-radius:2px' })
								]);

								monthlyRows.push(E('tr', { class: 'tr' }, [
									E('td', { class: 'td', style: 'font-weight:bold' }, mth),
									E('td', { class: 'td' }, self.formatBytes(rx)),
									E('td', { class: 'td' }, self.formatBytes(tx)),
									E('td', { class: 'td' }, [
										E('span', { style: 'font-weight:bold' }, self.formatBytes(total)),
										progressBar
									])
								]));
							});
							var monthlyDetails = E('details', { style: 'margin-top:12px; border:1px solid var(--border-color-low,rgba(0,0,0,0.15)); border-radius:6px; background:var(--background-color-low,rgba(0,0,0,0.02)); overflow:hidden' }, [
								E('summary', { style: 'cursor:pointer; font-weight:bold; padding:10px 15px; background:var(--background-color-medium,rgba(0,0,0,0.05)); outline:none; user-select:none; border-bottom:1px solid var(--border-color-low,rgba(0,0,0,0.15))' }, '📅 Monthly Details (Last 12 Months)'),
								E('div', { style: 'padding:10px; max-height:250px; overflow-y:auto; background:transparent' }, [
									E('table', { class: 'table', style: 'margin:0; width:100%; background:transparent' }, [
										E('tr', { class: 'tr table-titles' }, [
											E('th', { class: 'th' }, 'Month'),
											E('th', { class: 'th' }, 'Download'),
											E('th', { class: 'th' }, 'Upload'),
											E('th', { class: 'th' }, 'Total')
										])
									].concat(monthlyRows.length ? monthlyRows : [E('tr', {}, [E('td', { colspan: 4, style: 'text-align:center;color:#888' }, 'No monthly data.')])]))
								])
							]);

							ui.showModal('Modem Traffic Reports', [
								E('div', { style: 'max-width:600px; min-width:320px' }, [
									summaryCards,
									dailyDetails,
									weeklyDetails,
									monthlyDetails,
									E('hr'),
									E('div', { class: 'right' }, [
										E('button', { class: 'btn cbi-button', click: ui.hideModal }, ['Close'])
									])
								])
							]);
						}).catch(function() {
							ui.showModal('Traffic Usage Reports', [
								E('div', {}, [
									E('p', {}, 'No traffic logs available yet. Make sure Watchdog is enabled to log traffic.'),
									E('hr'),
									E('div', { class: 'right' }, [
										E('button', { class: 'btn cbi-button', click: ui.hideModal }, ['Close'])
									])
								])
							]);
						});
					};

					var usageValSpan = E('span', { id: 'usage-val-span' }, [ (s.rx || '-') + ' ↓  /  ' + (s.tx || '-') + ' ↑' ]);
					var usageIfaceSpan = s.interface ? E('em', { id: 'usage-iface-span', style: 'color:#999;font-size:0.9em;margin-left:8px' }, ['(Interface: ' + s.interface + ')']) : E('span');
					
					var reportsBtn = E('button', {
						class: 'btn cbi-button cbi-button-action',
						style: 'padding:2px 8px; font-size:0.85em; margin-left:12px; min-height:0; line-height:1.2',
						click: function(ev) {
							ev.preventDefault();
							showTrafficModal();
						}
					}, ['📊 Reports']);

					var usageRow = E('tr', { class: 'tr' }, [
						E('td', { class: 'td', style: 'width:40%; font-weight:bold' }, 'Data RX / TX'),
						E('td', { class: 'td', id: 'row-usage' }, [ usageValSpan, usageIfaceSpan, reportsBtn ])
					]);

					return [
						row('row-operator', 'Operator', s.operator ? s.operator + (s.operator_id ? ' (PLMN: ' + s.operator_id + ')' : '') : '-'),
						row('row-registration', 'Network Status', s.registration ? s.registration + (s.rrc_status ? ' / ' + s.rrc_status : '') + (s.tech ? ' (' + s.tech + ')' : '') : '-'),
						row('row-enb_pci', 'eNodeB (PCI)', s.enb_pci),
						row('row-bands', 'Active Bands / BW', s.bands ? s.bands + (s.bandwidth ? ' / ' + s.bandwidth : '') : '-'),
						row('row-cainfo', 'Carrier Aggregation', self.formatCAInfo(s.ca_info)),
						row('row-conntime', 'Connection Time', s.conn_time),
						usageRow
					];
				})())
			]),

			E('div', { class: 'cbi-section' }, [
				E('h3', { class: 'cbi-section-title' }, 'Signal Quality'),
				E('div', { class: 'cbi-section-descr' }, 'Live signal metrics updated every 5 seconds.'),
				// 2-Column Responsive Grid Layout (Left-Top to Right-Bottom: CSQ, RSSI, RSRP, RSRQ, SINR)
				E('div', {
					style: 'display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:15px; margin-top:12px'
				}, [
					signalGauge('csq', 'CSQ', '%'),
					signalGauge('rssi', 'RSSI', 'dBm'),
					signalGauge('rsrp', 'RSRP', 'dBm'),
					signalGauge('rsrq', 'RSRQ', 'dB'),
					signalGauge('sinr', 'SINR', 'dB')
				]),

				// Diversity Antenna Diagnostic Section
				E('div', { style: 'margin-top:20px; border-top:1px solid var(--border-color-low,#eee); padding-top:15px' }, [
					E('h4', { style: 'font-weight:bold; margin-bottom:4px; display:flex; align-items:center; gap:8px' }, [
						'Receiver Diversity (4 Antennas)',
						E('span', { id: 'rx-div-badge', style: 'font-size:0.8em; padding:2px 8px; border-radius:10px; background:rgba(0,123,255,0.15); color:#007bff; font-weight:bold' },
							s.rx_diversity_num ? 'Diversity Mode: ' + s.rx_diversity_num : 'Diversity Mode: -')
					]),
					E('div', { class: 'cbi-section-descr', style: 'margin-bottom:8px' }, 'Individual RSRP values for all 4 antenna ports. A value of -256.0 dBm indicates an inactive or disconnected port.'),
					E('div', { id: 'antenna-status-wrap' }, [
						renderAntennas(s.rx_diversity_ants, s.rx_diversity_num)
					])
				])
			]),

			E('div', { class: 'cbi-section' }, [
				E('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
					E('h3', { class: 'cbi-section-title', style: 'margin:0' }, 'Neighbor Cells'),
					E('button', {
						class: 'btn cbi-button cbi-button-action',
						click: ui.createHandlerFn(this, loadNeighbors)
					}, ['Scan Neighbors'])
				]),
				E('div', { class: 'cbi-section-descr' }, 'Nearby cell towers via AT+VZWRSRP (PCI, EARFCN, RSRP).'),
				neighborBody
			])
		]);

		/* Setup initial gauges */
		setTimeout(function() {
			updateGauge('csq', s.signal, '%', 0, 100, csqR);
			updateGauge('rssi', s.rssi, 'dBm', -110, -40, rssiR);
			updateGauge('rsrp', s.rsrp, 'dBm', -140, -44, rsrpR);
			updateGauge('rsrq', s.rsrq, 'dB', -20, -3, rsrqR);
			updateGauge('sinr', s.sinr, 'dB', -10, 30, sinrR);
			updateAirplaneButton(s.cfun);
		}, 100);

		/* ── Standard Auto Polling ── */
		poll.add(function() {
			return fs.exec('/usr/share/dwtool/modem_status.sh').then(function(res) {
				try {
					var u = JSON.parse(res.stdout);
					if (u && !u.error) {
						updateGauge('csq', u.signal, '%', 0, 100, csqR);
						updateGauge('rssi', u.rssi, 'dBm', -110, -40, rssiR);
						updateGauge('rsrp', u.rsrp, 'dBm', -140, -44, rsrpR);
						updateGauge('rsrq', u.rsrq, 'dB', -20, -3, rsrqR);
						updateGauge('sinr', u.sinr, 'dB', -10, 30, sinrR);

						var usbModeField = document.getElementById('usb-mode-field');
						if (usbModeField) {
							dom.content(usbModeField, renderUSBButtons(u.usb_cfg));
						}

						// Update Antenna widget
						updateAntennas(u.rx_diversity_ants, u.rx_diversity_num);
						var divBadge = document.getElementById('rx-div-badge');
						if (divBadge) {
							divBadge.textContent = u.rx_diversity_num ? 'Diversity Mode: ' + u.rx_diversity_num : 'Diversity Mode: -';
						}

						updateRow('row-manufacturer', u.manufacturer);
						updateRow('row-model', u.model);
						updateRow('row-firmware', u.revision);
						self.updateSensitiveRow('row-imei', u.imei);
						self.updateSensitiveRow('row-imsi', u.imsi);
						self.updateSensitiveRow('row-iccid', u.iccid);
						updateRow('row-ltecat', u.lte_cat ? 'CAT ' + u.lte_cat : '-');
						updateRow('row-temp', u.temperature);
						updateRow('row-volt', u.voltage);
						updateRow('row-port', u.port);
						updateAirplaneButton(u.cfun);

						updateRow('row-operator', u.operator ? u.operator + (u.operator_id ? ' (PLMN: ' + u.operator_id + ')' : '') : '-');
						updateRow('row-registration', u.registration ? u.registration + (u.rrc_status ? ' / ' + u.rrc_status : '') + (u.tech ? ' (' + u.tech + ')' : '') : '-');
						updateRow('row-enb_pci', u.enb_pci);
						updateRow('row-bands', u.bands ? u.bands + (u.bandwidth ? ' / ' + u.bandwidth : '') : '-');
						updateRow('row-cainfo', self.formatCAInfo(u.ca_info));
						updateRow('row-conntime', u.conn_time);
						
						var valSpan = document.getElementById('usage-val-span');
						if (valSpan) valSpan.textContent = (u.rx || '-') + ' ↓  /  ' + (u.tx || '-') + ' ↑';
						var ifaceSpan = document.getElementById('usage-iface-span');
						if (ifaceSpan) ifaceSpan.textContent = u.interface ? '(Interface: ' + u.interface + ')' : '';
					}
				} catch(e) {}
			});
		}, 5);

		return viewDOM;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
