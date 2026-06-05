'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require uci';
'require form';

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('dwtool'),
			fs.exec('/usr/share/dwtool/sms_manager.sh', ['list'])
				.catch(function() { return { stdout: '' }; })
		]);
	},

	formatDate: function(dateStr) {
		if (!dateStr) return '';
		try {
			// Try parsing ISO date string (e.g. 2026-06-06T01:43:39+07:00)
			var d = new Date(dateStr);
			if (!isNaN(d.getTime())) {
				var pad = function(num) { return (num < 10 ? '0' : '') + num; };
				return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + 
				       pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
			}
		} catch(e) {}
		return dateStr;
	},

	parseSms: function(raw) {
		var messages = [];
		var blocks = (raw || '').split(/^MSG:\s*/m);
		for (var i = 1; i < blocks.length; i++) {
			var block = blocks[i].trim();
			if (!block) continue;

			var from = '', date = '', text = '';
			var lines = block.split('\n');
			var idx = lines[0].trim();
			var bodyStart = false;

			for (var j = 1; j < lines.length; j++) {
				var line = lines[j];
				if (!bodyStart && line.match(/^From:\s*/)) {
					from = line.replace(/^From:\s*/, '').trim();
				} else if (!bodyStart && line.match(/^Date\/Time:\s*/)) {
					date = line.replace(/^Date\/Time:\s*/, '').trim();
					bodyStart = true;
				} else if (bodyStart) {
					text += (text ? '\n' : '') + line;
				}
			}
			if (from || text) {
				messages.push({ index: idx, from: from, date: date, text: text.trim() });
			}
		}
		return messages;
	},

	render: function(loadResults) {
		var self = this;
		var raw = (loadResults[1] && loadResults[1].stdout) || '';
		var messages = [];

		if (raw.trim().indexOf('[') === 0) {
			try {
				messages = JSON.parse(raw);
			} catch(e) {
				messages = this.parseSms(raw);
			}
		} else {
			messages = this.parseSms(raw);
		}

		// Sort messages by index descending (newest first)
		messages.sort(function(a, b) {
			return parseInt(b.index || 0) - parseInt(a.index || 0);
		});

		var m, s, o;

		m = new form.Map('dwtool', 'Dell DW5821e — SMS',
			'Read and manage SMS messages from SIM card storage. Uses dual-mode ModemManager/AT communication.');

		/* ── Section: Telegram Forwarder ── */
		s = m.section(form.NamedSection, 'telegram', 'telegram', 'Telegram SMS Forwarder');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', 'Enable Forwarder',
			'Automatically forward received SMS to Telegram. Requires curl and jq packages.');
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'bot_token', 'Bot Token',
			'Telegram bot token from @BotFather.');
		o.depends('enabled', '1');
		o.rmempty = true;
		o.password = true;

		o = s.option(form.Value, 'chat_id', 'Chat ID',
			'Target Telegram chat or channel ID.');
		o.depends('enabled', '1');
		o.rmempty = true;

		// Inbox container elements
		var smsBody = E('div', { id: 'sms-body' });
		var currentPage = 0;
		var pageSize = 10;

		/* ── Detail modal ── */
		function showDetail(msg) {
			ui.showModal('SMS from ' + msg.from, [
				E('div', {}, [
					E('p', {}, [
						E('strong', {}, 'From: '), msg.from, E('br'),
						E('strong', {}, 'Date: '), self.formatDate(msg.date)
					]),
					E('hr'),
					E('pre', { style: 'white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;font-family:inherit' }, msg.text),
					E('hr'),
					E('div', { class: 'right' }, [
						E('button', {
							class: 'btn cbi-button',
							click: ui.hideModal
						}, ['Close']),
						'\xa0\xa0',
						E('button', {
							class: 'btn cbi-button cbi-button-remove',
							click: ui.createHandlerFn(self, function() {
								ui.hideModal();
								deleteSms(msg.index);
							})
						}, ['Delete this SMS'])
					])
				])
			]);
		}

		/* ── Delete ── */
		function deleteSms(index) {
			ui.showModal('Deleting...', [E('p', { class: 'spinning' }, 'Deleting SMS #' + index + '...')]);
			return fs.exec('/usr/share/dwtool/sms_manager.sh', ['delete', String(index)]).then(function() {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'SMS #' + index + ' deleted.'), 'info');
				return refreshInbox();
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Failed to delete: ' + err), 'error');
			});
		}

		/* ── Delete All ── */
		function deleteAll() {
			if (!confirm('Delete ALL SMS from SIM storage? This cannot be undone.')) return;
			ui.showModal('Deleting...', [E('p', { class: 'spinning' }, 'Deleting all SMS...')]);
			return fs.exec('/usr/share/dwtool/sms_manager.sh', ['delete', 'all']).then(function() {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'All SMS deleted.'), 'info');
				return refreshInbox();
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, 'Failed to delete: ' + err), 'error');
			});
		}

		/* ── Refresh ── */
		function refreshInbox() {
			dom.content(smsBody, [E('em', {}, '⏳ Loading...')]);
			return fs.exec('/usr/share/dwtool/sms_manager.sh', ['list']).then(function(res) {
				var out = res.stdout || '';
				if (out.trim().indexOf('[') === 0) {
					try { messages = JSON.parse(out); }
					catch(e) { messages = self.parseSms(out); }
				} else {
					messages = self.parseSms(out);
				}
				messages.sort(function(a, b) {
					return parseInt(b.index || 0) - parseInt(a.index || 0);
				});
				currentPage = 0; // reset page index on refresh
				renderTable(messages);
				var countEl = document.getElementById('sms-count-header');
				if (countEl) {
					countEl.textContent = messages.length > 0 ? ' (' + messages.length + ')' : '';
				}
			}).catch(function(err) {
				dom.content(smsBody, [E('em', { style: 'color:red' }, 'Error: ' + err)]);
			});
		}

		/* ── Render SMS table with pagination ── */
		function renderTable(msgs) {
			if (msgs.length === 0) {
				dom.content(smsBody, [
					E('div', { style: 'padding:20px;text-align:center;color:#888' }, [
						E('p', {}, 'No messages in SIM storage.'),
					])
				]);
				return;
			}

			// Slice message list for current page
			var start = currentPage * pageSize;
			var end = start + pageSize;
			var pageMsgs = msgs.slice(start, end);

			var rows = pageMsgs.map(function(m) {
				return E('tr', { class: 'tr' }, [
					E('td', { class: 'td', style: 'width:15%;white-space:nowrap;font-weight:bold' }, m.from),
					E('td', { class: 'td', style: 'width:15%;white-space:nowrap;font-size:0.9em;color:#666' }, self.formatDate(m.date)),
					E('td', { class: 'td', style: 'white-space:pre-wrap;word-break:break-word' },
						m.text.length > 80 ? m.text.substring(0, 80) + '...' : m.text
					),
					E('td', { class: 'td', style: 'width:15%;white-space:nowrap;text-align:right' }, [
						E('button', {
							class: 'btn cbi-button',
							style: 'margin-right:4px',
							title: 'Read full message',
							click: ui.createHandlerFn(self, function() { showDetail(m); })
						}, ['Read']),
						E('button', {
							class: 'btn cbi-button cbi-button-remove',
							title: 'Delete this message',
							click: ui.createHandlerFn(self, function() { deleteSms(m.index); })
						}, ['Del']),
					])
				]);
			});

			var totalPages = Math.ceil(msgs.length / pageSize);
			var paginationControls = E('div', {
				style: 'display:flex;justify-content:center;align-items:center;gap:12px;margin-top:15px;font-size:0.95em'
			});

			if (totalPages > 1) {
				var prevBtn = E('button', {
					class: 'btn cbi-button cbi-button-neutral',
					disabled: (currentPage === 0) ? 'disabled' : null,
					click: function(ev) {
						ev.preventDefault();
						if (currentPage > 0) {
							currentPage--;
							renderTable(msgs);
						}
					}
				}, ['◀ Previous']);
				
				var nextBtn = E('button', {
					class: 'btn cbi-button cbi-button-neutral',
					disabled: (currentPage >= totalPages - 1) ? 'disabled' : null,
					click: function(ev) {
						ev.preventDefault();
						if (currentPage < totalPages - 1) {
							currentPage++;
							renderTable(msgs);
						}
					}
				}, ['Next ▶']);
				
				dom.content(paginationControls, [
					prevBtn,
					E('span', { style: 'font-weight:bold' }, ['Page ' + (currentPage + 1) + ' of ' + totalPages]),
					nextBtn
				]);
			}

			dom.content(smsBody, [
				E('table', { class: 'table' }, [
					E('tr', { class: 'tr table-titles' }, [
						E('th', { class: 'th' }, 'From'),
						E('th', { class: 'th' }, 'Date/Time'),
						E('th', { class: 'th' }, 'Message'),
						E('th', { class: 'th', style: 'text-align:right' }, 'Actions'),
					])
				].concat(rows)),
				paginationControls
			]);
		}

		renderTable(messages);

		return m.render().then(function(mapNode) {
			var inboxSection = E('div', { class: 'cbi-section', style: 'margin-top:20px;border-top:1px solid #ccc;padding-top:20px' }, [
				E('div', { style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px' }, [
					E('h3', { class: 'cbi-section-title', style: 'margin:0' }, [
						'Inbox',
						E('span', { id: 'sms-count-header' }, [
							messages.length > 0 ? ' (' + messages.length + ')' : ''
						])
					]),
					E('div', { style: 'display:flex;gap:5px' }, [
						E('button', {
							class: 'btn cbi-button cbi-button-action',
							click: ui.createHandlerFn(self, refreshInbox)
						}, ['Refresh']),
						E('button', {
							class: 'btn cbi-button cbi-button-remove',
							click: ui.createHandlerFn(self, deleteAll)
						}, ['Delete All']),
					])
				]),
				E('div', { class: 'cbi-section-node', style: 'margin-top:10px' }, [smsBody])
			]);

			mapNode.appendChild(inboxSection);
			return mapNode;
		});
	},

});
