'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require uci';

return view.extend({
	_history: [],
	_histIdx: -1,

	load: function() {
		return uci.load('dwtool');
	},

	render: function() {
		var self = this;
		var port = uci.get('dwtool', 'global', 'port') || '/dev/ttyUSB0';

		/* ── Built-in DW5821e commands ── */
		var builtinCmds = [
			{ group: 'Device Info' },
			{ label: 'Check AT',           cmd: 'AT',              desc: 'Test if modem is responding' },
			{ label: 'Device Info',         cmd: 'ATI',             desc: 'Manufacturer, model, revision' },
			{ label: 'Debug Info',          cmd: 'AT^DEBUG?',       desc: 'Internal debug information' },
			{ label: 'Temperature',         cmd: 'AT+TEMP?',        desc: 'Modem temperature sensor' },
			{ label: 'Voltage',             cmd: 'AT+VOLT?',        desc: 'Modem input voltage' },
			{ label: 'USB Type',            cmd: 'AT^USBTYPE',      desc: 'USB 2.0 or 3.0 mode' },
			{ label: 'LTE Category',        cmd: 'AT^GETLTECAT?',   desc: 'LTE Category (e.g. CAT16)' },
			{ group: 'SIM & Network' },
			{ label: 'IMSI',                cmd: 'AT+CIMI',         desc: 'SIM card IMSI number' },
			{ label: 'Signal Quality',      cmd: 'AT+CSQ',          desc: 'Signal strength 0-31' },
			{ label: 'Operator',            cmd: 'AT+COPS?',        desc: 'Current registered operator' },
			{ label: 'PDP Context',         cmd: 'AT+CGDCONT?',     desc: 'APN and IP config' },
			{ group: 'Band & Signal' },
			{ label: 'Band Lock Status',    cmd: 'AT^SLBAND?',      desc: 'Current band lock setting' },
			{ label: 'CA Info',             cmd: 'AT^CA_INFO?',     desc: 'Carrier Aggregation bands' },
			{ label: 'Neighbor Cells',      cmd: 'AT+VZWRSRP?',     desc: 'Neighbor cell RSRP/PCI/EARFCN' },
			{ group: 'Mode Switch' },
			{ label: 'WCDMA Only',          cmd: 'AT^SLMODE=1,14',  desc: 'Force 3G WCDMA only' },
			{ label: 'LTE Only',            cmd: 'AT^SLMODE=1,30',  desc: 'Force 4G LTE only' },
			{ label: 'WCDMA & LTE',         cmd: 'AT^SLMODE=1,35',  desc: 'Allow both 3G and 4G' },
			{ group: 'System' },
			{ label: 'Enable CA',           cmd: 'AT^CA_ENABLE=0',  desc: 'Enable Carrier Aggregation' },
			{ label: 'Disable CA',          cmd: 'AT^CA_ENABLE=1',  desc: 'Disable Carrier Aggregation' },
			{ label: 'Disable GPS',         cmd: 'AT+GPS=0',        desc: 'Turn off GPS module' },
			{ label: 'Reset Modem',         cmd: 'AT^RESET',        desc: '⚠ Restart modem hardware' },
		];

		/* ── Custom commands from UCI configuration Settings ── */
		var customCmds = uci.sections('dwtool', 'custom_cmd') || [];

		/* ── Quick commands persisted locally in browser localStorage (bug-free, reorderable) ── */
		var defaultQuick = ['AT', 'ATI', 'AT+CSQ', 'AT+TEMP?', 'AT+VOLT?', 'AT^CA_INFO?', 'AT^SLBAND?'];
		var quickList = [];
		try {
			var stored = localStorage.getItem('dwtool_quick_cmds_v2');
			if (stored) {
				quickList = JSON.parse(stored);
			} else {
				quickList = defaultQuick;
				localStorage.setItem('dwtool_quick_cmds_v2', JSON.stringify(quickList));
			}
		} catch(e) {
			quickList = defaultQuick;
		}

		/* ── Output area ── */
		var output = E('pre', {
			id: 'at-output',
			style: 'display:none; border:1px solid var(--border-color-medium,#ccc); border-radius:5px; font-family:monospace; padding:12px; min-height:60px; max-height:450px; overflow-y:auto; white-space:pre-wrap; word-break:break-word; line-height:1.6'
		});

		function sendCommand(cmd) {
			if (!cmd || cmd.length < 1) {
				ui.addNotification(null, E('p', {}, 'Please specify the AT command to send.'), 'info');
				return;
			}
			self._history.unshift(cmd);
			if (self._history.length > 80) self._history.pop();
			self._histIdx = -1;

			output.style.display = '';
			var ts = new Date().toLocaleTimeString();

			var entry = E('div', { style: 'margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed var(--border-color-low,#ddd)' }, [
				E('div', {}, [
					E('span', { style: 'color:#888;font-size:0.85em' }, '[' + ts + '] '),
					E('strong', { style: 'color:#2196f3' }, '▶ ' + cmd),
				]),
				E('div', { style: 'margin-top:4px;color:#aaa' }, '⏳ Sending...')
			]);
			output.appendChild(entry);
			output.scrollTop = output.scrollHeight;

			var buttons = document.querySelectorAll('#at-section .cbi-button');
			for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('disabled', 'true');

			return fs.exec('sms_tool', ['-d', port, 'at', cmd]).then(function(res) {
				var raw = ((res.stdout || '') + (res.stderr || ''));
				var lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
				lines = lines.filter(function(l) { return l.trim() !== ''; });

				var responseDiv = E('div', { style: 'margin-top:4px' });
				lines.forEach(function(line) {
					responseDiv.appendChild(document.createTextNode(line));
					responseDiv.appendChild(E('br'));
				});

				dom.content(entry, [
					E('div', {}, [
						E('span', { style: 'color:#888;font-size:0.85em' }, '[' + ts + '] '),
						E('strong', { style: 'color:#2196f3' }, '▶ ' + cmd),
					]),
					responseDiv
				]);
			}).catch(function(err) {
				dom.content(entry, [
					E('div', {}, [
						E('span', { style: 'color:#888;font-size:0.85em' }, '[' + ts + '] '),
						E('strong', { style: 'color:#f44336' }, '✘ ' + cmd),
					]),
					E('div', { style: 'margin-top:4px;color:#f44336' }, 'Error: ' + err)
				]);
			}).finally(function() {
				for (var i = 0; i < buttons.length; i++) buttons[i].removeAttribute('disabled');
				output.scrollTop = output.scrollHeight;
			});
		}

		/* ── Command dropdown ── */
		var cmdSelect = E('select', {
			class: 'cbi-input-select',
			style: 'width:100%;margin:5px 0',
			change: function() {
				if (this.value) {
					cmdInput.value = this.value;
					cmdInput.focus();
				}
			}
		}, [E('option', { value: '' }, '— Select a command —')]);

		/* Built-in commands */
		builtinCmds.forEach(function(c) {
			if (c.group) {
				cmdSelect.appendChild(E('option', { value: '', disabled: true, style: 'font-weight:bold;background:var(--background-color-medium,#f0f0f0)' }, '── ' + c.group + ' ──'));
			} else {
				cmdSelect.appendChild(E('option', { value: c.cmd },
					c.cmd + '  —  ' + c.label + (c.desc ? '  (' + c.desc + ')' : '')));
			}
		});

		/* Custom commands from UCI Settings */
		if (customCmds.length > 0) {
			cmdSelect.appendChild(E('option', { value: '', disabled: true, style: 'font-weight:bold;background:var(--background-color-medium,#e2f0d9)' }, '── Custom Commands (from Settings) ──'));
			customCmds.forEach(function(c) {
				if (c.label && c.command) {
					cmdSelect.appendChild(E('option', { value: c.command },
						c.command + '  —  ' + c.label));
				}
			});
		}

		/* ── Command input ── */
		var cmdInput = E('input', {
			style: 'width:100%;margin:5px 0;font-family:monospace',
			type: 'text',
			id: 'cmdvalue',
			placeholder: 'Type AT command or select from dropdown... (↑↓ history, Enter send)',
		});

		cmdInput.addEventListener('keydown', function(ev) {
			if (ev.keyCode === 13) {
				sendCommand(cmdInput.value.trim());
			} else if (ev.keyCode === 38) {
				ev.preventDefault();
				self._histIdx = Math.min(self._histIdx + 1, self._history.length - 1);
				if (self._history[self._histIdx]) cmdInput.value = self._history[self._histIdx];
			} else if (ev.keyCode === 40) {
				ev.preventDefault();
				self._histIdx = Math.max(self._histIdx - 1, -1);
				cmdInput.value = self._histIdx >= 0 ? (self._history[self._histIdx] || '') : '';
			}
		});

		/* ── Quick command buttons ── */
		var quickWrap = E('div', { id: 'quick-wrap' });

		function renderQuickButtons() {
			dom.content(quickWrap, [
				E('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' },
					quickList.map(function(cmd) {
						return E('button', {
							class: 'btn cbi-button-action',
							style: 'font-family:monospace;font-size:0.85em;padding:4px 10px',
							title: 'Click to send: ' + cmd,
							click: function() {
								cmdInput.value = cmd;
								sendCommand(cmd);
							}
						}, [cmd]);
					}).concat([
						E('button', {
							class: 'btn cbi-button cbi-button-reset',
							style: 'font-size:0.85em;padding:4px 10px;font-weight:bold;background-color:var(--background-color-medium,#eee);border:1px dashed #bbb',
							title: 'Edit Quick Commands List',
							click: function() {
								showEditModal();
							}
						}, ['⚙ Edit Quick Commands'])
					])
				)
			]);
		}

		/* ── Modal dialog for Edit Mode ── */
		function showEditModal() {
			var modalBody = E('div', { style: 'padding:10px' }, [
				E('p', { style: 'margin-bottom:10px; font-style:italic; color:var(--text-color-low,#666)' }, '💡 Drag and drop commands to reorder them, or add/delete them below.'),
				E('div', { id: 'modal-list-wrap', style: 'max-height:280px; overflow-y:auto; margin-bottom:15px; border:1px solid var(--border-color-low,#ddd); border-radius:4px' })
			]);

			var draggedIndex = null;

			function renderModalList() {
				var wrap = modalBody.querySelector('#modal-list-wrap');
				if (!wrap) return;

				var listContainer = E('div', {
					style: 'display:flex; flex-direction:column; width:100%'
				});

				quickList.forEach(function(cmd, idx) {
					var itemRow = E('div', {
						draggable: 'true',
						style: 'display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border-color-low,#eee); background:var(--background-color-low,#fff); color:var(--text-color-medium,#333); cursor:move; transition:background-color .2s',
						class: 'drag-item'
					}, [
						E('span', { style: 'display:flex; align-items:center; gap:8px' }, [
							E('span', { style: 'color:var(--text-color-low,#888); font-size:1.1em' }, '☰'),
							E('strong', { style: 'font-family:monospace; font-size:1.1em; color:var(--text-color-medium,#333)' }, cmd)
						]),
						E('button', {
							class: 'btn cbi-button-remove',
							style: 'padding:2px 8px; font-size:0.85em; color:#f44336; font-weight:bold',
							click: function(ev) {
								ev.stopPropagation();
								quickList.splice(idx, 1);
								localStorage.setItem('dwtool_quick_cmds_v2', JSON.stringify(quickList));
								renderModalList();
								renderQuickButtons();
							}
						}, ['Delete'])
					]);

					// HTML5 Drag and Drop events (uses translucent/opacity colors to adapt to themes automatically)
					itemRow.addEventListener('dragstart', function(ev) {
						draggedIndex = idx;
						itemRow.style.background = 'rgba(76, 175, 80, 0.2)'; // light green tint
						ev.dataTransfer.effectAllowed = 'move';
						ev.dataTransfer.setData('text/plain', idx);
					});

					itemRow.addEventListener('dragend', function() {
						draggedIndex = null;
						renderModalList();
					});

					itemRow.addEventListener('dragover', function(ev) {
						ev.preventDefault();
						ev.dataTransfer.dropEffect = 'move';
						itemRow.style.background = 'rgba(0, 0, 0, 0.08)';
					});

					itemRow.addEventListener('dragleave', function() {
						itemRow.style.background = '';
					});

					itemRow.addEventListener('drop', function(ev) {
						ev.preventDefault();
						if (draggedIndex !== null && draggedIndex !== idx) {
							// Rearrange list
							var item = quickList.splice(draggedIndex, 1)[0];
							quickList.splice(idx, 0, item);
							localStorage.setItem('dwtool_quick_cmds_v2', JSON.stringify(quickList));
							renderQuickButtons();
						}
						renderModalList();
					});

					listContainer.appendChild(itemRow);
				});

				if (quickList.length === 0) {
					dom.content(wrap, E('div', { style: 'padding:15px; text-align:center; color:var(--text-color-low,#888)' }, 'No quick commands configured.'));
				} else {
					dom.content(wrap, listContainer);
				}
			}

			var addInput = E('input', {
				type: 'text',
				placeholder: 'e.g. AT+CSQ',
				style: 'width:50%; margin-right:10px; font-family:monospace'
			});

			var addBtn = E('button', {
				class: 'btn cbi-button-add',
				click: function() {
					var val = addInput.value.trim();
					if (!val) return;
					if (quickList.indexOf(val) !== -1) {
						ui.addNotification(null, E('p', {}, val + ' is already in quick commands.'), 'info');
						return;
					}
					quickList.push(val);
					localStorage.setItem('dwtool_quick_cmds_v2', JSON.stringify(quickList));
					addInput.value = '';
					renderModalList();
					renderQuickButtons();
				}
			}, ['Add Command']);

			modalBody.appendChild(E('div', { style: 'display:flex; align-items:center; margin-top:10px' }, [
				E('span', { style: 'margin-right:10px; font-weight:bold' }, 'New Command:'),
				addInput,
				addBtn
			]));

			ui.showModal('Edit Quick Commands', [
				modalBody,
				E('div', { class: 'right', style: 'margin-top:15px' }, [
					E('button', {
						class: 'btn cbi-button-action important',
						click: function() { ui.hideModal(); }
					}, ['Close'])
				])
			]);

			renderModalList();
		}

		renderQuickButtons();

		return E('div', { class: 'cbi-map', id: 'at-section' }, [
			E('h2', {}, 'Dell DW5821e — AT Terminal'),
			E('div', { class: 'cbi-map-descr' }, [
				'Send AT commands to modem via sms_tool on port ',
				E('strong', {}, port),
				'. Use ↑↓ for command history, Enter to send.'
			]),
			E('hr'),

			E('div', { class: 'cbi-section' }, [
				E('div', { class: 'cbi-section-node' }, [
					E('div', { class: 'cbi-value' }, [
						E('label', { class: 'cbi-value-title' }, 'Command List'),
						E('div', { class: 'cbi-value-field' }, [cmdSelect])
					]),
					E('div', { class: 'cbi-value' }, [
						E('label', { class: 'cbi-value-title' }, 'Quick Commands'),
						E('div', { class: 'cbi-value-field' }, [quickWrap])
					]),
					E('div', { class: 'cbi-value' }, [
						E('label', { class: 'cbi-value-title' }, 'Manual Input'),
						E('div', { class: 'cbi-value-field' }, [cmdInput])
					]),
				])
			]),

			E('hr'),
			E('div', { class: 'right' }, [
				E('button', {
					class: 'btn cbi-button cbi-button-remove',
					click: function() {
						dom.content(output, []);
						output.style.display = 'none';
						cmdInput.value = '';
						cmdInput.focus();
					}
				}, ['Clear Output']),
				'\xa0\xa0\xa0',
				E('button', {
					class: 'btn cbi-button cbi-button-action important',
					click: function() {
						sendCommand(cmdInput.value.trim());
					}
				}, ['Send Command'])
			]),

			E('p', { style: 'font-weight:bold;margin-top:15px' }, 'Response Log'),
			output
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
