/* Host shim for exercising the real synchronous request adapter. No sockets,
 * IDF parser, flash, FatFs, event loop or radio are emulated. */
#pragma once
#include <sys/socket.h>
#include <netinet/in.h>
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include "esp_err.h"
#define ESP_FAIL (-1)
#define ESP_ERR_NOT_FOUND 5
#define ESP_ERR_INVALID_STATE 6
#define HTTPD_RESP_USE_STRLEN (-1)
#define HTTP_GET 1
#define HTTP_POST 2
#define HTTP_ANY 3
#define WIFI_MODE_STA 1
#define WIFI_EVENT "wifi"
#define IP_EVENT "ip"
#define WIFI_EVENT_STA_DISCONNECTED 1
#define WIFI_EVENT_STA_STOP 2
#define IP_EVENT_STA_LOST_IP 3
#define IP_EVENT_STA_GOT_IP 4
#define WIFI_EVENT_AP_START 5
#define CONFIG_LWIP_IPV6 1
#define IPSTR "%u.%u.%u.%u"
#define IP2STR(x) (unsigned)((x)->addr & 255),0u,0u,1u
#define HTTPD_DEFAULT_CONFIG() ((httpd_config_t){.ctrl_port=1234})
typedef const char *esp_event_base_t;
typedef void *esp_event_handler_instance_t,*httpd_handle_t;
typedef int esp_netif_t,wifi_mode_t,wifi_ap_record_t;
typedef struct { struct { uint32_t addr; } ip; } esp_netif_ip_info_t;
typedef struct { const char *uri,*host,*origin,*type,*length,*ticket,*te,*ce,*status,*reply,*csp;
    int method; size_t content_len,offset,have; const unsigned char *bytes; bool fail_response; } httpd_req_t;
typedef struct { const char *uri; int method; esp_err_t (*handler)(httpd_req_t *); } httpd_uri_t;
typedef struct { unsigned ctrl_port,server_port,stack_size,max_open_sockets,max_uri_handlers,max_resp_headers,
    lru_purge_enable,recv_wait_timeout,send_wait_timeout; int uri_match_fn; esp_err_t (*open_fn)(httpd_handle_t,int); } httpd_config_t;
#define httpd_uri_match_wildcard 1
static int64_t now;
static bool connected=true;
static int next_nonce=1;
static int esp_random(void) { return next_nonce++; }
static void esp_fill_random(void *buf,size_t n) { memset(buf,esp_random(),n); }
static int64_t esp_timer_get_time(void) { return now; }
static int esp_wifi_get_mode(int *m) { *m=1; return ESP_OK; }
static bool esp_netif_is_netif_up(esp_netif_t *s) { (void)s; return connected; }
static int esp_netif_get_ip_info(esp_netif_t *s,esp_netif_ip_info_t *i) { (void)s; i->ip.addr=127; return ESP_OK; }
static esp_netif_t *esp_netif_get_handle_from_ifkey(const char *k) { (void)k; static int s; return &s; }
static int esp_wifi_sta_get_ap_info(wifi_ap_record_t *a) { *a=1; return ESP_OK; }
static int esp_event_handler_instance_register(const char *b,int id,void (*fn)(void *,const char *,int32_t,void *),void *arg,void **p) {
    (void)b;(void)id;(void)fn;(void)arg; *p=&now; return ESP_OK;
}
static int esp_event_handler_instance_unregister(const char *b,int id,void *p) { (void)b;(void)id;(void)p;return ESP_OK; }
static int httpd_start(httpd_handle_t *h,const httpd_config_t *c) { (void)c; *h=&now; return ESP_OK; }
static int httpd_stop(httpd_handle_t h) { (void)h;return ESP_OK; }
static int httpd_register_uri_handler(httpd_handle_t h,const httpd_uri_t *r) { (void)h;(void)r;return ESP_OK; }
static int httpd_resp_set_hdr(httpd_req_t *r,const char *k,const char *v) { if (!strcmp(k,"Content-Security-Policy")) r->csp=v;return ESP_OK; }
static int httpd_resp_set_type(httpd_req_t *r,const char *v) { (void)r;(void)v;return ESP_OK; }
static int httpd_resp_set_status(httpd_req_t *r,const char *v) { r->status=v;return ESP_OK; }
static int httpd_resp_send(httpd_req_t *r,const char *v,int n) { (void)n;r->reply=v;return r->fail_response?ESP_FAIL:ESP_OK; }
static char chunks[16384];
static size_t chunk_len;
static void (*after_chunk)(void);
static int httpd_resp_send_chunk(httpd_req_t *r,const char *v,size_t n) {
    if (n+chunk_len>=sizeof(chunks)) return ESP_FAIL;
    if (v) { memcpy(chunks+chunk_len,v,n); chunk_len+=n; }
    chunks[chunk_len]=0;
    if (n && after_chunk) after_chunk();
    return r->fail_response?ESP_FAIL:ESP_OK;
}
static const char *hdr(httpd_req_t *r,const char *k) {
    if (!strcmp(k,"Host")) return r->host;
    if (!strcmp(k,"Origin")) return r->origin;
    if (!strcmp(k,"X-Upload-Id")) return r->ticket;
    if (!strcmp(k,"Content-Type")) return r->type;
    if (!strcmp(k,"Content-Length")) return r->length;
    if (!strcmp(k,"Transfer-Encoding")) return r->te;
    if (!strcmp(k,"Content-Encoding")) return r->ce;
    return NULL;
}
static size_t httpd_req_get_hdr_value_len(httpd_req_t *r,const char *k) { const char *v=hdr(r,k); return v?strlen(v):0; }
static int httpd_req_get_hdr_value_str(httpd_req_t *r,const char *k,char *b,size_t n) {
    const char *v=hdr(r,k); if (!v) return ESP_ERR_NOT_FOUND; if (strlen(v)>=n) return ESP_FAIL; strcpy(b,v); return ESP_OK;
}
static int httpd_req_recv(httpd_req_t *r,char *b,size_t n) {
    if (n>r->have-r->offset) n=r->have-r->offset;
    memcpy(b,r->bytes+r->offset,n); r->offset+=n; return (int)n;
}
