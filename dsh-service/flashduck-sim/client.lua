-- Bind these at installation, never from a model/tool argument.
local json = require('json')
local capability = require('capability')
local M = {}
local actions = {look_left=true, look_right=true, stop=true, walk_step=true}
local states = {accepted=true, replied=true, unknown=true, failed=true}
local fields = {duckId=true, requestId=true, action=true}
local function valid_id(s)
  return type(s)=='string' and #s<=64 and s:match('^[A-Za-z0-9_%-]+$')
end
function M.bind(origin, token, duck_id)
  assert(type(origin)=='string' and origin:match('^https?://[%w.:%-]+$'), 'expected bare bridge origin')
  assert(type(token)=='string' and #token>0 and not token:find('[%c%s]'), 'invalid token')
  assert(valid_id(duck_id),'invalid duck id')
  local function request(method,cmd)
    if type(cmd)~='table' or not actions[cmd.action] or cmd.duckId~=duck_id or not valid_id(cmd.requestId) then return nil,'invalid_command' end
    for k in pairs(cmd) do if not fields[k] then return nil,'invalid_command' end end
    local p={method=method, url=origin..'/v1/duck/commands', headers={Authorization='Bearer '..token}, timeout_ms=5000, max_body_bytes=4096}
    if method=='POST' then
      p.headers['Content-Type']='application/json'; p.body=json.encode(cmd)
    else
      p.url=p.url..'/'..cmd.requestId
    end
    local ok,out,err=capability.call('http_request',p)
    -- Transport failure is not proof of non-delivery. Never re-POST automatically.
    if not ok or type(out)~='string' then return nil,'transport_unknown' end
    local code,raw=out:match('^HTTP (%d%d%d)\r?\n(.*)$')
    if not code then return nil,'invalid_response' end
    if tonumber(code)<200 or tonumber(code)>=300 then return nil,'http_'..code end
    local parsed,r=pcall(json.decode,raw)
    if not parsed or type(r)~='table' or r.requestId~=cmd.requestId or r.duckId~=duck_id or r.action~=cmd.action or not states[r.status] or (r.mode~='simulation' and r.mode~='hardware') or r.motionVerified~=false then return nil,'invalid_response' end
    return {requestId=r.requestId,duckId=r.duckId,action=r.action,status=r.status,mode=r.mode,motionVerified=false}
  end
  return {submit=function(cmd) return request('POST',cmd) end,
    status=function(cmd) return request('GET',cmd) end}
end
return M
