-- Trusted host tool, not a UI component. Run on a cancellable worker, not the UI thread.
-- The host must grant one exclusive, non-replayable intent for this paired duck.
-- `look` is the existing duck_look.lua client bound to this station.
local function bind(look, host)
  assert(type(look.invoke)=='function' and type(look.status)=='function')
  for _,key in ipairs({'acquire','valid','release','now_ms','wait_ms'}) do assert(type(host[key])=='function',key) end
  local function invoke(args,ctx)
    local id=type(ctx)=='table' and ctx.requestId or nil
    local mode=nil
    local function result(status,n,why)
      return {requestId=id,status=status,stepsFinished=n,motionVerified=false,mode=mode,reason=why}
    end
    if type(args)~='table' or next(args)~=nil then return result('rejected',0,'invalid_arguments') end
    -- Reserve the suffix for the three independent idempotent wire requests.
    if type(id)~='string' or #id>58 or not id:match('^[A-Za-z0-9_%-]+$') then return result('rejected',0,'invalid_request_id') end
    local lease=host.acquire(ctx); if not lease then return result('rejected',0,'busy_or_duplicate') end
    local finished=0
    local ok,r=pcall(function()
      local deadline=host.now_ms()+15000
      for i,dir in ipairs({'slight_left','slight_right','center'}) do
        if not host.valid(lease) then return result('cancelled',finished,'no_new_steps') end
        if host.now_ms()>=deadline then return result('timeout',finished,'no_new_steps') end
        local stepId=id..'_scan'..i
        local params={direction=dir}
        local row=look.invoke(params,stepId) -- exactly one POST per step, even on failure
        for poll=0,16 do
          if type(row)~='table' or not row.ok then return result('unknown',finished,'inspect_last_step') end
          if mode and mode~=row.mode then return result('unknown',finished,'mode_changed') end
          mode=row.mode
          if row.status=='command_finished' then finished=finished+1; break end
          if row.status=='failed' then return result('failed',finished,'step_failed') end
          if row.status~='accepted' or poll==16 or host.now_ms()>=deadline then return result('unknown',finished,'inspect_last_step') end
          host.wait_ms(200)
          if not host.valid(lease) then return result('cancelled',finished,'inflight_step_may_finish') end
          if host.now_ms()>=deadline then return result('unknown',finished,'inspect_last_step') end
          row=look.status(params,stepId) -- GET, never a movement request
        end
        if i<3 then host.wait_ms(300) end
      end
      return result('command_finished',finished)
    end)
    host.release(lease)
    if not ok then return result('unknown',finished,'host_error') end
    return r
  end
  return {invoke=invoke}
end
return {bind=bind}
