-- Contract runner only. No real bearer ever enters the browser VM.
local cap,json=require('capability'),require('json')
local s=json.decode(assert(assert(io.open('/duck/scenario.json','r')):read('*a')))
local count,real_call=0,cap.call
cap.call=function(name,p,...)
  count=count+1
  assert(name=='http_request' and p.method==s.method and p.headers.Authorization=='Bearer sim-placeholder')
  if s.method=='POST' then
    assert(p.url==s.origin..'/v1/duck/look' and p.headers['Content-Type']=='application/json')
    local b=json.decode(p.body)
    assert(b.duckId=='duck-demo' and b.requestId==s.id and b.direction==s.args.direction)
    for k in pairs(b) do assert(k=='duckId' or k=='direction' or k=='requestId') end
  else assert(p.url==s.origin..'/v1/duck/look/'..s.id and p.body==nil) end
  print('WIRE '..json.encode({method=p.method,url=p.url,contentType=p.headers['Content-Type'],body=p.body}))
  if s.transportFailure then return false,nil,'fixture timeout' end
  return real_call(name,p,...)
end
local tool=dofile('/duck/duck_look.lua').bind(s.origin,'sim-placeholder','duck-demo')
local host=dofile('/duck/trusted_host.lua').bind(tool)
assert(host.invoke('other',s.args,{requestId=s.id}).error=='unknown_tool')
assert(host.invoke('duck_look','{',{requestId=s.id}).error=='invalid_arguments')
local r=host[s.method=='GET' and 'poll' or 'invoke']('duck_look',json.encode(s.args),{requestId=s.id})
assert(type(r)=='table' and r.motionVerified==false)
if s.expected=='invalid_request_id' then assert(r.requestId==nil) else assert(r.requestId==s.id) end
assert(count==s.calls,'unexpected capability call count '..count)
assert(r.ok==(s.success==true) and (r.status or r.error)==s.expected,'unexpected result '..json.encode(r))
if r.ok then assert(r.mode=='simulation' and r.duckId=='duck-demo' and r.direction==s.args.direction) end
assert(r.unsolicited==nil)
print('RESULT '..json.encode(r))
