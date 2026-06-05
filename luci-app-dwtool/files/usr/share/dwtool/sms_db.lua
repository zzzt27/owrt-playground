#!/usr/bin/lua
-- /usr/share/dwtool/sms_db.lua

local json = require "luci.jsonc"

local hist_path = "/etc/dwtool_sms_history.json"

local function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local content = f:read("*all")
    f:close()
    return content
end

local function write_file(path, content)
    local f = io.open(path, "w")
    if not f then return false end
    f:write(content)
    f:close()
    return true
end

local action = arg[1]

if action == "list" then
    -- Read live JSON from stdin
    local live_str = io.read("*all")
    local live = json.parse(live_str) or {}
    
    local hist_str = read_file(hist_path) or "[]"
    local hist = json.parse(hist_str) or {}
    
    local existing = {}
    for _, msg in ipairs(hist) do
        local key = (msg.from or "") .. "_" .. (msg.date or "") .. "_" .. (msg.text or "")
        existing[key] = true
    end
    
    local updated = false
    -- We process live messages.
    for i = 1, #live do
        local msg = live[i]
        local key = (msg.from or "") .. "_" .. (msg.date or "") .. "_" .. (msg.text or "")
        if not existing[key] then
            -- Generate a history-specific ID
            local new_id = tostring(os.time()) .. "_" .. tostring(math.random(1000, 9999))
            local entry = {
                index = new_id,
                from = msg.from or "Unknown",
                date = msg.date or "Unknown",
                text = msg.text or "",
                modem_index = msg.index -- track modem storage index for clean deletion
            }
            table.insert(hist, entry)
            existing[key] = true
            updated = true
        end
    end
    
    if updated then
        write_file(hist_path, json.stringify(hist, true))
    end
    
    -- Print entire history sorted descending (newest first)
    table.sort(hist, function(a, b)
        return (a.index or "") > (b.index or "")
    end)
    
    print(json.stringify(hist, true))

elseif action == "delete" then
    local delete_id = arg[2]
    if not delete_id then
        print("Error: missing delete ID")
        os.exit(1)
    end
    
    local hist_str = read_file(hist_path) or "[]"
    local hist = json.parse(hist_str) or {}
    
    local new_hist = {}
    local modem_index = nil
    local is_all = (delete_id == "all")
    
    for _, msg in ipairs(hist) do
        if is_all then
            if msg.modem_index then
                if not modem_index then
                    modem_index = tostring(msg.modem_index)
                else
                    modem_index = modem_index .. " " .. tostring(msg.modem_index)
                end
            end
        else
            if msg.index == delete_id then
                modem_index = msg.modem_index
            else
                table.insert(new_hist, msg)
            end
        end
    end
    
    write_file(hist_path, json.stringify(new_hist, true))
    
    -- If there's modem indices associated, print them to stdout so shell can delete
    if modem_index then
        print(modem_index)
    end
end
