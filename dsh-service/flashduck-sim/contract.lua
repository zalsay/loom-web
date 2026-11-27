-- scenario is mounted by the test harness. Only fake tokens enter this VM.
local json=require('json')
local cap=require('capability')
local scenario=json.decode(assert(assert(io.open('/duck/scenario.json','r')):read('*a')))
local command=scenario.command
local real_call=cap.call
local sent=0
cap.call=function(name, payload, ...)
  sent=sent+1
  assert(name=='http_request' and payload.method==scenario.method)
  assert(payload.headers.Authorization=='Bearer sim-placeholder')
  if scenario.method=='POST' then
    assert(payload.url==scenario.origin..'/v1/duck/commands' and payload.headers['Content-Type']=='application/json')
    local body=json.decode(payload.body)
    assert(body.duckId==command.duckId and body.action==command.action and body.requestId==command.requestId)
    for k in pairs(body) do assert(k=='duckId' or k=='action' or k=='requestId') end
  else
    assert(payload.url==scenario.origin..'/v1/duck/commands/'..command.requestId and payload.body==nil)
  end
  -- Keep only non-secret request data for the opt-in loopback replay.
  print('DUCK_WIRE '..json.encode({method=payload.method,url=payload.url,body=payload.body,contentType=payload.headers['Content-Type']}))
  return real_call(name,payload,...)
end
local run=dofile('/duck/client.lua').bind(scenario.origin,'sim-placeholder','duck-1')
local result,err
if scenario.method=='GET' then result,err=run.status(command) else result,err=run.submit(command) end
if result then assert(result.mode=='simulation' and result.motionVerified==false) end
assert(sent==scenario.calls, 'unexpected call count '..sent)
local observed=result and result.status or err
assert(observed==scenario.expected,'expected '..scenario.expected..' got '..tostring(observed))
print('DUCK_PASS '..scenario.name..' '..observed)
