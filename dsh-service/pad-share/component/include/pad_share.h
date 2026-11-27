#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif
#define PAD_SHARE_PATH_SIZE 48
#define PAD_SHARE_MAX_HTML (64u * 1024u)
#define PAD_SHARE_MAX_IMAGE (128u * 1024u)
#define PAD_SHARE_MAX_STEPS 64u
#define PAD_SHARE_DEFAULT_PORT 8088u
#define PAD_SHARE_DEFAULT_CTRL_PORT 32769u
#define PAD_SHARE_DEFAULT_TTL 300u

typedef struct {
    uint16_t port, ctrl_port;  /* zero selects default; use distinct ctrl ports per server */
    uint32_t ttl_seconds;      /* zero selects default; maximum 24h */
} pad_share_config_t;

typedef struct {
    const char *title;        /* UTF-8, at most 512 bytes */
    const char *const *steps; /* each at most 4096 bytes, rendered page at most 128KiB */
    size_t step_count;
    const void *image;        /* optional approved JPEG/PNG bytes, never a file path */
    size_t image_size;
    const char *image_mime;
    const void *html;         /* alternative: one approved UTF-8 HTML page in memory */
    size_t html_size;         /* converted to safe static markup; no attributes/resources */
} pad_share_snapshot_t;

/* Call from task context, after default Wi-Fi STA has IPv4. Input is borrowed only
 * during start; do not mutate concurrently. Returns a path for http://<STA-IP>:<port>.
 * One share per device. Starting another revokes the old one (even on failure).
 * These APIs serialize and can block on HTTP shutdown; never call from an ISR,
 * HTTP handler or the default event-loop task. Never log the returned bearer path. */
esp_err_t pad_share_start(const pad_share_config_t *cfg, const pad_share_snapshot_t *snapshot,
                          char *path, size_t path_size);
/* Upload capability is separate and mutually exclusive with snapshot sharing.
 * project_id must match the trusted SD current.id marker. No path argument. */
#define PAD_SHARE_PROJECT_SIZE 33
#define PAD_SHARE_PHOTO_MAX (1024u * 1024u)
#define PAD_SHARE_UPLOAD_LIMIT 8u
esp_err_t pad_share_current_project(char id[PAD_SHARE_PROJECT_SIZE]);
esp_err_t pad_share_upload_start(const pad_share_config_t *cfg, const char *project_id,
                                 char *path, size_t path_size);
/* Authorize only the current project's direct HTML cards. The unbound global
 * current.html remains separate, via pad_share_start. No client paths. */
#define PAD_SHARE_LIBRARY_LIMIT 128u
esp_err_t pad_share_library_start(const pad_share_config_t *cfg, const char *project_id,
                                  char *path, size_t path_size);
unsigned pad_share_upload_count(void);
esp_err_t pad_share_stop(void);
bool pad_share_active(void);
#ifdef __cplusplus
}
#endif
