// SPDX-License-Identifier: CC-BY-NC-SA-4.0
#include "control.h"
#include <string.h>

bool dc_valid_id(const char *s) {
    if (!s || !*s || strlen(s) > 64) return false;
    for (; *s; ++s) if (!((*s >= 'a' && *s <= 'z') || (*s >= 'A' && *s <= 'Z') ||
                            (*s >= '0' && *s <= '9') || *s == '-' || *s == '_')) return false;
    return true;
}
bool dc_calibrated(const dc_control *c) {
    return c->lo >= 45 && c->lo < c->center && c->center < c->hi && c->hi <= 180 && c->hi - c->lo <= 28;
}
bool dc_ready(const dc_control *c) {
    return c->armed && dc_calibrated(c) && !c->active && c->count < DC_CAPACITY;
}
dc_record *dc_find(dc_control *c, const char *id) {
    for (int i = 0; i < c->count; ++i) if (!strcmp(c->history[i].id, id)) return &c->history[i];
    return NULL;
}
dc_result dc_submit(dc_control *c, const char *id, int angle, int duration, int64_t expiry, int64_t now) {
    if (!dc_valid_id(id) || duration != DC_DURATION_MS) return DC_INVALID;
    dc_record *old = dc_find(c, id);
    if (old) return old->angle == angle && old->expiry == expiry ? DC_REPEAT : DC_CONFLICT;
    if (!dc_ready(c)) return DC_UNAVAILABLE;
    if (angle < c->lo || angle > c->hi) return DC_INVALID;
    if (expiry <= now || expiry - now > 5000) return DC_EXPIRED;
    dc_record *r = &c->history[c->count++];
    strcpy(r->id, id); r->angle = angle; r->expiry = expiry; r->status = DC_ACCEPTED;
    c->active = c->count;
    return DC_NEW;
}
int dc_step(int from, int to, int step) { return from + (to - from) * step / DC_STEPS; }
void dc_finish(dc_control *c, bool success) {
    dc_record *r = &c->history[c->active - 1];
    if (success) c->position = r->angle;
    r->status = success ? DC_FINISHED : DC_FAILED;
    c->active = 0;
}
const char *dc_name(dc_status s) {
    switch (s) {
    case DC_ACCEPTED: return "accepted";
    case DC_FINISHED: return "command_finished";
    case DC_FAILED: return "failed";
    default: return "unknown";
    }
}
