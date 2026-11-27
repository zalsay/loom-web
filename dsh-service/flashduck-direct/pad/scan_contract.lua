local scan=dofile('/duck/duck_scan.lua')
local spec={requestId='one'}
local function exercise(kind)
 local posts,reads,seen={},0,false
 local running,stopped,now=false,false,0
 local host={acquire=function() if seen then return nil end seen=true; running=true; return 'session' end,
 valid=function() return not stopped end,release=function() running=false end, now_ms=function() return now end,
 wait_ms=function(ms) now=now+ms; if (kind=='cancel' and ms==300) or (kind=='cancel_inflight' and ms==200) then stopped=true end end}
 local client={invoke=function(p,id) posts[#posts+1]=p.direction; assert(id=='one_scan'..#posts);return {ok=true,status='accepted'} end,
 status=function(p,id) reads=reads+1; assert(p.direction==posts[#posts]);return {ok=true,status=kind=='lost' and 'unknown' or kind=='timeout' and 'accepted' or 'command_finished'} end}
 local api=dofile('/duck/trusted_host.lua').bind(client,scan.bind(client,host))
 local obj={invoke=function(args,ctx) return api.invoke('duck_scan',args,ctx) end}
 assert(obj.invoke({angle=90},spec).status=='rejected');assert(not seen)
 local result=obj.invoke({},spec);assert(not running and result.motionVerified==false)
 if kind=='normal' then assert(table.concat(posts,',')=='slight_left,slight_right,center' and reads==3 and result.stepsFinished==3 and result.status=='command_finished')
 elseif kind=='cancel' then assert(#posts==1 and reads==1 and result.status=='cancelled')
 elseif kind=='cancel_inflight' then assert(#posts==1 and reads==0 and result.stepsFinished==0 and result.reason=='inflight_step_may_finish')
 else assert(#posts==1 and result.status=='unknown') end
 assert(obj.invoke({},spec).reason=='busy_or_duplicate')
end
for _,k in ipairs({'normal','cancel','cancel_inflight','lost','timeout'}) do exercise(k) end
print('SCAN_PASS')
