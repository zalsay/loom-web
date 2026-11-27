// SPDX-License-Identifier: CC-BY-NC-SA-4.0
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "board/board_config.h"
#include "otto/oscillator.h"
#include "wifi/wifi_manager.h"
#include "control.h"

static dc_control control;
static SemaphoreHandle_t mutex;
static TaskHandle_t motor;
static oscillator_t neck;
static char bearer[72] = "Bearer ";
static char session[33];
static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }
static void lock(void) { xSemaphoreTake(mutex, portMAX_DELAY); }
static void unlock(void) { xSemaphoreGive(mutex); }

// One motor writer, depth one including the executing command. Never homes or detaches
// other axes. Delay relative to the last output; missed slots are never caught up.
static void motor_task(void *unused) {
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        lock();
        dc_record r = control.history[control.active - 1];
        int from = control.position;
        unlock();
        if (!neck.is_attached_ && now_ms() < r.expiry) {
            oscillator_attach(&neck, OTTO_PIN_RIGHT_HAND, false); // initial duty = 0
        }
        bool start = now_ms() < r.expiry;
        if (start) {
            oscillator_set_position(&neck, from);
            for (int i = 1; i <= DC_STEPS; ++i) {
                int64_t deadline = esp_timer_get_time() + 20000;
                do { vTaskDelay(1); } while (esp_timer_get_time() < deadline);
                oscillator_set_position(&neck, dc_step(from, r.angle, i));
            }
        }
        lock(); dc_finish(&control, start); unlock();
    }
}

static bool authorized(httpd_req_t *req) {
    char value[sizeof(bearer)];
    if (httpd_req_get_hdr_value_len(req, "Authorization") != sizeof(value)-1 ||
        httpd_req_get_hdr_value_str(req, "Authorization", value, sizeof(value)) != ESP_OK) return false;
    volatile unsigned diff = 0;
    for (size_t i=0; i<sizeof(value)-1; ++i) diff |= (unsigned char)(value[i]^bearer[i]);
    return diff == 0;
}
static esp_err_t json(httpd_req_t *req, const char *status, const char *body) {
    httpd_resp_set_type(req, "application/json"); httpd_resp_set_status(req, status);
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, body);
}
static esp_err_t reject(httpd_req_t *req, const char *code) {
    json(req, code, "{\"error\":\"request_rejected\",\"motionVerified\":false}");
    return ESP_FAIL; // close; do not parse an unread request body as the next request
}
static esp_err_t record_reply(httpd_req_t *req, const char *id, dc_status s, const char *code) {
    char buf[256];
    snprintf(buf, sizeof(buf), "{\"v\":1,\"sessionId\":\"%s\",\"requestId\":\"%s\",\"status\":\"%s\",\"motionVerified\":false}", session, id, dc_name(s));
    return json(req, code, buf);
}
static esp_err_t status_handler(httpd_req_t *req) {
    if (!authorized(req)) return reject(req,"401 Unauthorized");
    size_t len = httpd_req_get_url_query_len(req);
    if (!len) {
        char buf[256]; lock(); bool ready = dc_ready(&control); unlock();
        snprintf(buf, sizeof(buf), "{\"v\":1,\"sessionId\":\"%s\",\"uptimeMs\":%" PRId64 ",\"ready\":%s,\"minDeg\":%d,\"centerDeg\":%d,\"maxDeg\":%d,\"motionVerified\":false}",
                 session,now_ms(),ready?"true":"false",control.lo,control.center,control.hi);
        return json(req,"200 OK",buf);
    }
    char query[68];
    if (len >= sizeof(query) || httpd_req_get_url_query_str(req,query,sizeof(query)) != ESP_OK ||
        strncmp(query,"id=",3) || !dc_valid_id(query+3)) return reject(req,"400 Bad Request");
    lock(); dc_record *r = dc_find(&control,query+3); dc_status s = r ? r->status : DC_UNKNOWN; unlock();
    return record_reply(req,query+3,s,"200 OK");
}
static const char *str_field(cJSON *obj,const char *name) {
    return cJSON_GetStringValue(cJSON_GetObjectItemCaseSensitive(obj,name));
}
static int64_t int_field(cJSON *obj,const char *name) {
    cJSON *f = cJSON_GetObjectItemCaseSensitive(obj,name);
    if (!cJSON_IsNumber(f) || !(f->valuedouble >= 0 && f->valuedouble <= 9007199254740991.0)) return -1;
    int64_t i = (int64_t)f->valuedouble; return (double)i == f->valuedouble ? i : -1;
}
static esp_err_t submit_handler(httpd_req_t *req) {
    if (!authorized(req)) return reject(req,"401 Unauthorized");
    char body[513], type[32];
    if (!req->content_len || req->content_len >= sizeof(body) ||
        httpd_req_get_hdr_value_str(req,"Content-Type",type,sizeof(type)) != ESP_OK ||
        strcmp(type,"application/json")) return reject(req,"400 Bad Request");
    size_t n = 0;
    while (n < req->content_len) {
        int got = httpd_req_recv(req,body+n,req->content_len-n);
        if (got <= 0) return reject(req,"400 Bad Request");
        n += got;
    }
    body[n] = 0;
    // All wire strings are ASCII tokens, no escaped aliases or embedded NUL.
    if (memchr(body,0,n) || memchr(body,'\\',n)) return reject(req,"400 Bad Request");
    const char *first = strchr(body,'{');
    if (!first || strchr(first+1,'{') || strchr(body,'[')) return reject(req,"400 Bad Request");
    cJSON *obj = cJSON_ParseWithOpts(body,NULL,true);
    const char *id = str_field(obj,"requestId"), *sid = str_field(obj,"sessionId");
    const char *op = str_field(obj,"type"), *joint = str_field(obj,"joint");
    int64_t a = int_field(obj,"angleDeg"), duration = int_field(obj,"durationMs"), expiry = int_field(obj,"expiresAtMs");
    if (!cJSON_IsObject(obj) || cJSON_GetArraySize(obj)!=8 || int_field(obj,"v")!=1 ||
        !dc_valid_id(id) || !op || strcmp(op,"joint.set") || !joint || strcmp(joint,"neck") ||
        !sid || a<0 || a>180 || duration!=DC_DURATION_MS || expiry<0) {
        cJSON_Delete(obj); return reject(req,"400 Bad Request");
    }
    if (strcmp(sid,session)) { cJSON_Delete(obj); return reject(req,"409 Conflict"); }
    char reply_id[65]; strcpy(reply_id,id);
    lock(); dc_result result = dc_submit(&control,id,(int)a,(int)duration,expiry,now_ms());
    dc_record *r = dc_find(&control,id); dc_status state = r ? r->status : DC_UNKNOWN;
    unlock(); cJSON_Delete(obj);
    if (result == DC_NEW) xTaskNotifyGive(motor);
    if (result == DC_NEW || result == DC_REPEAT) return record_reply(req,reply_id,state,state==DC_ACCEPTED?"202 Accepted":"200 OK");
    return reject(req,result==DC_INVALID?"422 Unprocessable Entity":result==DC_UNAVAILABLE?"503 Service Unavailable":"409 Conflict");
}

