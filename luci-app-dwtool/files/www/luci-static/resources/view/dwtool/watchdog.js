'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require uci';
'require dom';

window.onerror = function(message, source, lineno, colno, error) {
    alert("LuCI Watchdog JS Error:\n" + message + "\nLine: " + lineno + "\nSource: " + source);
    return false;
};

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('dwtool'),
			uci.load('network').catch(function() { return {}; })
		]);
	},

	render: function(loadResults) {
		var networkSections = uci.sections('network', 'interface');
		var logicalIfaces = networkSections
			.map(function(s) { return s['.name']; })
			.filter(function(n) {
				return n && (n.indexOf('wan') !== -1 || n.indexOf('wwan') !== -1 || n === 'modem');
			});

		var savedProxies = uci.get('dwtool', 'watchdog', 'mihomo_proxy');
		if (savedProxies == null) {
			savedProxies = [];
		} else if (!Array.isArray(savedProxies)) {
			savedProxies = [savedProxies];
		}

		var m, s, o;

		// Declare shared visibility variables for target and proxy rows
		var hasFetched = false;
		var updateProxyRowVisibility = function() {};

		m = new form.Map('dwtool', 'Dell DW5821e — Modem Watchdog',
			'Configure the connectivity watchdog. It monitors connection status and performs recovery actions when failures exceed the threshold.');

		/* ════════════════════════════════════════
		   SECTION 1 — Watchdog (enable + timing)
		   ════════════════════════════════════════ */
		s = m.section(form.NamedSection, 'watchdog', 'dwtool', 'Watchdog');
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', 'Enable Watchdog',
			'Enable background connectivity monitoring and recovery daemon.');
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'check_interval', 'Check Interval (seconds)',
			'Seconds between each connectivity check. Minimum 10.');
		o.default = '60';
		o.datatype = 'uinteger';
		o.rmempty = false;

		o = s.option(form.Value, 'retry_interval', 'Retry Interval (seconds)',
			'Seconds between retries when a check fails. Minimum 2.');
		o.default = '10';
		o.datatype = 'uinteger';
		o.rmempty = false;

		o = s.option(form.Value, 'failure_threshold', 'Failure Threshold',
			'Consecutive failures before a recovery action is triggered.');
		o.default = '3';
		o.datatype = 'uinteger';
		o.rmempty = false;

		/* ════════════════════════════════════════
		   SECTION 2 — Settings
		   ════════════════════════════════════════ */
		s = m.section(form.NamedSection, 'watchdog', 'dwtool', 'Settings');
		s.anonymous = true;

		/* ── Check Type ── */
		o = s.option(form.ListValue, 'check_type', 'Check Type',
			'Choose connectivity check method.');
		o.value('direct', 'Direct WAN Check (ping / curl / wget)');
		o.value('mihomo', 'Mihomo / Nikki Proxy API Check');
		o.default = 'direct';

		/* ── Direct: method ── */
		o = s.option(form.ListValue, 'direct_method', 'Direct Check Method',
			'Tool used for the connection check.');
		o.depends('check_type', 'direct');
		o.value('ping', 'ICMP Ping');
		o.value('curl', 'Curl HTTP');
		o.value('wget', 'Wget HTTP');
		o.default = 'curl';

		/* ── Direct: bind interface ── */
		o = s.option(form.ListValue, 'direct_interface', 'Bind Interface (optional)',
			'Bind check to a specific WAN interface (multi-WAN setups).');
		o.depends('check_type', 'direct');
		o.value('', 'Default Routing (None)');
		logicalIfaces.forEach(function(i) { o.value(i, i); });
		o.rmempty = true;

		/* ── Direct: ping target ── */
		o = s.option(form.Value, 'direct_target_ping', 'Ping Target',
			'IP address or hostname to ping. Note: If using Nikki/Clash, using a direct IP address is highly recommended to avoid DNS resolution/Fake-IP issues. You can convert hostnames to IP addresses using online tools like <a href="https://dnschecker.org/" target="_blank">dnschecker.org</a>.');
		o.depends({ check_type: 'direct', direct_method: 'ping' });
		o.default = '8.8.8.8';

		/* ── Direct: HTTP target ── */
		o = s.option(form.Value, 'direct_target', 'HTTP Target',
			'URL to check (e.g. http://1.1.1.1/generate_204). Note: If using Nikki/Clash, using a direct IP address is highly recommended to avoid DNS resolution/Fake-IP issues. You can convert hostnames to IP addresses using online tools like <a href="https://dnschecker.org/" target="_blank">dnschecker.org</a>.');
		o.depends({ check_type: 'direct', direct_method: 'curl' });
		o.depends({ check_type: 'direct', direct_method: 'wget' });
		o.default = 'https://connectivitycheck.gstatic.com/generate_204';

		/* ── Direct: test button ── */
		o = s.option(form.Button, '_test_direct', 'Test Connection',
			'Run a manual check with the current settings.');
		o.depends('check_type', 'direct');
		o.inputtitle = 'Test Now';
		o.inputstyle = 'action';
		o.onclick = function(ev) {
			var btn  = ev.target;
			var span = _statusSpan(btn, 'direct-status-inline');
			dom.content(span, [E('span', { style: 'color:#888' }, ['⏳ Testing…'])]);

			var method = m.lookupOption('direct_method',    'watchdog')[0].formvalue('watchdog') || 'curl';
			var iface  = m.lookupOption('direct_interface', 'watchdog')[0].formvalue('watchdog') || '';
			
			var targetOpt = (method === 'ping')
				? m.lookupOption('direct_target_ping', 'watchdog')[0]
				: m.lookupOption('direct_target',      'watchdog')[0];
			var target = targetOpt ? (targetOpt.formvalue('watchdog') || '') : '';

			fs.exec('/usr/share/dwtool/modem_control.sh',
				['test_connection', method, iface || 'none', target]
			).then(function(res) {
				var out = (res.stdout || '').trim();
				if (out.indexOf('SUCCESS:') === 0) {
					dom.content(span, [E('span', { style: 'color:#2e7d32' }, ['✅ Connected'])]);
				} else {
					dom.content(span, [
						E('span', { style: 'color:#c62828' }, ['❌ Failed']),
						E('div', {
							style: 'font-size:.85em;color:#c62828;margin-top:4px;font-family:monospace;white-space:pre-wrap'
						}, [out.replace(/^FAILED:\s*/, '')])
					]);
				}
			}).catch(function(err) {
				dom.content(span, [E('span', { style: 'color:#c62828' }, ['❌ ' + err])]);
			});
		};

		/* ── Mihomo: API URL ── */
		o = s.option(form.Value, 'mihomo_api_url', 'Mihomo API URL',
			'Base URL of the Mihomo / Nikki external controller.');
		o.depends('check_type', 'mihomo');
		o.default = 'http://127.0.0.1:9090';
		o.rmempty = true;

		/* ── Mihomo: API secret ── */
		o = s.option(form.Value, 'mihomo_api_secret', 'Mihomo API Secret',
			'Bearer token for API authentication (leave blank if none).');
		o.depends('check_type', 'mihomo');
		o.password = true;
		o.rmempty = true;

		/* ── Mihomo: fetch button ── */
		o = s.option(form.Button, '_fetch_proxies', 'Fetch Proxies',
			'Test API connection and retrieve available proxy nodes / groups.');
		o.depends('check_type', 'mihomo');
		o.inputtitle = 'Fetch & Test API';
		o.inputstyle = 'action';
		o.onclick = function(ev) {
			var btn  = ev.target;
			var span = _statusSpan(btn, 'mihomo-status-inline');
			dom.content(span, [E('span', { style: 'color:#888' }, ['⏳ Fetching…'])]);

			var apiUrl = m.lookupOption('mihomo_api_url',    'watchdog')[0].formvalue('watchdog') || 'http://127.0.0.1:9090';
			var secret = m.lookupOption('mihomo_api_secret', 'watchdog')[0].formvalue('watchdog') || '';

			fs.exec('/usr/share/dwtool/modem_control.sh',
				['get_mihomo_proxies', apiUrl, secret || 'none']
			).then(function(res) {
				var raw = (res.stdout || '').trim();

				if (raw.indexOf('ERROR:') === 0) {
					dom.content(span, [
						E('span', { style: 'color:#c62828' }, ['❌ Connection failed']),
						E('div', {
							style: 'font-size:.85em;color:#c62828;margin-top:4px;font-family:monospace;white-space:pre-wrap'
						}, [raw])
					]);
					hasFetched = false;
					updateProxyRowVisibility();
					return;
				}

				try {
					var data = JSON.parse(raw);
					if (data.message === 'Unauthorized') {
						dom.content(span, [E('span', { style: 'color:#c62828' }, ['❌ Unauthorized – check API Secret'])]);
						hasFetched = false;
						updateProxyRowVisibility();
						return;
					}
					var proxies = Object.keys(data.proxies || {}).sort();
					if (proxies.length === 0) {
						dom.content(span, [E('span', { style: 'color:#e65100' }, ['⚠️ Connected but no proxies found'])]);
						hasFetched = false;
						updateProxyRowVisibility();
						return;
					}

					dom.content(span, [E('span', { style: 'color:#2e7d32' },
						['✅ Connected (' + proxies.length + ' proxies found)'])]);

					if (typeof window.updateWatchdogProxySelects === 'function') {
						window.updateWatchdogProxySelects(proxies);
					}
					hasFetched = true;
					updateProxyRowVisibility();

				} catch(e) {
					dom.content(span, [E('span', { style: 'color:#c62828' }, ['❌ Failed to parse API response'])]);
					hasFetched = false;
					updateProxyRowVisibility();
				}
			}).catch(function(err) {
				dom.content(span, [E('span', { style: 'color:#c62828' }, ['❌ ' + err])]);
				hasFetched = false;
				updateProxyRowVisibility();
			});
		};

		/* ── Mihomo Proxy Node / Group ── */
		o = s.option(form.Value, 'mihomo_proxy', 'Mihomo Proxy Nodes / Groups',
			'Select one or more proxies. The watchdog will check them in order (fallback).');
		o.depends('check_type', 'mihomo');
		o.default = '';
		o.validate = function(section_id, value) {
			var checkTypeOpt = m.lookupOption('check_type', section_id);
			var checkType = (checkTypeOpt && checkTypeOpt[0]) ? checkTypeOpt[0].formvalue(section_id) : 'direct';
			if (checkType === 'mihomo') {
				if (!value || value.trim() === '') {
					return 'At least one Mihomo proxy node is required. Please fetch proxies and select a valid node.';
				}
			}
			return true;
		};

		/* ── Recovery: action ── */
		o = s.option(form.ListValue, 'action_type', 'Recovery Action',
			'Action to take when failure threshold is reached.');
		o.value('airplane',   'Airplane Mode Cycle');
		o.value('softreboot', 'Soft Reboot  (AT^RESET)');
		o.value('hardreboot', 'Hard Reboot  (AT+CFUN=1,1)');
		o.value('renew',      'Renew Connection  (Interface Restart)');
		o.default = 'airplane';

		o = s.option(form.Flag, 'enable_custom_script', 'Enable Custom Script',
			'Run additional shell commands alongside the recovery action.');
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.TextValue, 'custom_script', 'Custom Script / Commands',
			'Shell commands executed when threshold is reached.');
		o.depends('enable_custom_script', '1');
		o.placeholder = '/etc/init.d/mihomo restart';
		o.rows = 4;
		o.rmempty = true;

		/* ════════════════════════════════════════
		   Helper: get/create inline status span
		   ════════════════════════════════════════ */
		function _statusSpan(btn, id) {
			var el = btn.parentNode.querySelector('#' + id);
			if (!el) {
				el = E('span', {
					id: id,
					style: 'margin-left:12px;font-weight:bold;display:inline-block;vertical-align:middle'
				});
				btn.parentNode.appendChild(el);
			}
			return el;
		}

		/* ════════════════════════════════════════
		   Post-render injections
		   ════════════════════════════════════════ */
		return m.render().then(function(mapNode) {

			/* ══════════════════════════════════════
			   1. TWO-DROPDOWN TARGET SELECTOR
			   ══════════════════════════════════════ */

			function injectPingTarget(pingRow) {
				var pingHidden = pingRow.querySelector('input[type="text"]');
				if (!pingHidden || pingRow.querySelector('.cbi-input-select')) return;
				pingHidden.style.display = 'none';
				var savedPing = pingHidden.value || '8.8.8.8';

				var pingCustom = E('input', {
					class:       'cbi-input-text',
					style:       'display:none;margin-top:6px;min-width:320px',
					placeholder: 'e.g. 8.8.8.8 or hostname',
					value:       ''
				});
				
				function _setPing(v) {
					pingHidden.value = v;
					pingHidden.dispatchEvent(new Event('change', { bubbles: true }));
				}

				pingCustom.addEventListener('input', function(ev) {
					_setPing(ev.target.value);
				});

				var pingSelect = E('select', {
					class: 'cbi-input-select',
					style: 'min-width:300px'
				});
				[
					{ v: '8.8.8.8',  l: 'Google DNS  (8.8.8.8)'  },
					{ v: '1.1.1.1',  l: 'Cloudflare  (1.1.1.1)'  },
					{ v: '1.0.0.1',  l: 'Cloudflare  (1.0.0.1)'  }
				].forEach(function(item) {
					pingSelect.appendChild(E('option', { value: item.v }, [item.l]));
				});
				pingSelect.appendChild(E('option', { value: '__custom__' }, ['Custom…']));

				pingSelect.addEventListener('change', function(ev) {
					var v = ev.target.value;
					if (v === '__custom__') {
						pingCustom.style.display = '';
						pingCustom.value = '';
						pingCustom.focus();
					} else {
						pingCustom.style.display = 'none';
						_setPing(v);
					}
				});

				var fieldContainer = pingRow.querySelector('.cbi-value-field');
				if (fieldContainer) {
					var descEl = fieldContainer.querySelector('.cbi-value-description');
					fieldContainer.insertBefore(pingSelect, descEl);
					fieldContainer.insertBefore(pingCustom, descEl);
				}

				var found = false;
				for (var i = 0; i < pingSelect.options.length; i++) {
					if (pingSelect.options[i].value === savedPing) {
						pingSelect.selectedIndex = i;
						found = true;
						break;
					}
				}
				if (!found) {
					pingSelect.selectedIndex = pingSelect.options.length - 1;
					pingCustom.value = savedPing;
					pingCustom.style.display = '';
				}
			}

			function injectHttpTarget(httpRow) {
				var httpHidden = httpRow.querySelector('input[type="text"]');
				if (!httpHidden || httpRow.querySelector('.cbi-input-select')) return;
				httpHidden.style.display = 'none';
				var savedHttp = httpHidden.value || 'https://connectivitycheck.gstatic.com/generate_204';

				var httpCustom = E('input', {
					class:       'cbi-input-text',
					style:       'display:none;margin-top:6px;min-width:320px',
					placeholder: 'e.g. google.com or http://target',
					value:       ''
				});
				
				function _setHttp(v) {
					// Auto add http/s if missing
					if (v && v.indexOf('http://') !== 0 && v.indexOf('https://') !== 0 && v !== '__custom__') {
						v = 'https://' + v;
					}
					httpHidden.value = v;
					httpHidden.dispatchEvent(new Event('change', { bubbles: true }));
				}

				httpCustom.addEventListener('input', function(ev) {
					_setHttp(ev.target.value);
				});

				var httpSelect = E('select', {
					class: 'cbi-input-select',
					style: 'min-width:300px'
				});
				[
					{ v: 'https://connectivitycheck.gstatic.com/generate_204', l: 'Google Connectivity Check  (gstatic.com)' },
					{ v: 'https://www.google.com', l: 'Google  (google.com)' },
					{ v: 'https://www.cloudflare.com', l: 'Cloudflare  (cloudflare.com)' }
				].forEach(function(item) {
					httpSelect.appendChild(E('option', { value: item.v }, [item.l]));
				});
				httpSelect.appendChild(E('option', { value: '__custom__' }, ['Custom…']));

				httpSelect.addEventListener('change', function(ev) {
					var v = ev.target.value;
					if (v === '__custom__') {
						httpCustom.style.display = '';
						httpCustom.value = '';
						httpCustom.focus();
					} else {
						httpCustom.style.display = 'none';
						_setHttp(v);
					}
				});

				var fieldContainer = httpRow.querySelector('.cbi-value-field');
				if (fieldContainer) {
					var descEl = fieldContainer.querySelector('.cbi-value-description');
					fieldContainer.insertBefore(httpSelect, descEl);
					fieldContainer.insertBefore(httpCustom, descEl);
				}

				var found = false;
				for (var i = 0; i < httpSelect.options.length; i++) {
					if (httpSelect.options[i].value === savedHttp) {
						httpSelect.selectedIndex = i;
						found = true;
						break;
					}
				}
				if (!found) {
					httpSelect.value = '__custom__';
					httpCustom.value = savedHttp;
					httpCustom.style.display = '';
				}
			}

			/* ══════════════════════════════════════
			   2. CUSTOM PROXY ROW
			   ══════════════════════════════════════ */

			var proxyRow = mapNode.querySelector('[data-name="mihomo_proxy"]');
			if (proxyRow) {
				var proxyHidden = proxyRow.querySelector('input[type="text"]');
				if (proxyHidden) {
					proxyHidden.style.display = 'none';

					var savedProxies = (proxyHidden.value || '').trim().split('|').filter(Boolean);
					var fetchedProxies = [];
					hasFetched = (savedProxies.length > 0);

					var listContainer = E('div', { id: 'dwtool-custom-list-container' });
					var proxyDelaySpan = E('span', {
						id:    'dwtool-proxy-delay',
						style: 'margin-left:10px;font-weight:bold;vertical-align:middle'
					});

					function updateHiddenValue() {
						var values = [];
						listContainer.querySelectorAll('.proxy-row-item select').forEach(function(sel) {
							if (sel.value) {
								values.push(sel.value);
							}
						});
						proxyHidden.value = values.join('|');
						proxyHidden.dispatchEvent(new Event('change', { bubbles: true }));
						dom.content(proxyDelaySpan, ''); // clear old test results on change
					}

					function createProxyRowElement(selectedValue) {
						var sel = E('select', {
							class: 'cbi-input-select',
							style: 'min-width:240px;vertical-align:middle;display:inline-block;'
						});

						// Populate options based on fetched proxies, falling back to saved/selected
						var listToUse = (fetchedProxies.length > 0) ? fetchedProxies : savedProxies;
						if (listToUse.length === 0) {
							sel.appendChild(E('option', { value: '', disabled: true }, ['— fetch proxies first —']));
						} else {
							// If selectedValue is not in listToUse, add it so it doesn't get lost
							var hasVal = listToUse.indexOf(selectedValue) !== -1;
							if (selectedValue && !hasVal) {
								sel.appendChild(E('option', { value: selectedValue, selected: true }, [selectedValue + ' (saved)']));
							}
							listToUse.forEach(function(p) {
								var opt = E('option', { value: p }, [p]);
								if (p === selectedValue) {
									opt.selected = true;
								}
								sel.appendChild(opt);
							});
						}

						sel.addEventListener('change', function() {
							updateHiddenValue();
						});

						var removeBtn = E('button', {
							class: 'btn cbi-button cbi-button-remove',
							style: 'margin-left:8px;vertical-align:middle;',
							click: function(ev) {
								ev.preventDefault();
								row.parentNode.removeChild(row);
								updateHiddenValue();
							}
						}, ['x']);

						var row = E('div', {
							class: 'proxy-row-item',
							style: 'margin-bottom:8px;'
						}, [sel, removeBtn]);

						return row;
					}

					// Render initial rows
					if (savedProxies.length > 0) {
						savedProxies.forEach(function(p) {
							listContainer.appendChild(createProxyRowElement(p));
						});
					} else {
						listContainer.appendChild(createProxyRowElement(''));
					}

					// Add button
					var addBtn = E('button', {
						class: 'btn cbi-button cbi-button-add',
						style: 'margin-top:4px;vertical-align:middle;',
						click: function(ev) {
							ev.preventDefault();
							listContainer.appendChild(createProxyRowElement(''));
							updateHiddenValue();
						}
					}, ['+ Add Proxy']);

					// Test Delay button
					var testDelayBtn = E('button', {
						class: 'btn cbi-button cbi-button-action',
						style: 'margin-left:8px;margin-top:4px;vertical-align:middle',
						click: function(ev) {
							ev.preventDefault();

							var selected = [];
							listContainer.querySelectorAll('.proxy-row-item select').forEach(function(sel) {
								if (sel.value) {
									selected.push(sel.value);
								}
							});

							if (selected.length === 0) {
								dom.content(proxyDelaySpan, [E('span', { style: 'color:#c62828' }, ['❌ No proxies selected'])]);
								return;
							}

							dom.content(proxyDelaySpan, [E('span', { style: 'color:#888' }, ['⏳ Testing…'])]);

							var apiUrl = m.lookupOption('mihomo_api_url',    'watchdog')[0].formvalue('watchdog') || 'http://127.0.0.1:9090';
							var secret = m.lookupOption('mihomo_api_secret', 'watchdog')[0].formvalue('watchdog') || '';

							var results = [];
							function testNext(index) {
								if (index >= selected.length) {
									dom.content(proxyDelaySpan, [E('span', { style: 'color:#2e7d32' }, [results.join(' | ')])]);
									return;
								}
								var pName = selected[index];
								fs.exec('/usr/share/dwtool/modem_control.sh',
									['test_proxy_delay', apiUrl, secret || 'none', pName]
								).then(function(res) {
									var raw = (res.stdout || '').trim();
									var info = pName + ': ';
									if (raw.indexOf('ERROR:') === 0) {
										info += '❌ err';
									} else {
										try {
											var json = JSON.parse(raw);
											if (json && json.delay) {
												info += json.delay + 'ms';
											} else if (json && json.message) {
												info += '❌ ' + json.message;
											} else {
												info += '⚠️ offline';
											}
										} catch(e) {
											info += '❌ err';
										}
									}
									results.push(info);
									testNext(index + 1);
								}).catch(function(err) {
									results.push(pName + ': ❌ err');
									testNext(index + 1);
								});
							}
							testNext(0);
						}
					}, ['Test Delay']);

					// Insert widgets into form field container
					var fieldContainer = proxyRow.querySelector('.cbi-value-field');
					if (fieldContainer) {
						var descEl = fieldContainer.querySelector('.cbi-value-description');
						fieldContainer.insertBefore(listContainer, descEl);
						fieldContainer.insertBefore(addBtn, descEl);
						fieldContainer.insertBefore(testDelayBtn, descEl);
						fieldContainer.insertBefore(proxyDelaySpan, descEl);
					}

					// Global update hook called when proxies are fetched
					window.updateWatchdogProxySelects = function(proxiesList) {
						fetchedProxies = proxiesList;
						hasFetched = true;

						// Re-populate all dropdowns with the complete fetched list
						listContainer.querySelectorAll('.proxy-row-item select').forEach(function(sel) {
							var val = sel.value;
							dom.content(sel, '');
							fetchedProxies.forEach(function(p) {
								var opt = E('option', { value: p }, [p]);
								if (p === val) opt.selected = true;
								sel.appendChild(opt);
							});
						});
					};

					updateProxyRowVisibility = function() {
						var ctRow  = mapNode.querySelector('[data-name="check_type"]');
						var widget = ctRow ? (ctRow.querySelector('select') || ctRow.querySelector('cbi-dropdown')) : null;
						var checkType = widget ? widget.value : (uci.get('dwtool', 'watchdog', 'check_type') || 'direct');
						if (checkType === 'mihomo') {
							proxyRow.style.display = '';
						} else {
							proxyRow.style.display = 'none';
						}
					};
				}
			}

			// Hook change events for visibility updates (works for both standard selects and custom cbi-dropdowns)
			document.addEventListener('change', function(ev) {
				var t = ev.target;
				if (t && (t.getAttribute('name') || t.name || '').indexOf('check_type') !== -1) {
					updateProxyRowVisibility();
				}
			});

			document.addEventListener('cbi-dropdown-change', function(ev) {
				var t = ev.target;
				if (t && (t.getAttribute('name') || t.name || '').indexOf('check_type') !== -1) {
					updateProxyRowVisibility();
				}
			});

			// ── Init after DOM settles ──
			setTimeout(function() {
				// Update proxy row visibility
				updateProxyRowVisibility();

				var pingRow = mapNode.querySelector('[data-name="direct_target_ping"]');
				if (pingRow) {
					injectPingTarget(pingRow);
				}

				var httpRow = mapNode.querySelector('[data-name="direct_target"]');
				if (httpRow) {
					injectHttpTarget(httpRow);
				}
			}, 100);

			/* ══════════════════════════════════════
			   3. LOG CONSOLE (bottom)
			   ══════════════════════════════════════ */
			var logConsole = E('pre', {
				id:    'watchdog-log-console',
				style: 'background:transparent;color:var(--text-color-high,inherit);font-family:monospace;max-height:300px;overflow-y:auto;font-size:.9em;white-space:pre-wrap;padding:0'
			}, ['Loading logs…']);

			mapNode.appendChild(E('div', {
				class: 'cbi-section',
				style: 'margin-top:20px;border-top:1px solid #ccc;padding-top:20px'
			}, [
				E('h3', { class: 'cbi-section-title' }, ['Log']),
				E('div', {
					style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'
				}, [
					E('span', { style: 'font-weight:bold' }, ['Watchdog log (last 20 entries):']),
					E('button', {
						class: 'btn cbi-button cbi-button-remove',
						click: function(ev) {
							ev.preventDefault();
							fs.exec('/usr/share/dwtool/modem_control.sh', ['clear_watchdog_log']).then(function() {
								dom.content(logConsole, ['No watchdog log entries found.']);
							});
						}
					}, ['Clear'])
				]),
				logConsole
			]));

			function pollLogs() {
				fs.read('/tmp/dwtool-watchdog.log').then(function(content) {
					var rawLogs = (content || '').trim();
					var lines = rawLogs ? rawLogs.split('\n').slice(-20) : [];
					dom.content(logConsole,
						[lines.length && lines[0] ? lines.join('\n') : 'No watchdog log entries found.']);
					logConsole.scrollTop = logConsole.scrollHeight;
				}).catch(function() {
					dom.content(logConsole, ['No watchdog log entries found.']);
				});
			}

			pollLogs();
			setInterval(pollLogs, 5000);

			return mapNode;
		});
	}
});

