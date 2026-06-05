'use strict';
'require view';
'require form';
'require fs';
'require ui';
'require uci';

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('dwtool'),
			fs.list('/dev').catch(function() { return []; })
		]);
	},

	render: function(loadResults) {
		var devList = loadResults[1] || [];

		var ports = [];
		devList.forEach(function(entry) {
			var name = entry.name;
			if (name && (name.match(/^ttyUSB\d+$/) || name.match(/^ttyACM\d+$/) || name.match(/^cdc-wdm\d+$/))) {
				ports.push('/dev/' + name);
			}
		});
		ports.sort();

		var m, s, o;

		m = new form.Map('dwtool', 'Dell DW5821e — Settings',
			'General configuration for modem port, boot fix, auto QMI mode, custom AT commands, and Telegram forwarder.');

		/* ── Section: General Settings ── */
		s = m.section(form.NamedSection, 'global', 'dwtool', 'General Settings');
		s.anonymous = true;

		o = s.option(form.ListValue, 'port', 'Modem Serial Port',
			'Serial port used by sms_tool for AT commands and SMS. Usually /dev/ttyUSB0 for Dell DW5821e.');
		ports.forEach(function(p) {
			var label = p;
			if (p === '/dev/ttyUSB0') label += ' (AT — primary)';
			else if (p === '/dev/ttyUSB1') label += ' (AT — secondary)';
			else if (p === '/dev/ttyUSB2') label += ' (GPS)';
			o.value(p, label);
		});
		if (ports.indexOf('/dev/ttyUSB0') === -1) {
			o.value('/dev/ttyUSB0', '/dev/ttyUSB0 (default)');
		}
		o.default = '/dev/ttyUSB0';

		o = s.option(form.Flag, 'boot_fix', 'Enable Boot Fix (AT^RESET)',
			'Send AT^RESET and restart ModemManager at boot. Fixes Dell DW5821e detection race condition on cold boot.');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'auto_qmi', 'Enable Auto QMI Mode (Hotplug)',
			'Hotplug script to switch USB config to QMI mode (cfg=1). Only enable if you need QMI instead of MBIM.');
		o.default = '0';
		o.rmempty = false;

		/* ── Section: Custom AT Commands List ── */
		s = m.section(form.GridSection, 'custom_cmd', 'Custom AT Commands List',
			'Add or modify custom AT commands that will appear in the AT Terminal dropdown list. Saved to /etc/config/dwtool.');
		s.anonymous = true;
		s.addremove = true;
		s.sortable = true;

		o = s.option(form.Value, 'label', 'Label', 'Display label for the command.');
		o.rmempty = false;
		o.placeholder = 'e.g. Check CSQ';

		o = s.option(form.Value, 'command', 'AT Command', 'The actual AT command to execute.');
		o.rmempty = false;
		o.placeholder = 'e.g. AT+CSQ';

		return m.render();
	}
});