static bool read_config(void) {
    nvs_handle_t h;
    if (nvs_flash_init_partition("duck_keys")!=ESP_OK ||
        nvs_open_from_partition("duck_keys","duck_direct",NVS_READONLY,&h)!=ESP_OK) return false;
    size_t len=65; uint8_t lo=0, mid=0, hi=0;
    bool key=nvs_get_str(h,"key",bearer+7,&len)==ESP_OK && len==65 &&
        strspn(bearer+7,"0123456789abcdef")==64;
    if (nvs_get_u8(h,"min_deg",&lo)==ESP_OK && nvs_get_u8(h,"center_deg",&mid)==ESP_OK &&
        nvs_get_u8(h,"max_deg",&hi)==ESP_OK) {
        control.lo=lo; control.center=mid; control.hi=hi; control.position=mid;
    }
    nvs_close(h); return key;
}
// Debounce three consecutive samples; a held button at startup cannot arm.
static void await_level(int level) {
    unsigned count=0;
    while (count<3) { vTaskDelay(pdMS_TO_TICKS(30)); count=gpio_get_level(OTTO_PIN_BOOT_BUTTON)==level ? count+1 : 0; }
}
void app_main(void) {
    if (nvs_flash_init()!=ESP_OK || !read_config()) { ESP_LOGE("direct","Local provisioning required; stopped"); return; }
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(wifi_manager_init());
    if (wifi_manager_start_from_nvs()!=ESP_OK || wifi_manager_wait_connected(40000)!=ESP_OK) return;
    uint8_t random[16]; esp_fill_random(random,sizeof(random)); // Wi-Fi radio running
    for(size_t i=0;i<sizeof(random);i++) snprintf(session+2*i,3,"%02x",random[i]);
    mutex=xSemaphoreCreateMutex(); if(!mutex) return;
    oscillator_init(&neck,0); // memory only; no PWM pin attached here
    if (xTaskCreate(motor_task,"neck_only",4096,NULL,5,&motor)!=pdPASS) return;
    gpio_config_t boot={.pin_bit_mask=1ULL<<OTTO_PIN_BOOT_BUTTON,.mode=GPIO_MODE_INPUT,.pull_up_en=GPIO_PULLUP_ENABLE};
    ESP_ERROR_CHECK(gpio_config(&boot));
    httpd_handle_t server=NULL; httpd_config_t cfg=HTTPD_DEFAULT_CONFIG(); cfg.stack_size=8192; cfg.recv_wait_timeout=2;
    ESP_ERROR_CHECK(httpd_start(&server,&cfg));
    const httpd_uri_t get={.uri="/control/v1/status",.method=HTTP_GET,.handler=status_handler};
    const httpd_uri_t post={.uri="/control/v1",.method=HTTP_POST,.handler=submit_handler};
    ESP_ERROR_CHECK(httpd_register_uri_handler(server,&get)); ESP_ERROR_CHECK(httpd_register_uri_handler(server,&post));
    if (!dc_calibrated(&control)) { ESP_LOGE("direct","Calibration missing/invalid; motion disabled"); return; }
    ESP_LOGI("direct","Verify neck at calibrated center, then press and release BOOT to arm");
    await_level(1); await_level(0); await_level(1);
    lock(); control.armed=true; unlock();
}
