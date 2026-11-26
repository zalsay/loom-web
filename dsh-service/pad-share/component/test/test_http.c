#include "upload.h"
#undef UP_PROJECT_ROOT
#define UP_PROJECT_ROOT "." /* Host-only: caller supplies isolated temporary directory. */
#include "http_mock.h"
#include "../pad_share.c"
#include "jpeg_fixture.h"
#include <assert.h>
#include <stdlib.h>

static void status_is(httpd_req_t req,int code) {
    assert(serve(&req)!=ESP_OK && req.status && atoi(req.status)==code);
}
int main(void) {
    FILE *f=fopen("current.id","wb"); assert(f && fputs("proj\n",f)>=0 && !fclose(f));
    char path[PAD_SHARE_PATH_SIZE],old[PAD_SHARE_PATH_SIZE],post[PAD_SHARE_PATH_SIZE],length[20];
    assert(pad_share_upload_start(NULL,"proj",path,sizeof(path))==ESP_OK && pad_share_active());
    snprintf(post,sizeof(post),"%.36sphoto",path); strcpy(old,path);
    snprintf(length,sizeof(length),"%u",(unsigned)sizeof(fixture));
    httpd_req_t get={.uri=path,.host="127.0.0.1:8088",.method=HTTP_GET};
    assert(serve(&get)==ESP_OK && !strcmp(get.csp,UP_CSP) && get.reply==pad_phone_form);
    get.uri=post;status_is(get,404);
    httpd_req_t req={.uri=post,.host="127.0.0.1:8088",.origin="http://127.0.0.1:8088",.method=HTTP_POST,.type="image/jpeg",
        .content_len=sizeof(fixture),.length=length,.have=sizeof(fixture),.bytes=fixture,.ticket="00000000000000000000000000000001"};
    httpd_req_t t=req;t.host="name.example";status_is(t,404);
    t=req;t.origin=NULL;status_is(t,403);t.origin="null";status_is(t,403);
    t=req;t.te="chunked";status_is(t,415);t=req;t.ce="gzip";status_is(t,415);
    t=req;t.type="image/png";status_is(t,415);t=req;t.length="000810";status_is(t,400);
    t=req;t.content_len=PAD_SHARE_PHOTO_MAX+1;status_is(t,413);
    t=req;t.ticket="0000000000000000000000000000000X";status_is(t,400);
    t=req;t.ticket=NULL;status_is(t,400);
    t=req;t.have--;status_is(t,400);assert(!pad_share_upload_count());
    /* Response lost after SD commit: retry rejected, file count stays at one. */
    t=req;t.fail_response=true;assert(serve(&t)!=ESP_OK && !strcmp(t.status,"201 Created") && !strcmp(t.reply,"{\"saved\":true}"));
    assert(pad_share_upload_count()==1);status_is(req,409);
    for(unsigned i=2;i<=PAD_SHARE_UPLOAD_LIMIT;i++) { char id[33];snprintf(id,sizeof(id),"%032x",i);t=req;t.ticket=id;
        assert(serve(&t)==ESP_OK && !strcmp(t.status,"201 Created") && pad_share_upload_count()==i); }
    t=req;t.ticket="ffffffffffffffffffffffffffffffff";status_is(t,429);
    connected=false;assert(!pad_share_active());connected=true;get.uri=path;status_is(get,404);
    assert(pad_share_upload_start(NULL,"proj",path,sizeof(path))==ESP_OK && strcmp(old,path) && !pad_share_upload_count());
    get.uri=old;status_is(get,404);get.uri=path;now+=300000000;status_is(get,404);
    assert(pad_share_upload_start(NULL,"proj",path,sizeof(path))==ESP_OK);
    pad_share_snapshot_t card={.title="x"};char reader[PAD_SHARE_PATH_SIZE];
    assert(pad_share_start(NULL,&card,reader,sizeof(reader))==ESP_OK && reader[1]=='s');
    t=get;t.uri=path;assert(serve(&t)==ESP_OK && !strcmp(t.status,"404 Not Found"));
    t=req;assert(serve(&t)==ESP_OK && !strcmp(t.status,"404 Not Found"));
    assert(pad_share_upload_start(NULL,"wrong-id",path,sizeof(path))!=ESP_OK && !pad_share_active());
    puts("HTTP adapter: page CSP, origin/host, method/path, length, MIME, committed replay, quota, revocation/TTL and rotation: OK");
}
