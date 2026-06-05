'use strict';
'require view';
'require fs';
'require ui';
'require dom';

var PROFILES_PATH = '/etc/dwtool_imei_profiles.json';

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(fs.read(PROFILES_PATH), '[]'),
			fs.exec('/usr/share/dwtool/imei_manager.sh', ['get']).then(function(res) {
				try { return JSON.parse(res.stdout); }
				catch(e) { return { status: 'error', message: 'Modem is not responding.' }; }
			}).catch(function() {
				return { status: 'error', message: 'Modem is not responding.' };
			})
		]);
	},

	render: function(loadResults) {
		var self = this;
		var profilesRaw = loadResults[0];
		var imeiData = loadResults[1] || {};

		var profiles = [];
		try { profiles = JSON.parse(profilesRaw); }
		catch(e) { profiles = []; }
		if (!Array.isArray(profiles)) profiles = [];

		function isValidImei(imei) {
			return /^\d{15}$/.test(imei);
		}

		/* ── Save profiles array to JSON file on router ── */
		function saveProfiles() {
			return fs.write(PROFILES_PATH, JSON.stringify(profiles, null, 2));
		}

		/* ── Current IMEI Card ── */
		var statusCard = E('div', {
			style: 'padding:20px; border-radius:8px; border:1px solid var(--border-color-low,#444); display:flex; flex-direction:column; gap:12px; margin-bottom:20px'
		});

		function updateStatusCard(data) {
			var currentImei = data.imei || '';
			var isBlank = (data.status === 'error' || !currentImei);

			var blankWarning = isBlank ? E('div', {
				style: 'margin-top:12px; padding:12px 15px; border-radius:6px; background:rgba(244,67,54,0.12); border:1px solid #f44336; color:#f44336; font-weight:bold'
			}, [
				'⚠️ IMEI is blank or unreadable! The modem IMEI was erased but not yet written. ',
				E('br'),
				E('span', { style: 'font-weight:normal; font-size:0.95em' },
					'Use the Quick Change field below or apply a saved profile to restore your IMEI.')
			]) : null;

			dom.content(statusCard, [
				E('div', { style: 'display:flex; justify-content:space-between; align-items:center' }, [
					E('span', { style: 'font-size:1.2em; font-weight:bold; color:var(--text-color-medium,#333)' }, 'Current Modem IMEI'),
					E('button', {
						class: 'btn cbi-button',
						style: 'padding:4px 12px; font-weight:bold; border-radius:6px; min-width:130px; display:inline-flex; align-items:center; justify-content:center',
						click: function(ev) {
							var btn = ev.currentTarget;
							btn.setAttribute('disabled', 'true');
							
							dom.content(btn, ['Refreshing...']);

							fs.exec('/usr/share/dwtool/imei_manager.sh', ['get']).then(function(res) {
								try {
									var r = JSON.parse(res.stdout);
									updateStatusCard(r);
									
									dom.content(btn, [
										E('span', { style: 'color:#4caf50; font-weight:bold' }, ['Refreshed!'])
									]);
								} catch(e) {
									dom.content(btn, [
										E('span', { style: 'color:#f44336; font-weight:bold' }, ['Failed'])
									]);
								}
								setTimeout(function() {
									btn.removeAttribute('disabled');
									dom.content(btn, ['Refresh Status']);
								}, 1500);
							}).catch(function() {
								dom.content(btn, [
									E('span', { style: 'color:#f44336; font-weight:bold' }, ['Failed'])
								]);
								setTimeout(function() {
									btn.removeAttribute('disabled');
									dom.content(btn, ['Refresh Status']);
								}, 1500);
							});
						}
					}, ['Refresh Status'])
				]),
				blankWarning || E('span'),
				E('div', { style: 'display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-top:10px; align-items:center' }, [
					E('div', {}, [
						E('span', { style: 'color:#888; font-size:0.9em; display:block' }, 'Active IMEI:'),
						E('span', { style: 'font-family:monospace; font-size:1.5em; font-weight:bold; color:' + (isBlank ? '#f44336' : '#2196f3') }, isBlank ? '⚠ Blank / Unknown' : currentImei)
					]),
					E('div', { style: 'text-align:right' }, [
						E('button', {
							class: 'btn cbi-button-action important',
							style: 'padding:6px 16px; font-size:0.95em; font-weight:bold',
							click: function() {
								if (currentImei === 'Unknown' || !isValidImei(currentImei)) {
									ui.addNotification(null, E('p', {}, 'Active IMEI is invalid or modem is disconnected.'), 'error');
									return;
								}

								var modalBody = E('div', { style: 'padding:10px; display:flex; flex-direction:column; gap:12px' }, [
									E('p', { style: 'font-style:italic; color:#888' },
										'Save your current active IMEI (' + currentImei + ') as a profile.'),
									E('div', {}, [
										E('label', { style: 'font-weight:bold; display:block; margin-bottom:4px' }, 'Profile Name:'),
										E('input', {
											type: 'text',
											id: 'backup-profile-name',
											value: 'Original IMEI (Backup)',
											style: 'width:100%'
										})
									])
								]);

								ui.showModal('Backup IMEI to Profile', [
									modalBody,
									E('div', { class: 'right', style: 'margin-top:15px; display:flex; gap:8px; justify-content:flex-end' }, [
										E('button', {
											class: 'btn cbi-button-reset',
											click: function() { ui.hideModal(); }
										}, ['Cancel']),
										E('button', {
											class: 'btn cbi-button-action important',
											click: function() {
												var name = document.querySelector('#backup-profile-name').value.trim();
												if (!name) { alert('Please enter a profile name!'); return; }

												profiles.push({ name: name, imei: currentImei });
												saveProfiles().then(function() {
													renderProfiles();
													ui.hideModal();
													ui.addNotification(null, E('p', {}, 'IMEI saved as profile "' + name + '"!'), 'ok');
												});
											}
										}, ['Save Profile'])
									])
								]);
							}
						}, ['Backup Current IMEI to Profile'])
					])
				])
			]);
		}

		updateStatusCard(imeiData);

		/* ── Full-screen loading overlay with live syslog viewer ── */
		var consoleBox = null;
		var printedLogs = {};

		function addConsole(text, color) {
			if (!consoleBox) return;
			var time = new Date().toLocaleTimeString();
			var msg = '[' + time + '] ' + text;
			var el = E('div', {
				style: (color ? 'color:' + color + ';' : 'color:#ececec;') + 'margin-bottom:3px; line-height:1.4'
			}, [msg]);
			consoleBox.appendChild(el);
			consoleBox.scrollTop = consoleBox.scrollHeight;
		}

		function fetchSystemLogs() {
			fs.exec('/sbin/logread', []).then(function(res) {
				if (!res || !res.stdout) return;
				var lines = res.stdout.split('\n');
				lines.forEach(function(line) {
					if (!line) return;
					// Filter for USB / modem bus related kernel / tool messages
					if (/usb|option|ttyUSB|ttyACM|dw5821|cdc_wdm|modem|sms_tool/i.test(line)) {
						if (!printedLogs[line]) {
							printedLogs[line] = true;
							// Clean up syslog timestamp prefix for cleaner view
							var cleanLine = line.replace(/^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d+:\d+:\d+\s+\d+\s+/, '');
							addConsole(cleanLine, '#a8ff60');
						}
					}
				});
			}).catch(function() {});
		}

		function showOverlay(title, msg) {
			var existing = document.getElementById('imei-overlay');
			if (existing) existing.remove();

			var style = document.getElementById('imei-overlay-style');
			if (!style) {
				style = E('style', { id: 'imei-overlay-style' }, [
					'@keyframes imei-spin { to { transform: rotate(360deg); } }'
				]);
				document.head.appendChild(style);
			}

			var statusEl = E('p', {
				id: 'imei-overlay-status',
				style: 'color:#2196f3; font-size:1.1em; font-weight:bold; margin:0; text-align:center; max-width:600px'
			}, [msg]);

			consoleBox = E('div', {
				id: 'imei-console-log',
				style: 'width:85%; max-width:800px; height:250px; background:#121212; border:1px solid #333; ' +
				       'border-radius:6px; font-family:monospace; font-size:11px; color:#ececec; ' +
				       'padding:12px; overflow-y:auto; text-align:left; box-shadow:inset 0 0 10px #000; margin-top:10px'
			});

			printedLogs = {};

			var overlay = E('div', {
				id: 'imei-overlay',
				style: 'position:fixed; top:0; left:0; width:100vw; height:100vh; ' +
				       'background:rgba(18,18,18,0.95); z-index:99999; display:flex; ' +
				       'flex-direction:column; align-items:center; justify-content:center; gap:15px'
			}, [
				E('div', {
					id: 'imei-overlay-spinner',
					style: 'width:56px; height:56px; border:5px solid #222; ' +
					       'border-top-color:#2196f3; border-radius:50%; ' +
					       'animation:imei-spin 0.9s linear infinite'
				}),
				E('h2', { style: 'color:#fff; margin:0; font-size:1.5em; text-align:center' }, [title]),
				statusEl,
				consoleBox
			]);
			document.body.appendChild(overlay);
			return overlay;
		}

		function updateOverlayStatus(msg) {
			var el = document.getElementById('imei-overlay-status');
			if (el) el.textContent = msg;
		}

		function hideOverlay() {
			var el = document.getElementById('imei-overlay');
			if (el) el.remove();
		}

		function addCloseButton(isSuccess) {
			var overlay = document.getElementById('imei-overlay');
			if (!overlay) return;

			var spinner = document.getElementById('imei-overlay-spinner');
			if (spinner) {
				if (isSuccess) {
					dom.content(spinner, []);
					spinner.removeAttribute('style');
					spinner.setAttribute('style', 'font-size:3.5em; line-height:1; margin:0; text-align:center');
					spinner.textContent = '✅';
				} else {
					spinner.remove();
				}
			}

			if (document.getElementById('imei-overlay-close-btn')) return;
			
			var btnText = isSuccess ? 'OK' : 'Close Console';
			var btnBg = isSuccess ? '#4caf50' : '#f44336';
			var btnClass = isSuccess ? 'btn cbi-button-action important' : 'btn cbi-button-remove';

			var closeBtn = E('button', {
				id: 'imei-overlay-close-btn',
				class: btnClass,
				style: 'padding:8px 24px; font-weight:bold; margin-top:15px; border-radius:6px; background-color:' + btnBg + '; color:#fff',
				click: function() { hideOverlay(); }
			}, [btnText]);
			overlay.appendChild(closeBtn);
		}

		/* Helper: poll modem until ATI responds, then run a callback */
		function pollModemUp(label, logInterval, onReady, requireImei, onTimeout) {
			var count = 0;
			/* Automatically require valid IMEI if label contains 'verify' */
			var reqImei = (requireImei === true || (label && label.indexOf('verify') !== -1));

			addConsole(label + ': Waiting for modem USB re-enumeration...', '#00bcd4');
			if (reqImei) addConsole('   (Waiting for valid IMEI from ATI before proceeding)', '#888');
			var interval = setInterval(function() {
				count++;
				updateOverlayStatus(label + '... ' + (count * 2).toFixed(0) + 's elapsed.');

				fs.exec('/usr/share/dwtool/imei_manager.sh', ['get']).then(function(res) {
					try {
						var r = JSON.parse(res.stdout);

						if (reqImei) {
							if (r.status === 'success' && r.imei && !/^0+$/.test(r.imei)) {
								clearInterval(interval);
								addConsole('✅ Modem online with IMEI: ' + r.imei, '#4caf50');
								if (onReady) onReady(r);
							}
						} else {
							if (r.status === 'success' || (r.status === 'error' && r.message)) {
								clearInterval(interval);
								addConsole('✅ Modem is back online!', '#4caf50');
								if (r.imei) addConsole('   Current IMEI reported: ' + r.imei, '#a8ff60');
								if (onReady) onReady(r);
							}
						}
					} catch(e) {}
				}).catch(function() {});

				if (count >= 50) {
					clearInterval(interval);
					clearInterval(logInterval);
					addConsole('❌ Timeout waiting for modem at "' + label + '".', '#f44336');
					updateOverlayStatus('❌ Timeout');
					addCloseButton();
					if (onTimeout) onTimeout();
				}
			}, 2000);
		}

		/* ── Full NV550 Flow: read → erase → reboot#1 → write → reboot#2 → verify ── */
		function triggerImeiSequence(targetImei) {
			if (!isValidImei(targetImei)) {
				ui.addNotification(null, E('p', {}, 'Invalid IMEI! Must be 15 digits.'), 'error');
				return;
			}

			showOverlay('Applying IMEI Profile', 'Initializing sequence...');

			addConsole('Starting IMEI modification sequence...', '#00bcd4');
			addConsole('Target IMEI: ' + targetImei, '#ffeb3b');

			var currentStep = 1;
			var logInterval = setInterval(fetchSystemLogs, 2000);

			/* ─── Step 1/6: Read current NV550 ─── */
			addConsole('Step 1/6: Reading current NV550 data...', '#ffe082');
			fs.exec('/usr/share/dwtool/imei_manager.sh', ['read_nv']).then(function(res) {
				var r;
				try { r = JSON.parse(res.stdout); } catch(e) { r = { status: 'error', message: res.stdout }; }

				if (r.status === 'success' && r.hex) {
					addConsole('   NV550 hex: ' + r.hex.substring(0, 50) + '...', '#a8ff60');
					addConsole('   IMEI data exists in NV RAM. Proceeding to erase.', '#a8ff60');
				} else {
					addConsole('   NV550 is already empty/cleared. Proceeding to erase anyway.', '#ff9800');
				}

				/* ─── Step 2/6: Erase NV550 ─── */
				currentStep = 2;
				addConsole('Step 2/6: Erasing NV550 (AT^NV=550,"0")...', '#ffe082');
				return fs.exec('/usr/share/dwtool/imei_manager.sh', ['erase']);
			}).then(function(res) {
				if (!res) return;
				var r;
				try { r = JSON.parse(res.stdout); } catch(e) { r = { status: 'error', message: res.stdout }; }

				if (r.status === 'success') {
					addConsole('✅ ' + r.message, '#4caf50');
				} else {
					addConsole('⚠️ Erase response: ' + r.message, '#ff9800');
					addConsole('   Continuing anyway — reboot will finalize erasure.', '#ff9800');
				}

				/* ─── Step 3/6: Reboot #1 (apply erasure) ─── */
				currentStep = 3;
				addConsole('Step 3/6: Rebooting modem to apply erasure (AT+CFUN=1,1)...', '#ffe082');
				updateOverlayStatus('Reboot #1 — erasing old IMEI...');
				return fs.exec('/usr/share/dwtool/imei_manager.sh', ['reboot']);
			}).then(function(res) {
				if (!res) return;
				currentStep = 4;
				addConsole('✅ Reboot #1 scheduled. Modem shutting down...', '#4caf50');

				/* ─── Step 4/6: Wait for modem to come back up after erase ─── */
				pollModemUp('Reboot #1 (erase)', logInterval, function(modemState) {
					currentStep = 5;
					addConsole('   Post-erase state: modem firmware booted.', '#a8ff60');
					
					/* ─── Step 5/6: Write new IMEI to NV550 ─── */
					addConsole('Step 5/6: Writing new IMEI to NV550...', '#ffe082');
					updateOverlayStatus('Writing IMEI to NV RAM...');

					fs.exec('/usr/share/dwtool/imei_manager.sh', ['write', targetImei]).then(function(resW) {
						var rw;
						try { rw = JSON.parse(resW.stdout); } catch(e) { rw = { status: 'error', message: resW.stdout }; }

						if (rw.status !== 'success') {
							addConsole('❌ Write failed: ' + rw.message, '#f44336');
							clearInterval(logInterval);
							updateOverlayStatus('❌ Failed: Write rejected');
							addCloseButton(false);
							return;
						}

						addConsole('✅ IMEI written! Hex: ' + (rw.hex || 'n/a'), '#4caf50');

						/* ─── Step 6/6: Reboot #2 (apply new IMEI) ─── */
						addConsole('Step 6/6: Rebooting modem to apply new IMEI (AT+CFUN=1,1)...', '#ffe082');
						updateOverlayStatus('Reboot #2 — applying new IMEI...');

						fs.exec('/usr/share/dwtool/imei_manager.sh', ['reboot']).then(function() {
							addConsole('✅ Reboot #2 scheduled. Waiting for modem...', '#4caf50');
						}).catch(function() {
							addConsole('⚠️ Connection dropped (expected during reboot).', '#ff9800');
						});

						/* Poll for final verification — wait for valid IMEI */
						setTimeout(function() {
							pollModemUp('Reboot #2 (verify)', logInterval, function(finalState) {
								clearInterval(logInterval);
								if (finalState.imei && finalState.imei === targetImei) {
									addConsole('', '');
									addConsole('══════════════════════════════════════', '#4caf50');
									addConsole('🎉 SUCCESS! IMEI verified: ' + finalState.imei, '#4caf50');
									addConsole('══════════════════════════════════════', '#4caf50');
									updateOverlayStatus('✅ Complete! IMEI: ' + finalState.imei);
								} else if (finalState.imei) {
									addConsole('⚠️ Modem IMEI: ' + finalState.imei + ' (expected: ' + targetImei + ')', '#ff9800');
									updateOverlayStatus('⚠️ IMEI mismatch — check manually');
								} else {
									addConsole('✅ Modem online but IMEI not yet readable.', '#ff9800');
									updateOverlayStatus('⚠️ Modem online — IMEI pending');
								}
								updateStatusCard(finalState);
								addCloseButton(finalState.imei === targetImei);
							});
						}, 3000);

					}).catch(function(errW) {
						addConsole('❌ XHR error during write: ' + errW, '#f44336');
						clearInterval(logInterval);
						updateOverlayStatus('❌ Failed: XHR Error');
						addCloseButton(false);
					});
				});

			}).catch(function(err) {
				if (currentStep >= 5) {
					return; // Already completed reboot#1 and writing/reboot#2, ignore drop
				}
				addConsole('⚠️ Connection interrupted: ' + err, '#ff9800');
				addConsole('   Modem may already be rebooting. Polling for return...', '#ff9800');
				
				/* If reboot#1 XHR dropped, still try to poll & continue */
				pollModemUp('Reboot #1 (recovery)', logInterval, function(modemState) {
					currentStep = 5;
					addConsole('Step 5/6: Writing new IMEI to NV550...', '#ffe082');
					updateOverlayStatus('Writing IMEI to NV RAM...');

					fs.exec('/usr/share/dwtool/imei_manager.sh', ['write', targetImei]).then(function(resW) {
						var rw;
						try { rw = JSON.parse(resW.stdout); } catch(e) { rw = { status: 'error', message: resW.stdout }; }

						if (rw.status !== 'success') {
							addConsole('❌ Write failed: ' + rw.message, '#f44336');
							clearInterval(logInterval);
							updateOverlayStatus('❌ Failed: Write rejected');
							addCloseButton(false);
							return;
						}

						addConsole('✅ IMEI written! Hex: ' + (rw.hex || 'n/a'), '#4caf50');
						addConsole('Step 6/6: Final reboot (AT+CFUN=1,1)...', '#ffe082');
						updateOverlayStatus('Reboot #2 — applying new IMEI...');

						fs.exec('/usr/share/dwtool/imei_manager.sh', ['reboot']).catch(function() {});

						setTimeout(function() {
							pollModemUp('Reboot #2 (verify)', logInterval, function(finalState) {
								clearInterval(logInterval);
								addConsole('', '');
								addConsole('══════════════════════════════════════', '#4caf50');
								addConsole('🎉 IMEI process complete! IMEI: ' + (finalState.imei || 'checking...'), '#4caf50');
								addConsole('══════════════════════════════════════', '#4caf50');
								updateOverlayStatus('✅ Complete!');
								updateStatusCard(finalState);
								addCloseButton(finalState.imei === targetImei);
							});
						}, 3000);

					}).catch(function(errW) {
						addConsole('❌ XHR error during write: ' + errW, '#f44336');
						clearInterval(logInterval);
						addCloseButton(false);
					});
				});
			});
		}

		/* ── Profile Cards ── */
		var profileListWrap = E('div', {
			style: 'display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:15px; margin-top:15px'
		});

		function renderProfiles() {
			dom.content(profileListWrap, []);

			if (profiles.length === 0) {
				profileListWrap.style.display = 'block';
				dom.content(profileListWrap, E('div', {
					style: 'padding:30px; text-align:center; border:1px dashed #555; border-radius:6px; color:#888; font-style:italic'
				}, ['No saved IMEI profiles. Use "Backup Current IMEI" or "Add Custom Profile" to get started.']));
				return;
			}

			profileListWrap.style.display = 'grid';
			profiles.forEach(function(p, idx) {
				var card = E('div', {
					style: 'padding:15px; border-radius:6px; border:1px solid var(--border-color-low,#444); display:flex; flex-direction:column; gap:10px; justify-content:space-between; min-height:130px'
				}, [
					E('div', {}, [
						E('div', { style: 'font-weight:bold; font-size:1.1em; color:var(--text-color-medium,#333)' }, [p.name]),
						E('div', { style: 'font-family:monospace; font-size:1.2em; font-weight:bold; color:#ff5722; margin-top:5px' }, [p.imei])
					]),
					E('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-top:8px' }, [
						E('button', {
							class: 'btn cbi-button-remove',
							style: 'padding:2px 8px; font-size:0.85em',
							click: function() {
								if (confirm('Delete profile "' + p.name + '"?')) {
									profiles.splice(idx, 1);
									saveProfiles().then(function() { renderProfiles(); });
								}
							}
						}, ['Delete']),
						E('button', {
							class: 'btn cbi-button-action important',
							style: 'padding:4px 12px; font-size:0.9em',
							click: function() {
								if (confirm('Apply IMEI from profile "' + p.name + '"? Modem will reboot twice.')) {
									triggerImeiSequence(p.imei);
								}
							}
						}, ['Apply Profile'])
					])
				]);
				profileListWrap.appendChild(card);
			});
		}

		renderProfiles();

		/* ── Export ── */
		var exportBtn = E('button', {
			class: 'btn cbi-button-reset',
			style: 'padding:4px 12px; font-size:0.9em; font-weight:bold; background-color:#2196f3; color:#fff',
			click: function() {
				if (profiles.length === 0) { alert('No profiles to export!'); return; }
				var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profiles, null, 2));
				var a = E('a', { href: dataStr, download: 'dwtool_imei_profiles.json', style: 'display:none' });
				document.body.appendChild(a); a.click(); document.body.removeChild(a);
				ui.addNotification(null, E('p', {}, 'Profiles exported!'), 'ok');
			}
		}, ['📤 Export']);

		/* ── Import ── */
		var importBtn = E('button', {
			class: 'btn cbi-button-reset',
			style: 'padding:4px 12px; font-size:0.9em; font-weight:bold; background-color:#4caf50; color:#fff',
			click: function() {
				var fileInput = E('input', {
					type: 'file', accept: '.json', style: 'display:none',
					change: function(ev) {
						var file = ev.target.files[0];
						if (!file) return;
						var reader = new FileReader();
						reader.onload = function(e) {
							try {
								var imported = JSON.parse(e.target.result);
								if (!Array.isArray(imported)) { alert('Invalid format! Must be a JSON array.'); return; }
								var valid = imported.filter(function(x) { return x.name && isValidImei(x.imei); });
								if (valid.length === 0) { alert('No valid profiles found.'); return; }
								if (confirm('Import ' + valid.length + ' profiles?')) {
									valid.forEach(function(x) { profiles.push({ name: x.name, imei: x.imei }); });
									saveProfiles().then(function() {
										renderProfiles();
										ui.addNotification(null, E('p', {}, 'Imported ' + valid.length + ' profiles!'), 'ok');
									});
								}
							} catch(err) { alert('Failed to parse JSON: ' + err.message); }
						};
						reader.readAsText(file);
					}
				});
				document.body.appendChild(fileInput); fileInput.click();
				setTimeout(function() { document.body.removeChild(fileInput); }, 1000);
			}
		}, ['📥 Import']);

		/* ── Add Profile ── */
		var addBtn = E('button', {
			class: 'btn cbi-button-add',
			click: function() {
				var modalBody = E('div', { style: 'padding:10px; display:flex; flex-direction:column; gap:12px' }, [
					E('div', {}, [
						E('label', { style: 'font-weight:bold; display:block; margin-bottom:4px' }, 'Profile Name:'),
						E('input', { type: 'text', id: 'new-profile-name', placeholder: 'e.g. iPhone 15 Pro', style: 'width:100%' })
					]),
					E('div', {}, [
						E('label', { style: 'font-weight:bold; display:block; margin-bottom:4px' }, '15-Digit IMEI:'),
						E('input', {
							type: 'text',
							id: 'new-profile-imei',
							placeholder: 'e.g. 352819123456789',
							style: 'width:100%; font-family:monospace',
							maxlength: 15,
							input: function(ev) {
								ev.target.value = ev.target.value.replace(/\D/g, '').substring(0, 15);
							}
						})
					])
				]);

				ui.showModal('Add New IMEI Profile', [
					modalBody,
					E('div', { class: 'right', style: 'margin-top:15px; display:flex; gap:8px; justify-content:flex-end' }, [
						E('button', { class: 'btn cbi-button-reset', click: function() { ui.hideModal(); } }, ['Cancel']),
						E('button', {
							class: 'btn cbi-button-action important',
							click: function() {
								var name = document.querySelector('#new-profile-name').value.trim();
								var imei = document.querySelector('#new-profile-imei').value.trim();
								if (!name) { alert('Please enter a name!'); return; }
								if (!isValidImei(imei)) { alert('Invalid IMEI! Must be 15 digits.'); return; }

								profiles.push({ name: name, imei: imei });
								saveProfiles().then(function() {
									renderProfiles();
									ui.hideModal();
									ui.addNotification(null, E('p', {}, 'Profile "' + name + '" added!'), 'ok');
								});
							}
						}, ['Save'])
					])
				]);
			}
		}, ['➕ Add Custom Profile']);

		/* ── Quick Change ── */
		var manualInput = E('input', {
			type: 'text',
			placeholder: 'Enter 15-digit IMEI...',
			style: 'width:60%; font-family:monospace',
			maxlength: 15,
			input: function(ev) {
				ev.target.value = ev.target.value.replace(/\D/g, '').substring(0, 15);
			}
		});

		var manualSection = E('div', {
			style: 'padding:15px; border-radius:6px; border:1px solid var(--border-color-low,#444); margin-bottom:20px'
		}, [
			E('div', { style: 'width:100%' }, [
				E('label', { style: 'font-weight:bold; display:block; margin-bottom:4px' }, 'Direct IMEI Change (Quick Change)'),
				E('div', { style: 'display:flex; align-items:center; gap:10px' }, [
					manualInput,
					E('button', {
						class: 'btn cbi-button-action important',
						click: function() {
							var val = manualInput.value.trim();
							if (!isValidImei(val)) {
								ui.addNotification(null, E('p', {}, 'Invalid IMEI! Must be 15 digits.'), 'error');
								return;
							}
							if (confirm('Apply IMEI ' + val + '? Modem will reboot.'))
								triggerImeiSequence(val);
						}
					}, ['Apply IMEI'])
				])
			])
		]);

		/* ── Assemble ── */
		return E('div', { class: 'cbi-map' }, [
			E('h2', {}, 'Dell DW5821e — IMEI Changer'),
			E('div', { class: 'cbi-map-descr' },
				'IMEI management and backup utility for the Dell DW5821e (Snapdragon X20 LTE) modem. ' +
				'Profiles are stored in /etc/dwtool_imei_profiles.json for easy portability.'),
			E('hr'),
			statusCard,
			manualSection,
			E('div', { class: 'cbi-section' }, [
				E('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px' }, [
					E('h3', {}, 'Saved IMEI Profiles'),
					E('div', { style: 'display:flex; gap:8px' }, [ importBtn, exportBtn, addBtn ])
				]),
				E('div', { class: 'cbi-section-descr' },
					'Profiles are saved as a portable JSON file. Use Export/Import to migrate between devices.'),
				profileListWrap
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
