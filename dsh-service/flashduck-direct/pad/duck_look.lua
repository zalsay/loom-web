-- Trusted host binds install-time configuration, and assigns a stable request ID per tool call.
local cap, json = require('capability'), require('json')
local directions = { left=true, slight_left=true, center=true, slight_right=true, right=true }
local statuses = { accepted=true, command_finished=true, failed=true, unknown=true }
local function id(s) return type(s)=='string' and #s<=64 and s:match('^[A-Za-z0-9_%-]+$') end
local function failure(code,request_id)
  return {ok=false,error=code,requestId=request_id,motionVerified=false}
end
local function bind(origin,token,duck_id)
  assert(type(origin)=='string' and (origin:match('^https://[%w%.:%-]+$') or origin:match('^http://127%.0%.0%.1:%d+$')), 'fixed HTTPS or test loopback origin required')
  assert(type(token)=='string' and #token>0 and not token:find('[%c%s]'), 'invalid bearer')
  assert(id(duck_id), 'invalid duck id')
  local function call(method, args, request_id)
    if not id(request_id) then return failure('invalid_request_id') end
    if type(args)~='table' or not directions[args.direction] then return failure('invalid_arguments',request_id) end
    for k in pairs(args) do if k~='direction' then return failure('invalid_arguments',request_id) end end
    local p={method=method,url=origin..'/v1/duck/look',headers={Authorization='Bearer '..token},timeout_ms=3500,max_body_bytes=4096}
    if method=='POST' then
      p.headers['Content-Type']='application/json'
      p.body=json.encode({duckId=duck_id,requestId=request_id,direction=args.direction})
    else p.url=p.url..'/'..request_id end
    -- Never resend even on a timeout: whether the peer received the command is unknown.
    local returned,ok,out=pcall(cap.call,'http_request',p)
    if not returned or not ok or type(out)~='string' then return failure('transport_unknown',request_id) end
    local code,body=out:match('^HTTP (%d%d%d)\r?\n(.*)$')
    if not code then return failure('invalid_response',request_id) end
    if not code:match('^2') then return failure('http_'..code,request_id) end
    local decoded,r=pcall(json.decode,body)
    if not decoded or type(r)~='table' or r.requestId~=request_id or r.duckId~=duck_id or r.direction~=args.direction or not statuses[r.status] or (r.mode~='simulation' and r.mode~='hardware') or r.motionVerified~=false then return failure('invalid_response',request_id) end
    -- Only return allowlisted structured facts; do not forward arbitrary server text to the model.
    return {ok=true,requestId=request_id,duckId=duck_id,direction=args.direction,status=r.status,mode=r.mode,motionVerified=false}
  end
  return {invoke=function(args,request_id) return call('POST',args,request_id) end,
          status=function(args,request_id) return call('GET',args,request_id) end}
end
return {bind=bind}
