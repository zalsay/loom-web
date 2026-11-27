#pragma once
#include "pad_share.h"

typedef struct {
    char card[PAD_SHARE_PATH_SIZE], asset[PAD_SHARE_PATH_SIZE];
    char *page;
    size_t page_size, image_size;
    unsigned char *image;
    const char *mime;
    int64_t deadline_us;
} share_view_t;

enum share_resource { SHARE_NONE, SHARE_PAGE, SHARE_IMAGE };
esp_err_t share_build(share_view_t *out, const pad_share_snapshot_t *in, const uint8_t random[16]);
esp_err_t share_library_html(share_view_t *out,const void *html,size_t size,unsigned list_page);
void share_clear(share_view_t *v);
enum share_resource share_lookup(const share_view_t *v, bool active, int64_t now_us, const char *uri);
#define SHARE_CSP "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-same-origin"
#define SHARE_HTML_CSP "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox"
#define SHARE_CACHE "no-store, max-age=0"
