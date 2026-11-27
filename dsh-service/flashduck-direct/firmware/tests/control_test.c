#include "control.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

int main(void) {
    dc_control c={0};
    assert(!dc_calibrated(&c));
    c.armed=true;
    assert(dc_submit(&c,"a",90,700,101,100)==DC_UNAVAILABLE);
    c.lo=44; c.center=50; c.hi=60; assert(!dc_calibrated(&c));
    c.lo=75; c.center=90; c.hi=104; assert(!dc_calibrated(&c));
    c.lo=76; assert(dc_calibrated(&c));
    c.armed=false; assert(!dc_ready(&c));
    c.armed=true; c.position=c.center;
    assert(dc_submit(&c,"x",105,700,101,100)==DC_INVALID);
    assert(dc_submit(&c,"",100,700,101,100)==DC_INVALID);
    assert(dc_submit(&c,"x",100,701,101,100)==DC_INVALID);
    assert(dc_submit(&c,"x",100,700,5101,100)==DC_EXPIRED);
    assert(dc_submit(&c,"x",100,700,100,100)==DC_EXPIRED);
    assert(dc_submit(&c,"x",100,700,101,100)==DC_NEW);
    assert(dc_submit(&c,"x",100,700,101,110)==DC_REPEAT);
    assert(dc_submit(&c,"x",100,700,102,100)==DC_CONFLICT);
    assert(dc_submit(&c,"x",101,700,101,100)==DC_CONFLICT);
    assert(dc_submit(&c,"y",100,700,101,100)==DC_UNAVAILABLE);
    dc_finish(&c,false); assert(c.position==90 && c.history[0].status==DC_FAILED);
    assert(dc_submit(&c,"x",100,700,101,200)==DC_REPEAT);
    for(int i=1;i<DC_CAPACITY;i++) {
        char id[16]; snprintf(id,sizeof(id),"id_%d",i);
        assert(dc_submit(&c,id,100,700,5100,100)==DC_NEW);
        dc_finish(&c,true);
        assert(dc_find(&c,id)->status==DC_FINISHED && c.position==100);
    }
    assert(!dc_ready(&c)); assert(dc_submit(&c,"fresh",100,700,101,100)==DC_UNAVAILABLE);
    assert(dc_submit(&c,"x",100,700,101,100)==DC_REPEAT);
    for(int from=c.lo;from<=c.hi;from++) for(int to=c.lo;to<=c.hi;to++) {
        int prev=from;
        for(int i=1;i<=DC_STEPS;i++) {
            int next=dc_step(from,to,i);
            assert(abs(next-prev)<=1 && next>=c.lo && next<=c.hi);
            assert((next-prev)*(to-from)>=0); prev=next;
        }
        assert(prev==to);
    }
    assert(!dc_valid_id("x&y")); assert(!dc_valid_id(NULL));
    puts("PASS: calibration, busy, expiry, idempotency, ledger exhaustion, all bounded ramp trajectories");
}
