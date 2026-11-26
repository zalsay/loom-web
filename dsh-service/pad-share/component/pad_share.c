#include "snapshot.h"
#include "upload.h"
#include "phone_form.h"
#include <stdio.h>
#include <pthread.h>
#include <stdatomic.h>
#include <string.h>
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "lwip/sockets.h"

/* Only task-level public API calls take this mutex. httpd_stop joins the HTTP
 * task before any borrowed data is freed; callbacks never wait on this mutex. */
static pthread_mutex_t lifecycle = PTHREAD_MUTEX_INITIALIZER;
static httpd_handle_t server;
static share_view_t view;
static atomic_bool revoked = ATOMIC_VAR_INIT(true);
static esp_netif_t *sta;
static uint32_t sta_ipv4;
static bool uploading;
static upload_paths_t upload;
static char project[PAD_SHARE_PROJECT_SIZE], authority[32], origin[40];
static atomic_uint received;
static upload_history_t history;

esp_err_t pad_share_current_project(char id[PAD_SHARE_PROJECT_SIZE]) {
    return id && upload_project(UP_PROJECT_ROOT,id) ? ESP_OK : ESP_ERR_INVALID_STATE;
}
unsigned pad_share_upload_count(void) { return atomic_load(&received); }
typedef struct {
    esp_event_base_t base;
    int32_t id;
    esp_event_handler_instance_t instance;
} subscription_t;
static subscription_t events[5];

static void invalidate(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg; (void)base; (void)id; (void)data;
    /* Conservative: also revoke on a repeated GOT_IP. Never re-enable on reconnect. */
    atomic_store(&revoked,true);
}
static bool network_ready(void) {
    esp_netif_ip_info_t ip;
    wifi_mode_t mode;
    return sta && esp_wifi_get_mode(&mode)==ESP_OK && mode==WIFI_MODE_STA && esp_netif_is_netif_up(sta) && esp_netif_get_ip_info(sta,&ip)==ESP_OK &&
           ip.ip.addr!=0 && ip.ip.addr==sta_ipv4;
}
static bool live(void) {
    if (atomic_load(&revoked) || esp_timer_get_time()>=view.deadline_us) return false;
    if (!network_ready()) { atomic_store(&revoked,true); return false; }
    return !atomic_load(&revoked);
}
/* httpd listens on INADDR_ANY. Reject connections whose local destination isn't
 * the captured STA IPv4, including all native IPv6 and AP address traffic. */
