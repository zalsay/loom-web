#pragma once
#include "snapshot.h"

#define LIBRARY_PAGE_SIZE 12u
/* Zero initialize before open; root is the trusted mount, borrowed until clear. */
typedef struct {
    const char *root;
    char path[PAD_SHARE_PATH_SIZE], id[PAD_SHARE_PROJECT_SIZE];
    char *names[PAD_SHARE_LIBRARY_LIMIT];
    unsigned archived;
} library_t;
esp_err_t library_open(library_t *lib,const char *root,const char *project,const uint8_t random[16]);
void library_clear(library_t *lib);
/* Exact bearer route, not a filesystem path. Caller owns the resulting page. */
esp_err_t library_page(const library_t *lib,const char *uri,share_view_t *out);
