#!/usr/bin/lua
-- /usr/share/dwtool/traffic_logger.lua

local fs = require "nixio.fs"
local json = require "luci.jsonc"

local iface = arg[1]
if not iface or iface == "" then
    return
end

local rx_file = "/sys/class/net/" .. iface .. "/statistics/rx_bytes"
local tx_file = "/sys/class/net/" .. iface .. "/statistics/tx_bytes"

if not fs.access(rx_file) or not fs.access(tx_file) then
    return
end

-- Read current bytes
local f_rx = io.open(rx_file, "r")
local f_tx = io.open(tx_file, "r")
local cur_rx = tonumber(f_rx:read("*all") or 0) or 0
local cur_tx = tonumber(f_tx:read("*all") or 0) or 0
f_rx:close()
f_tx:close()

-- Load history
local data = {}
local data_path = "/etc/dwtool_traffic.json"
local f = io.open(data_path, "r")
if f then
    local content = f:read("*all")
    f:close()
    if content and content ~= "" then
        data = json.parse(content) or {}
    end
end

-- Initialize defaults
data.last_rx = data.last_rx or 0
data.last_tx = data.last_tx or 0
data.last_interface = data.last_interface or ""
data.daily = data.daily or {}
data.weekly = data.weekly or {}
data.monthly = data.monthly or {}

-- Calculate difference
local diff_rx = 0
local diff_tx = 0

if data.last_interface == iface then
    if cur_rx >= data.last_rx then
        diff_rx = cur_rx - data.last_rx
    else
        diff_rx = cur_rx
    end
    if cur_tx >= data.last_tx then
        diff_tx = cur_tx - data.last_tx
    else
        diff_tx = cur_tx
    end
else
    diff_rx = cur_rx
    diff_tx = cur_tx
    data.last_interface = iface
end

data.last_rx = cur_rx
data.last_tx = cur_tx

-- Update dates
local date_str = os.date("%Y-%m-%d")
local week_str = os.date("%Y-W%V") -- %V is ISO week number (1-53)
local month_str = os.date("%Y-%m")

-- Helper to update block
local function add_traffic(tbl, key, rx_val, tx_val)
    tbl[key] = tbl[key] or { rx = 0, tx = 0 }
    tbl[key].rx = (tbl[key].rx or 0) + rx_val
    tbl[key].tx = (tbl[key].tx or 0) + tx_val
end

add_traffic(data.daily, date_str, diff_rx, diff_tx)
add_traffic(data.weekly, week_str, diff_rx, diff_tx)
add_traffic(data.monthly, month_str, diff_rx, diff_tx)

-- Helper to purge old entries (keep max N)
local function purge_oldest(tbl, max_keep)
    local keys = {}
    for k, _ in pairs(tbl) do
        table.insert(keys, k)
    end
    if #keys > max_keep then
        table.sort(keys) -- Sort strings alphabetically/chronologically
        for i = 1, #keys - max_keep do
            tbl[keys[i]] = nil
        end
    end
end

purge_oldest(data.daily, 30)
purge_oldest(data.weekly, 12)
purge_oldest(data.monthly, 12)

-- Save history
local f_w = io.open(data_path, "w")
if f_w then
    f_w:write(json.stringify(data, true))
    f_w:close()
end
