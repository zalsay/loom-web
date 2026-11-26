#include "upload.h"
#include "jpeg_fixture.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>

static const unsigned char *data;
static size_t available,pos;
static bool enabled,swap_id,revoke_after_read;
static void marker(const char *value,size_t len) {
    FILE *f=fopen("current.id","wb"); assert(f && fwrite(value,1,len,f)==len && fclose(f)==0);
}
static bool live(void *ctx) { (void)ctx; return enabled; }
static int receive(void *ctx,char *dst,size_t want) {
    (void)ctx; if (swap_id) marker("b\n",2); if (revoke_after_read) enabled=false;
    if (want>available-pos) want=available-pos;
    if (want>71) want=71;
    memcpy(dst,data+pos,want); pos+=want; return (int)want;
}
static enum up_result save(uint32_t nonce,const unsigned char *bytes,size_t len,size_t declared) {
    data=bytes; available=len; pos=0; enabled=true;
    enum up_result res=upload_save(".","a",nonce,declared,receive,live,NULL);
    assert(access("a/photos/receive.tmp",F_OK)!=0);
    return res;
}
static void files(void) {
    char root[]="/tmp/pad-photo-core-XXXXXX",id[PAD_SHARE_PROJECT_SIZE];
    assert(mkdtemp(root) && chdir(root)==0);
    assert(!upload_project(".",id));
    const char *bad[]={"","../x","a/b","ABC","aux","one\ntwo","a\r","abcdefghijklmnopqrstuvwxyz1234567"};
    for (size_t i=0;i<sizeof(bad)/sizeof(*bad);i++) { marker(bad[i],strlen(bad[i])); assert(!upload_project(".",id)); }
    marker("a\0b",3); assert(!upload_project(".",id));
    marker("a\r\n",3); assert(upload_project(".",id) && !strcmp(id,"a"));
    assert(!upload_prepare(".","../x") && !upload_prepare(".","b") && upload_prepare(".","a"));
    FILE *f=fopen("a/photos/receive.tmp","wb"); assert(f && !fclose(f));
    assert(upload_prepare(".","a") && access("a/photos/receive.tmp",F_OK)!=0);
    assert(save(17,fixture,sizeof(fixture),sizeof(fixture))==UP_SAVED);
    assert(save(17,fixture,sizeof(fixture),sizeof(fixture))==UP_STORAGE);
    f=fopen("a/photos/00000011.jpg","rb"); unsigned char original[sizeof(fixture)];
    assert(f && fread(original,1,sizeof(original),f)==sizeof(original) && fgetc(f)==EOF && !fclose(f) && !memcmp(original,fixture,sizeof(fixture)));
    assert(save(18,fixture,sizeof(fixture)-1,sizeof(fixture))==UP_INCOMPLETE);
    assert(save(18,fixture,sizeof(fixture),0)==UP_FORMAT);
    assert(save(18,fixture,sizeof(fixture),PAD_SHARE_PHOTO_MAX+1)==UP_FORMAT);
    for (size_t cut=1;cut<sizeof(fixture);cut+=37) assert(save(18,fixture,cut,cut)==UP_FORMAT);
    unsigned char b[sizeof(fixture)+1]; memcpy(b,fixture,sizeof(fixture)); b[sizeof(fixture)]=0;
    assert(save(18,b,sizeof(b),sizeof(b))==UP_FORMAT);
    size_t sof=0,sos=0; for (size_t i=0;i+1<sizeof(fixture);i++) if (b[i]==255) {
        if (b[i+1]==0xc0) sof=i;
        if (b[i+1]==0xda) sos=i;
    }
    assert(sof && sos); b[sof+5]=0x10; assert(save(18,b,sizeof(fixture),sizeof(fixture))==UP_FORMAT);
    memcpy(b,fixture,sizeof(fixture)); b[sof+1]=0xc2; assert(save(18,b,sizeof(fixture),sizeof(fixture))==UP_FORMAT);
    memcpy(b,fixture,sizeof(fixture)); size_t end=sos+2+256*b[sos+2]+b[sos+3]; b[end]=0xff; b[end+1]=0xd9;
    assert(save(18,b,end+2,end+2)==UP_FORMAT); /* valid tables, missing scan */
    revoke_after_read=true; assert(save(18,fixture,sizeof(fixture),sizeof(fixture))==UP_STOPPED); revoke_after_read=false;
    swap_id=true; assert(save(18,fixture,sizeof(fixture),sizeof(fixture))==UP_STOPPED); swap_id=false;
    assert(access("a/photos/00000012.jpg",F_OK)!=0 && access("b",F_OK)!=0);
    assert(unlink("a/photos/00000011.jpg")==0 && rmdir("a/photos")==0 && rmdir("a")==0 && unlink("current.id")==0);
    assert(chdir("/")==0 && rmdir(root)==0);
}
int main(void) {
    upload_paths_t p; uint8_t token[16]={0}; upload_paths(&p,token);
    assert(!strcmp(p.page,"/u/00000000000000000000000000000000/"));
    assert(upload_lookup(&p,true,true,false,p.page)==UP_FORM);
    assert(upload_lookup(&p,true,false,true,p.photo)==UP_PHOTO);
    assert(upload_lookup(&p,true,true,false,p.photo)==UP_NONE && upload_lookup(&p,true,false,true,p.page)==UP_NONE);
    assert(upload_lookup(&p,false,false,true,p.photo)==UP_NONE);
    const char *bad[]={"/","/s/00000000000000000000000000000000/card","/u/00000000000000000000000000000000/photo?name=x","/u/00000000000000000000000000000000/../photo","/u/00000000000000000000000000000001/photo","/u/00000000000000000000000000000000/%70hoto"};
    for (size_t i=0;i<sizeof(bad)/sizeof(*bad);i++) assert(upload_lookup(&p,true,false,true,bad[i])==UP_NONE);
    upload_history_t history={0}; char id[33];
    assert(upload_check_id(&history,"bad")==UP_BAD_ID);
    assert(upload_check_id(&history,"0000000000000000000000000000000F")==UP_BAD_ID);
    for (unsigned i=0;i<PAD_SHARE_UPLOAD_LIMIT;i++) {
        snprintf(id,sizeof(id),"%032x",i); assert(upload_check_id(&history,id)==UP_NEW);
        upload_record(&history,id); assert(upload_check_id(&history,id)==UP_REPLAY);
        upload_record(&history,id); assert(history.count==i+1);
    }
    assert(upload_check_id(&history,"ffffffffffffffffffffffffffffffff")==UP_FULL);
    files(); puts("upload route, binding, JPEG integrity, collision, cancellation and cleanup: OK");
}
