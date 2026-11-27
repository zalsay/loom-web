#include "upload.h"
#undef UP_PROJECT_ROOT
#define UP_PROJECT_ROOT "." /* Host-only: caller supplies isolated temporary directory. */
#include "http_mock.h"
#include "../pad_share.c"
#include "jpeg_fixture.h"
#include <assert.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

static void status_is(httpd_req_t req,int code) {
    assert(serve(&req)!=ESP_OK && req.status && atoi(req.status)==code);
}
static void text_file(const char *path,const char *text) {
    FILE *f=fopen(path,"wb"); assert(f && fputs(text,f)>=0 && !fclose(f));
}
static void switch_project(void) { text_file("current.id","other"); }
static void library_tests(void) {
    char token[PAD_SHARE_PATH_SIZE],old[PAD_SHARE_PATH_SIZE],uri[128];
    text_file("current.html","private previous project");
    httpd_req_t req={.uri=token,.host="127.0.0.1:8088",.method=HTTP_GET};
    assert(pad_share_library_start(NULL,"proj",token,sizeof(token))==ESP_OK);
    chunk_len=0; assert(serve(&req)==ESP_OK && strstr(chunks,"暂无卡片") && !strstr(chunks,"previous"));
    assert(!mkdir("proj/cards",0700) && !mkdir("other",0700) && !mkdir("other/cards",0700));
    text_file("other/cards/Secrets.html","outside");
    assert(!mkdir("proj/cards/nested.html",0700)); text_file("proj/cards/nested.html/private.html","nested");
    assert(!symlink("../../other/cards/Secrets.html","proj/cards/linked.html"));
    text_file("proj/cards/0&begin.HTML","<h1 onclick=x>正文</h1><script>hidden</script><img src='http://external'>");
    text_file("proj/cards/中文.html","中文详情"); text_file("proj/cards/private.txt","not a card");
    char name[100];
    for (int i=0;i<11;i++) { snprintf(name,sizeof(name),"proj/cards/m%03d.html",i); text_file(name,"Middle"); }
    chunk_len=0; assert(serve(&req)==ESP_OK && strstr(chunks,"暂无卡片"));
    strcpy(old,token);
    assert(pad_share_library_start(NULL,"proj",token,sizeof(token))==ESP_OK && strcmp(old,token));
    req.uri=old;status_is(req,404);req.uri=token;chunk_len=0;
    assert(serve(&req)==ESP_OK && !strcmp(req.csp,SHARE_HTML_CSP) && strstr(chunks,"13 张") && strstr(chunks,"0&amp;begin"));
    assert(strstr(chunks,"href='p2'") && !strstr(chunks,"nested") && !strstr(chunks,"Secrets") && !strstr(chunks,"linked") && !strstr(chunks,".html"));
    req.uri=uri;snprintf(uri,sizeof(uri),"%sp2",token);chunk_len=0;
    assert(serve(&req)==ESP_OK && strstr(chunks,"中文") && strstr(chunks,"上一页"));
    snprintf(uri,sizeof(uri),"%sc13",token);chunk_len=0;
    assert(serve(&req)==ESP_OK && strstr(chunks,"href='p2'>返回卡片列表") && strstr(chunks,"中文详情"));
    snprintf(uri,sizeof(uri),"%sc1",token);chunk_len=0;
    assert(serve(&req)==ESP_OK && strstr(chunks,"<h1>正文</h1>") && strstr(chunks,"href='./'>返回卡片列表") && !strstr(chunks,"hidden") && !strstr(chunks,"onclick") && !strstr(chunks,"external"));
    const char *invalid[]={"c0","c01","c14","p1","p3","c2/","../current.html","%2e%2e","c1?x","photo","m000.html"};
    for (size_t i=0;i<sizeof(invalid)/sizeof(*invalid);i++) { snprintf(uri,sizeof(uri),"%s%s",token,invalid[i]);status_is(req,404); }
    snprintf(uri,sizeof(uri),"%sc1",token);req.method=HTTP_POST;status_is(req,404);req.method=HTTP_GET;
    req.host="wrong";status_is(req,404);req.host="127.0.0.1:8088";
    text_file("proj/cards/0&begin.HTML","");status_is(req,422);
    FILE *large=fopen("proj/cards/0&begin.HTML","wb"); assert(large);
    for(int i=0;i<6000;i++) assert(fputc('x',large)!=EOF);
    assert(!fclose(large)); chunk_len=0; after_chunk=switch_project;
    assert(serve(&req)==ESP_FAIL && chunk_len==2048 && !pad_share_active());
    after_chunk=NULL; text_file("current.id","proj");status_is(req,404);
    assert(pad_share_library_start(NULL,"other",token,sizeof(token))==ESP_ERR_INVALID_STATE && !pad_share_active());
    assert(pad_share_library_start(NULL,"proj",token,sizeof(token))==ESP_OK);
    now+=300000000;req.uri=token;status_is(req,404);
    assert(pad_share_library_start(NULL,"proj",token,sizeof(token))==ESP_OK);connected=false;status_is(req,404);connected=true;status_is(req,404);
    assert(pad_share_library_start(NULL,"proj",token,sizeof(token))==ESP_OK && pad_share_stop()==ESP_OK && !pad_share_active());
    for (unsigned i=13;i<PAD_SHARE_LIBRARY_LIMIT;i++) { snprintf(name,sizeof(name),"proj/cards/extra%03u.html",i);text_file(name,"OK"); }
    assert(pad_share_library_start(NULL,"proj",token,sizeof(token))==ESP_OK);
    snprintf(uri,sizeof(uri),"%sp11",token);req.uri=uri;chunk_len=0;
    assert(serve(&req)==ESP_OK && strstr(chunks,"href='c128'"));
    snprintf(uri,sizeof(uri),"%sc128",token);chunk_len=0;
    assert(serve(&req)==ESP_OK && strstr(chunks,"href='p11'>返回卡片列表"));
    text_file("proj/cards/overflow.html","Too many");
    assert(pad_share_library_start(NULL,"proj",token,sizeof(token))==ESP_ERR_INVALID_SIZE && !token[0] && !pad_share_active());
    puts("Library: scoped paths, escaped names, exact paging/detail routes, safe projection, limits and mid-response revocation: OK");
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
    library_tests();
    puts("HTTP adapter: page CSP, origin/host, method/path, length, MIME, committed replay, quota, revocation/TTL and rotation: OK");
}
