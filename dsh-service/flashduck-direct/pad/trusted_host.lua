-- Adapter for a trusted native tool registry. It is NOT an ESP-Claw auto-discovery hook.
-- The registry advertises duck_look.json and passes a trusted stable request ID in ctx.
local json=require('json')
local M={}
function M.bind(client,scan)
  local function dispatch(name,arguments,ctx,poll)
    if name~='duck_look' and not (name=='duck_scan' and scan and not poll) then return {ok=false,error='unknown_tool',motionVerified=false} end
    if type(arguments)=='string' then
      local ok,decoded=pcall(json.decode,arguments)
      if not ok then return {ok=false,error='invalid_arguments',motionVerified=false} end
      arguments=decoded
    end
    if name=='duck_scan' then return scan.invoke(arguments,ctx) end
    local request_id=type(ctx)=='table' and ctx.requestId or nil
    if poll then return client.status(arguments,request_id) end
    return client.invoke(arguments,request_id)
  end
  return {
    invoke=function(name,args,ctx) return dispatch(name,args,ctx,false) end,
    -- Internal reconciliation only; never advertise as a second movement tool.
    poll=function(name,args,ctx) return dispatch(name,args,ctx,true) end,
  }
end
return M