static esp_err_t accept_sta(httpd_handle_t hd, int fd) {
    (void)hd;
    struct sockaddr_storage ss={0}; socklen_t len=sizeof(ss);
    if (!live() || getsockname(fd,(struct sockaddr *)&ss,&len)!=0) return ESP_FAIL;
    if (ss.ss_family==AF_INET)
        return ((struct sockaddr_in *)&ss)->sin_addr.s_addr==sta_ipv4 ? ESP_OK : ESP_FAIL;
#if CONFIG_LWIP_IPV6
    if (ss.ss_family==AF_INET6) {
        const unsigned char *b=(const unsigned char *)&((struct sockaddr_in6 *)&ss)->sin6_addr;
        const unsigned char mapped[12]={0,0,0,0,0,0,0,0,0,0,0xff,0xff};
        if (!memcmp(b,mapped,12) && !memcmp(b+12,&sta_ipv4,4)) return ESP_OK;
    }
#endif
    return ESP_FAIL;
}
static esp_err_t headers(httpd_req_t *r, const char *csp) {
    if (httpd_resp_set_hdr(r,"Cache-Control",SHARE_CACHE)!=ESP_OK ||
        httpd_resp_set_hdr(r,"Content-Security-Policy",csp)!=ESP_OK ||
        httpd_resp_set_hdr(r,"Referrer-Policy","no-referrer")!=ESP_OK ||
        httpd_resp_set_hdr(r,"X-Content-Type-Options","nosniff")!=ESP_OK ||
        httpd_resp_set_hdr(r,"X-Frame-Options","DENY")!=ESP_OK ||
        httpd_resp_set_hdr(r,"Cross-Origin-Resource-Policy","same-origin")!=ESP_OK)
        return ESP_FAIL;
    return ESP_OK;
}
static bool upload_live(void) {
    if (!live()) return false;
    if (!upload_bound(UP_PROJECT_ROOT,project)) { atomic_store(&revoked,true); return false; }
    return live();
}
static bool header_is(httpd_req_t *r,const char *key,const char *value) {
    char buf[48]; size_t n=strlen(value);
    return n<sizeof(buf) && httpd_req_get_hdr_value_len(r,key)==n &&
        httpd_req_get_hdr_value_str(r,key,buf,sizeof(buf))==ESP_OK && !strcmp(buf,value);
}
static bool header_absent(httpd_req_t *r,const char *key) {
    char b[2]; return httpd_req_get_hdr_value_str(r,key,b,sizeof(b))==ESP_ERR_NOT_FOUND;
}
static esp_err_t upload_reply(httpd_req_t *r,const char *status,const char *body,bool saved) {
    if (httpd_resp_set_type(r,saved?"application/json":"text/plain")!=ESP_OK ||
        httpd_resp_set_status(r,status)!=ESP_OK || (!saved && httpd_resp_set_hdr(r,"Connection","close")!=ESP_OK)) return ESP_FAIL;
    /* Returning non-OK tells HTTPD to close instead of draining a rejected
     * (possibly huge or stalled) body before processing the next request. */
    esp_err_t err=httpd_resp_send(r,body,HTTPD_RESP_USE_STRLEN);
    return saved ? err : ESP_FAIL;
}
typedef struct { httpd_req_t *req; int64_t until; } request_ctx;
static int receive_data(void *ctx,char *buf,size_t n) { return httpd_req_recv(((request_ctx *)ctx)->req,buf,n); }
static bool request_live(void *ctx) { return live() && esp_timer_get_time()<((request_ctx *)ctx)->until; }
static esp_err_t serve_upload(httpd_req_t *r) {
    enum up_route route=upload_lookup(&upload,live(),r->method==HTTP_GET,r->method==HTTP_POST,r->uri);
    if (headers(r,route==UP_FORM?UP_CSP:SHARE_HTML_CSP)!=ESP_OK) return ESP_FAIL;
    if (route==UP_NONE || !header_is(r,"Host",authority) || !upload_live())
        return upload_reply(r,"404 Not Found","Not found",false);
    if (route==UP_FORM) {
        if (r->content_len || !header_absent(r,"Transfer-Encoding")) return upload_reply(r,"400 Bad Request","Unexpected body",false);
        if (httpd_resp_set_type(r,"text/html; charset=utf-8")!=ESP_OK) return ESP_FAIL;
        return httpd_resp_send(r,pad_phone_form,sizeof(pad_phone_form)-1);
    }
    if (!header_is(r,"Origin",origin)) return upload_reply(r,"403 Forbidden","Origin rejected",false);
    char ticket[33];
    if (httpd_req_get_hdr_value_len(r,"X-Upload-Id")!=32 ||
        httpd_req_get_hdr_value_str(r,"X-Upload-Id",ticket,sizeof(ticket))!=ESP_OK)
        return upload_reply(r,"400 Bad Request","Invalid upload ID",false);
    switch (upload_check_id(&history,ticket)) {
    case UP_BAD_ID: return upload_reply(r,"400 Bad Request","Invalid upload ID",false);
    case UP_REPLAY: return upload_reply(r,"409 Conflict","Upload ID already saved",false);
    case UP_FULL: return upload_reply(r,"429 Too Many Requests","Session full",false);
    default: break;
    }
    if (!header_absent(r,"Transfer-Encoding") || !header_absent(r,"Content-Encoding") ||
        !header_is(r,"Content-Type","image/jpeg")) return upload_reply(r,"415 Unsupported Media Type","Expected JPEG",false);
    if (!r->content_len || r->content_len>PAD_SHARE_PHOTO_MAX) return upload_reply(r,"413 Payload Too Large","Invalid length",false);
    char size[24]; snprintf(size,sizeof(size),"%u",(unsigned)r->content_len);
    if (!header_is(r,"Content-Length",size)) return upload_reply(r,"400 Bad Request","Invalid length",false);
    request_ctx ctx={r,esp_timer_get_time()+60000000};
    enum up_result result=upload_save(UP_PROJECT_ROOT,project,esp_random(),r->content_len,receive_data,request_live,&ctx);
    switch (result) {
    case UP_SAVED:
        upload_record(&history,ticket); atomic_store(&received,history.count);
        return upload_reply(r,"201 Created","{\"saved\":true}",true);
    case UP_FORMAT: return upload_reply(r,"415 Unsupported Media Type","Invalid JPEG",false);
    case UP_STORAGE: return upload_reply(r,"507 Insufficient Storage","SD write failed",false);
    case UP_STOPPED: if (!upload_bound(UP_PROJECT_ROOT,project)) atomic_store(&revoked,true);
        return upload_reply(r,"410 Gone","Upload expired or project changed",false);
    default: return upload_reply(r,"400 Bad Request","Incomplete upload",false);
    }
}
static esp_err_t serve(httpd_req_t *r) {
    if (uploading) return serve_upload(r);
    enum share_resource resource=r->method==HTTP_GET ? share_lookup(&view,live(),esp_timer_get_time(),r->uri) : SHARE_NONE;
    if (headers(r,resource==SHARE_PAGE && view.image ? SHARE_CSP : SHARE_HTML_CSP)!=ESP_OK) return ESP_FAIL;
    if (resource==SHARE_NONE) {
        if (httpd_resp_set_status(r,"404 Not Found")!=ESP_OK || httpd_resp_set_type(r,"text/plain")!=ESP_OK) return ESP_FAIL;
        return httpd_resp_send(r,"Not found",9);
    }
    bool img=resource==SHARE_IMAGE;
    if (httpd_resp_set_type(r,img ? view.mime : "text/html; charset=utf-8")!=ESP_OK) return ESP_FAIL;
    const char *data=img ? (const char *)view.image : view.page;
    size_t left=img ? view.image_size : view.page_size;
    while (left) {
        size_t n=left<2048 ? left : 2048;
        if (!live() || httpd_resp_send_chunk(r,data,n)!=ESP_OK) return ESP_FAIL;
        data+=n; left-=n;
    }
    return httpd_resp_send_chunk(r,NULL,0);
}
static esp_err_t stop_locked(void) {
    atomic_store(&revoked,true);
    if (server) {
        esp_err_t err=httpd_stop(server);
        if (err!=ESP_OK) return err; /* fail closed; preserve memory pending a retry */
        server=NULL;
    }
    share_clear(&view);
    memset(&upload,0,sizeof(upload)); memset(&history,0,sizeof(history));
    project[0]=0; uploading=false; atomic_store(&received,0);
    sta=NULL; sta_ipv4=0;
    for (size_t i=0;i<sizeof(events)/sizeof(events[0]);i++) if (events[i].instance) {
        esp_err_t err=esp_event_handler_instance_unregister(events[i].base,events[i].id,events[i].instance);
        if (err!=ESP_OK) return err;
        events[i].instance=NULL;
    }
    return ESP_OK;
}
esp_err_t pad_share_stop(void) {
    if (pthread_mutex_lock(&lifecycle)!=0) return ESP_FAIL;
    esp_err_t err=stop_locked();
    pthread_mutex_unlock(&lifecycle); return err;
}
bool pad_share_active(void) {
    if (pthread_mutex_lock(&lifecycle)!=0) return false;
    bool ok=server && (uploading?upload_live():live()); pthread_mutex_unlock(&lifecycle); return ok;
}
static esp_err_t start(const pad_share_config_t *cfg,const pad_share_snapshot_t *snap,
                       const char *id,bool writer,char *path,size_t path_size) {
    if (path && path_size) path[0]=0;
    if (pthread_mutex_lock(&lifecycle)!=0) return ESP_FAIL;
    esp_err_t err=stop_locked();
    if (err!=ESP_OK) goto done;
    httpd_config_t http=HTTPD_DEFAULT_CONFIG();
    uint16_t port=cfg && cfg->port ? cfg->port : PAD_SHARE_DEFAULT_PORT;
    uint16_t ctrl=cfg && cfg->ctrl_port ? cfg->ctrl_port : PAD_SHARE_DEFAULT_CTRL_PORT;
    uint32_t ttl=cfg && cfg->ttl_seconds ? cfg->ttl_seconds : PAD_SHARE_DEFAULT_TTL;
    if ((writer ? !id : !snap) || !path || path_size<PAD_SHARE_PATH_SIZE || ttl>86400 || ctrl==http.ctrl_port || ctrl==port) {
        err=ESP_ERR_INVALID_ARG; goto done;
    }
    sta=esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (!sta) { err=ESP_ERR_INVALID_STATE; goto cleanup; }
    events[0]=(subscription_t){WIFI_EVENT,WIFI_EVENT_STA_DISCONNECTED,NULL};
    events[1]=(subscription_t){WIFI_EVENT,WIFI_EVENT_STA_STOP,NULL};
    events[2]=(subscription_t){IP_EVENT,IP_EVENT_STA_LOST_IP,NULL};
    events[3]=(subscription_t){IP_EVENT,IP_EVENT_STA_GOT_IP,NULL};
    events[4]=(subscription_t){WIFI_EVENT,WIFI_EVENT_AP_START,NULL};
    atomic_store(&revoked,false); /* never reset again during this generation */
    for (size_t i=0;i<sizeof(events)/sizeof(events[0]);i++) {
        err=esp_event_handler_instance_register(events[i].base,events[i].id,invalidate,NULL,&events[i].instance);
        if (err!=ESP_OK) goto cleanup;
    }
    esp_netif_ip_info_t ip;
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap)!=ESP_OK || esp_netif_get_ip_info(sta,&ip)!=ESP_OK) {
        err=ESP_ERR_INVALID_STATE; goto cleanup;
    }
    sta_ipv4=ip.ip.addr;
    if (!network_ready()) { err=ESP_ERR_INVALID_STATE; goto cleanup; }
    uint8_t random[16]; esp_fill_random(random,sizeof(random)); /* Wi-Fi RF entropy active */
    if (writer) {
        if (!upload_prepare(UP_PROJECT_ROOT,id)) { err=ESP_ERR_INVALID_STATE; goto cleanup; }
        strcpy(project,id); upload_paths(&upload,random); uploading=true;
        char addr[16]; snprintf(addr,sizeof(addr),IPSTR,IP2STR(&ip.ip));
        if (port==80) snprintf(authority,sizeof(authority),"%s",addr);
        else snprintf(authority,sizeof(authority),"%s:%u",addr,(unsigned)port);
        snprintf(origin,sizeof(origin),"http://%s",authority);
        http.stack_size=12288; /* SD VFS, JPEG structure pass, fixed chunk */
    } else {
        err=share_build(&view,snap,random);
        if (err!=ESP_OK) goto cleanup;
    }
    view.deadline_us=esp_timer_get_time()+(int64_t)ttl*1000000;
    http.server_port=port; http.ctrl_port=ctrl; http.max_open_sockets=1;
    http.max_uri_handlers=1; http.max_resp_headers=8; http.lru_purge_enable=true;
    http.recv_wait_timeout=2; http.send_wait_timeout=2;
    http.uri_match_fn=httpd_uri_match_wildcard; http.open_fn=accept_sta;
    err=httpd_start(&server,&http);
    if (err!=ESP_OK) goto cleanup;
    const httpd_uri_t route={.uri="/*",.method=HTTP_ANY,.handler=serve};
    err=httpd_register_uri_handler(server,&route);
    if (err!=ESP_OK) goto cleanup;
    if (!live()) { err=ESP_ERR_INVALID_STATE; goto cleanup; }
    strcpy(path,writer?upload.page:view.card); goto done;
cleanup: {
        esp_err_t stopped=stop_locked();
        if (stopped!=ESP_OK) err=stopped;
    }
done:
    pthread_mutex_unlock(&lifecycle); return err;
}
esp_err_t pad_share_start(const pad_share_config_t *cfg,const pad_share_snapshot_t *snap,char *path,size_t path_size) {
    return start(cfg,snap,NULL,false,path,path_size);
}
esp_err_t pad_share_upload_start(const pad_share_config_t *cfg,const char *id,char *path,size_t path_size) {
    return start(cfg,NULL,id,true,path,path_size);
}
