#include "snapshot.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const uint8_t token[16]={0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15};

static void test_card(void) {
    char step[]="<b>'&\"</b>";
    unsigned char image[]={137,'P','N','G',13,10,26,10,1,2,3};
    const char *steps[]={step,"下一步"};
    pad_share_snapshot_t s={.title="读 <卡>",.steps=steps,.step_count=2,
        .image=image,.image_size=sizeof(image),.image_mime="image/png"};
    share_view_t v={0}; assert(share_build(&v,&s,token)==ESP_OK);
    memset(step,'x',sizeof(step)); image[8]=42;
    assert(strstr(v.page,"读 &lt;卡&gt;"));
    assert(strstr(v.page,"<li>&lt;b&gt;&#39;&amp;&quot;&lt;/b&gt;</li><li>下一步</li>"));
    assert(v.image[8]==1 && v.image_size==sizeof(image) && !strcmp(v.mime,"image/png"));
    assert(strlen(v.page)==v.page_size && strstr(v.page,"src=\"image\""));
    assert(!strcmp(v.card,"/s/000102030405060708090a0b0c0d0e0f/card"));
    v.deadline_us=1000;
    assert(share_lookup(&v,true,999,v.card)==SHARE_PAGE);
    assert(share_lookup(&v,true,999,v.asset)==SHARE_IMAGE);
    assert(share_lookup(&v,true,1000,v.card)==SHARE_NONE);
    assert(share_lookup(&v,true,1001,v.asset)==SHARE_NONE);
    assert(share_lookup(&v,false,999,v.card)==SHARE_NONE);
    const char *bad[]={"/","/sdcard/secrets.txt","/s/000102030405060708090a0b0c0d0e0f/","/s/000102030405060708090a0b0c0d0e0f/card?x","/s/000102030405060708090a0b0c0d0e0f/Card","/s/000102030405060708090a0b0c0d0e0f/%63ard","/s/000102030405060708090a0b0c0d0e0f/../card","/s/100102030405060708090a0b0c0d0e0f/image"};
    for (size_t i=0;i<sizeof(bad)/sizeof(bad[0]);i++) assert(share_lookup(&v,true,1,bad[i])==SHARE_NONE);
    char old[PAD_SHARE_PATH_SIZE]; strcpy(old,v.card); share_clear(&v);
    assert(share_lookup(&v,true,0,old)==SHARE_NONE);
    pad_share_snapshot_t next={.title="new"}; uint8_t token2[16]={42};
    assert(share_build(&v,&next,token2)==ESP_OK); v.deadline_us=1000;
    assert(share_lookup(&v,true,1,old)==SHARE_NONE && share_lookup(&v,true,1,v.asset)==SHARE_NONE);
    share_clear(&v);
}
static void test_restricted_html(void) {
    char html[]="<html><head><base href='https://remote/'><meta http-equiv=refresh content='0;url=https://remote'><style>@import 'remote';</style></head><body><!--secret--><SCRIPT>warn()</ScRIPT><H2 id=q>可读</h2><p onmouseover='bad'>hello &amp; bye</p><a href='tel:secret'>link</a><img src='file:///sdcard/secrets'><svg><foreignObject><iframe srcdoc='bad'></iframe></foreignObject></svg><form><input></form></body></html>";
    pad_share_snapshot_t s={.html=html,.html_size=sizeof(html)-1}; share_view_t v={0};
    assert(share_build(&v,&s,token)==ESP_OK); memset(html,'?',sizeof(html));
    assert(strstr(v.page,"<h2>可读</h2><p>hello &amp; bye</p>link"));
    const char *bad[]={"remote","secret","warn()","<script","<base","<iframe","<form","<img","onmouseover","srcdoc","href=","http-equiv"};
    for(size_t i=0;i<sizeof(bad)/sizeof(bad[0]);i++) assert(!strstr(v.page,bad[i]));
    v.deadline_us=5; assert(share_lookup(&v,true,1,v.asset)==SHARE_NONE);
    assert(strstr(SHARE_HTML_CSP,"default-src 'none'") && strstr(SHARE_HTML_CSP,"img-src 'none'"));
    assert(strstr(SHARE_CSP,"script-src 'none'") && strstr(SHARE_CACHE,"no-store"));
    share_clear(&v);
}
static void test_limits(void) {
    share_view_t v={0}; char step[4098]; memset(step,'&',sizeof(step)-1); step[sizeof(step)-1]=0;
    const char *many[PAD_SHARE_MAX_STEPS]; for (size_t i=0;i<PAD_SHARE_MAX_STEPS;i++) many[i]=step;
    pad_share_snapshot_t s={.title="x",.steps=many,.step_count=1};
    assert(share_build(&v,&s,token)==ESP_ERR_INVALID_SIZE);
    step[4096]=0; s.step_count=PAD_SHARE_MAX_STEPS;
    assert(share_build(&v,&s,token)==ESP_ERR_INVALID_SIZE);
    s.step_count++; assert(share_build(&v,&s,token)==ESP_ERR_INVALID_ARG);
    s=(pad_share_snapshot_t){.html="x",.html_size=PAD_SHARE_MAX_HTML+1};
    assert(share_build(&v,&s,token)==ESP_ERR_INVALID_ARG);
    s.html_size=1; s.title="mixed"; assert(share_build(&v,&s,token)==ESP_ERR_INVALID_ARG);
    s=(pad_share_snapshot_t){.title="x",.image="bad",.image_size=3,.image_mime="image/png"};
    assert(share_build(&v,&s,token)==ESP_ERR_INVALID_ARG);
    s.image_size=PAD_SHARE_MAX_IMAGE+1; assert(share_build(&v,&s,token)==ESP_ERR_INVALID_ARG);
    s.image="\xff\xd8\xff"; s.image_size=3; s.image_mime="image/jpeg";
    assert(share_build(&v,&s,token)==ESP_OK && !strcmp(v.mime,"image/jpeg")); share_clear(&v);
}
int main(void) {
    test_card(); test_restricted_html(); test_limits();
    puts("PASS: structured escaping/copy, exact capability routes, expiry/revocation/rotation, restricted HTML and size/type limits");
    return 0;
}
