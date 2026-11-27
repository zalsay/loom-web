// SPDX-License-Identifier: CC-BY-NC-SA-4.0
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define DC_CAPACITY 128
#define DC_STEPS 35
#define DC_DURATION_MS 700

typedef enum { DC_UNKNOWN, DC_ACCEPTED, DC_FINISHED, DC_FAILED } dc_status;
typedef struct { char id[65]; int angle; int64_t expiry; dc_status status; } dc_record;
typedef struct {
    int lo, center, hi, position;
    bool armed;
    int count, active; // active is index+1 or zero
    dc_record history[DC_CAPACITY];
} dc_control;

typedef enum { DC_NEW, DC_REPEAT, DC_CONFLICT, DC_UNAVAILABLE, DC_INVALID, DC_EXPIRED } dc_result;
bool dc_valid_id(const char *id);
bool dc_calibrated(const dc_control *ctl);
bool dc_ready(const dc_control *ctl);
dc_record *dc_find(dc_control *ctl, const char *id);
dc_result dc_submit(dc_control *ctl, const char *id, int angle, int duration, int64_t expiry, int64_t now);
int dc_step(int from, int to, int step);
void dc_finish(dc_control *ctl, bool success);
const char *dc_name(dc_status status);
