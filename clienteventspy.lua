local ReplicatedStorage = game:GetService("ReplicatedStorage")



local onRemoteEvent = function(event)
	local name = event.Name
	local parent = event
	repeat
		parent = parent.Parent
		name = parent.Name .. "." .. name
	until parent == ReplicatedStorage or parent == game or parent == nil

	event.OnClientEvent:Connect(function(...)
		local args = {...}
		local length = #args

		local argTypeString
		local argValueString
		if length == 0 then
			argTypeString = "[]"
			argValueString = "[]"
		else
			argTypeString = "["
			argValueString = "["
			for i = 1, #args - 1 do
				local a = args[i]
				local t = typeof(a)
				local v
				if t == "Instance" then
					t = "Instance - " .. a.ClassName
					v = a:GetFullName()
				else
					v = tostring(a)
				end
				argTypeString = argTypeString ..  t .. ", "
				argValueString = argValueString .. v .. ", "
			end
			local a = args[length]
			local t = typeof(a)
			local v
			if t == "Instance" then
				t = "Instance - " .. a.ClassName
				v = a:GetFullName()
			else
				v = tostring(a)
			end
			argTypeString = argTypeString .. t .. "]"
			argValueString = argValueString .. v .. "]"
		end
		warn("RemoteEvent: " .. event:GetFullName())
		print("Arguments: " .. argTypeString)
		print("Values: " .. argValueString)
	end)
end

local blacklist_names = {
	SetMessage = true
}

for i,v in ReplicatedStorage.Remotes:GetDescendants() do
	if blacklist_names[v.Name] then continue end
	if v:IsA("RemoteEvent") then
		onRemoteEvent(v)
	end
end