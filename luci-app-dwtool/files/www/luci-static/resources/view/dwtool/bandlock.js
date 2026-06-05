'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require uci';

return view.extend({
	load: function() {
		return uci.load('dwtool');
	},

	render: function() {
		var port = uci.get('dwtool', 'global', 'port') || '/dev/ttyUSB0';

		var bandsList = [
			{ id: '1',  name: 'B1 (2100 MHz)' },
			{ id: '3',  name: 'B3 (1800 MHz)' },
			{ id: '5',  name: 'B5 (850 MHz)' },
			{ id: '8',  name: 'B8 (900 MHz)' },
			{ id: '40', name: 'B40 (2300 MHz)' },
		];

		var quickCombos = [
			{ label: 'B1 & B3',          bands: ['1','3'] },
			{ label: 'B3 & B40',         bands: ['3','40'] },
			{ label: 'B1, B3 & B40',     bands: ['1','3','40'] },
			{ label: 'B1, B3, B8 & B40', bands: ['1','3','8','40'] },
		];

		var checkboxes = {};

		var bandGrid = E('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;margin:10px 0 15px' },
			bandsList.map(function(b) {
				var cb = E('input', { type: 'checkbox', id: 'band_' + b.id, value: b.id, style: 'margin-right:5px' });
				checkboxes[b.id] = cb;
				return E('label', { style: 'display:inline-flex;align-items:center;padding:5px 12px;border:1px solid #ccc;border-radius:20px;cursor:pointer;user-select:none' }, [cb, b.name]);
			})
		);

		var quickRow = E('div', { style: 'margin-bottom:15px' },
			quickCombos.map(function(q) {
				return E('button', {
					class: 'btn cbi-button',
					style: 'margin-right:5px;margin-bottom:5px',
					click: function() {
						Object.keys(checkboxes).forEach(function(k) {
							checkboxes[k].checked = q.bands.indexOf(k) !== -1;
						});
					}
				}, [q.label]);
			}).concat([
				E('button', {
					class: 'btn cbi-button cbi-button-reset',
					style: 'margin-bottom:5px',
					click: function() {
						Object.keys(checkboxes).forEach(function(k) { checkboxes[k].checked = false; });
					}
				}, ['Clear'])
			])
		);

		var output = E('pre', {
			class: 'atcommand-output',
			style: 'display:none;border:1px solid var(--border-color-medium,#ccc);border-radius:5px;font-family:monospace;padding:10px;margin-top:10px;min-height:40px;white-space:pre-wrap'
		});

		function runAt(cmd) {
			output.style.display = '';
			dom.content(output, ['⏳ Sending: ' + cmd + '...\n']);

			return fs.exec('sms_tool', ['-d', port, 'at', cmd]).then(function(res) {
				var raw = (res.stdout || '') + (res.stderr || '');
				var lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim() !== ''; });
				dom.content(output, [lines.join('\n') || 'OK / Success']);
			}).catch(function(err) {
				dom.content(output, ['Error: ' + err]);
			});
		}

		var applyBtn = E('button', {
			class: 'btn cbi-button cbi-button-apply',
			click: ui.createHandlerFn(this, function() {
				var selected = [];
				Object.keys(checkboxes).forEach(function(k) {
					if (checkboxes[k].checked) selected.push(k);
				});
				if (selected.length === 0) {
					ui.addNotification(null, E('p', {}, 'Please select at least one band.'), 'warning');
					return;
				}
				return runAt('AT^SLBAND=LTE,2,' + selected.join(','));
			})
		}, ['Apply Selected Bands']);

		var resetBtn = E('button', {
			class: 'btn cbi-button cbi-button-reset',
			style: 'margin-left:5px',
			click: ui.createHandlerFn(this, function() {
				return runAt('AT^SLBAND');
			})
		}, ['Reset All Bands']);

		var checkBtn = E('button', {
			class: 'btn cbi-button',
			style: 'margin-left:5px',
			click: ui.createHandlerFn(this, function() {
				return runAt('AT^SLBAND?');
			})
		}, ['Check Current Lock']);

		/* ── Preferred Network Mode Selection ── */
		var modeSelect = E('select', { class: 'cbi-input-select', style: 'margin-right:10px' }, [
			E('option', { value: 'AT^SLMODE=1,30' }, 'LTE (4G) Only'),
			E('option', { value: 'AT^SLMODE=1,14' }, 'WCDMA (3G) Only'),
			E('option', { value: 'AT^SLMODE=1,35' }, 'WCDMA & LTE (Auto)'),
		]);

		var applyModeBtn = E('button', {
			class: 'btn cbi-button cbi-button-apply',
			click: ui.createHandlerFn(this, function() {
				return runAt(modeSelect.value);
			})
		}, ['Apply Preferred Mode']);

		var checkModeBtn = E('button', {
			class: 'btn cbi-button',
			style: 'margin-left:5px',
			click: ui.createHandlerFn(this, function() {
				return runAt('AT^SLMODE?');
			})
		}, ['Check Current Mode']);

		return E('div', { class: 'cbi-map', id: 'map' }, [
			E('h2', {}, 'Dell DW5821e — Band Lock & Mode Control'),
			E('div', { class: 'cbi-map-descr' }, 'Lock specific LTE bands or switch preferred network mode. Uses AT commands via sms_tool on port ' + port + '.'),
			E('hr'),

			E('div', { class: 'cbi-section' }, [
				E('h3', { class: 'cbi-section-title' }, 'Preferred Network Mode'),
				E('div', { class: 'cbi-section-descr' }, 'Select network technology (4G only, 3G only, or 3G & 4G Auto).'),
				E('div', { class: 'cbi-section-node', style: 'padding:10px; display:flex; align-items:center' }, [
					modeSelect,
					applyModeBtn,
					checkModeBtn
				])
			]),

			E('div', { class: 'cbi-section' }, [
				E('h3', { class: 'cbi-section-title' }, 'Select LTE Bands'),
				E('div', { class: 'cbi-section-node' }, [
					bandGrid,
					E('strong', {}, 'Quick combinations:'),
					quickRow,
				])
			]),

			E('div', { class: 'cbi-section' }, [
				E('div', { class: 'right' }, [applyBtn, resetBtn, checkBtn])
			]),

			E('div', { class: 'cbi-section' }, [
				E('h3', { class: 'cbi-section-title' }, 'Recovery & Troubleshooting'),
				E('div', { class: 'cbi-section-descr', style: 'color:#d32f2f; font-weight:bold; margin-bottom:12px' },
					'If the bands do not change after applying, try toggling Airplane Mode or resetting the modem.'
				),
				E('div', { style: 'display:flex; gap:10px; flex-wrap:wrap' }, [
					E('button', {
						class: 'btn cbi-button cbi-button-action important',
						click: ui.createHandlerFn(this, function() {
							output.style.display = '';
							dom.content(output, ['⏳ Checking Airplane Mode state...\n']);
							return fs.exec('sms_tool', ['-d', port, 'at', 'AT+CFUN?']).then(function(res) {
								var out = (res.stdout || '') + (res.stderr || '');
								var is_airplane = out.indexOf('+CFUN: 4') !== -1;
								var target_fun = is_airplane ? '1' : '4';
								var target_txt = is_airplane ? 'Disabling Airplane Mode (AT+CFUN=1)...' : 'Enabling Airplane Mode (AT+CFUN=4)...';
								dom.content(output, ['⏳ ' + target_txt + '\n']);
								return fs.exec('sms_tool', ['-d', port, 'at', 'AT+CFUN=' + target_fun]).then(function(res2) {
									var raw2 = (res2.stdout || '') + (res2.stderr || '');
									var lines2 = raw2.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim() !== ''; });
									dom.content(output, [lines2.join('\n') || 'OK / Success']);
								});
							}).catch(function(err) {
								dom.content(output, ['Error: ' + err]);
							});
						})
					}, ['Airplane']),
					E('button', {
						class: 'btn cbi-button cbi-button-action',
						click: ui.createHandlerFn(this, function() {
							if (confirm('Perform Soft Reboot?')) {
								return runAt('AT^RESET');
							}
						})
					}, ['Soft Reboot']),
					E('button', {
						class: 'btn cbi-button cbi-button-reset',
						click: ui.createHandlerFn(this, function() {
							if (confirm('Perform Hard Reboot?')) {
								return runAt('AT+CFUN=1,1');
							}
						})
					}, ['Hard Reboot']),
					E('button', {
						class: 'btn cbi-button',
						click: ui.createHandlerFn(this, function() {
							output.style.display = '';
							dom.content(output, ['⏳ Requesting IP renewal...\n']);
							return fs.exec('/usr/share/dwtool/modem_control.sh', ['renew']).then(function(res) {
								dom.content(output, ['Renew IP command sent. Network interface restarted successfully.']);
							}).catch(function(err) {
								dom.content(output, ['Error restarting interface: ' + err]);
							});
						})
					}, ['Renew'])
				])
			]),

			E('p', { style: 'font-weight:bold;margin-top:15px' }, 'Response'),
			output
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
