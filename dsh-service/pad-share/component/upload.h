#pragma once
#include "pad_share.h"

#define UP_PROJECT_ROOT "/sdcard/metalio/e-ink/project"
#define UP_CSP "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
typedef struct {
    char page[PAD_SHARE_PATH_SIZE], photo[PAD_SHARE_PATH_SIZE];
} upload_paths_t;
void upload_paths(upload_paths_t *p, const uint8_t random[16]);
typedef struct { char saved[PAD_SHARE_UPLOAD_LIMIT][33]; unsigned count; } upload_history_t;
enum up_ticket { UP_NEW, UP_BAD_ID, UP_REPLAY, UP_FULL };
enum up_ticket upload_check_id(const upload_history_t *history,const char *id);
/* Only after commit and before sending any response. Single synchronous httpd task. */
void upload_record(upload_history_t *history,const char *id);
enum up_route { UP_NONE, UP_FORM, UP_PHOTO };
enum up_route upload_lookup(const upload_paths_t *p, bool live, bool get, bool post, const char *uri);
bool upload_project(const char *root, char out[PAD_SHARE_PROJECT_SIZE]);
bool upload_bound(const char *root, const char *project);
bool upload_prepare(const char *root, const char *project);
enum up_result { UP_SAVED, UP_FORMAT, UP_STORAGE, UP_STOPPED, UP_INCOMPLETE };
typedef int (*up_receive_fn)(void *, char *, size_t);
typedef bool (*up_live_fn)(void *);
/* Only called by the single HTTP task. root/project never come from the network. */
enum up_result upload_save(const char *root, const char *project, uint32_t nonce, size_t length,
                           up_receive_fn receive, up_live_fn live, void *ctx);
