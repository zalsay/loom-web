#include "snapshot.h"
#include <stdlib.h>
#include <string.h>

#define MAX_PAGE (128u * 1024u)
typedef struct { char *buf; size_t len, cap; } writer_t;
static bool put(writer_t *w, const char *s, size_t n) {
    if (n > w->cap - w->len) return false;
    if (w->buf) memcpy(w->buf + w->len, s, n);
    w->len += n;
    return true;
}
#define LIT(w,s) put(w,s,sizeof(s)-1)
static bool escaped(writer_t *w, const char *s, size_t max) {
    if (!s) return false;
    for (size_t i=0; i<=max; i++) {
        if (!s[i]) return true;
        if (i==max) return false;
        bool ok;
        switch (s[i]) {
        case '&': ok=LIT(w,"&amp;"); break;
        case '<': ok=LIT(w,"&lt;"); break;
        case '>': ok=LIT(w,"&gt;"); break;
        case '"': ok=LIT(w,"&quot;"); break;
        case '\'': ok=LIT(w,"&#39;"); break;
        default: ok=put(w,s+i,1); break;
        }
        if (!ok) return false;
    }
    return false;
}
static bool eqtag(const char *s, size_t n, const char *name) {
    if (strlen(name)!=n) return false;
    for (size_t i=0;i<n;i++) {
        unsigned char c=(unsigned char)s[i];
        if (c>='A' && c<='Z') c+='a'-'A';
        if (c!=(unsigned char)name[i]) return false;
    }
    return true;
}
/* Project input to text + hardcoded formatting tokens, not a pass-through HTML
 * sanitizer. Unrecognized markup/URLs/attributes never enter an output tag. */
static bool project(writer_t *w, const char *s, size_t n) {
    static const char *const allowed[]={"p","br","hr","div","section","article","h1","h2","h3","h4","h5","h6","ul","ol","li","strong","b","em","i","pre","code","blockquote","table","thead","tbody","tr","th","td"};
    const char *skip=NULL;
    for (size_t i=0;i<n;) {
        if (s[i]!='<') {
            size_t start=i;
            while (i<n && s[i]!='<') i++;
            if (!skip && !put(w,s+start,i-start)) return false;
            continue;
        }
        i++;
        if (!skip && n-i>=3 && !memcmp(s+i,"!--",3)) {
            i+=3;
            while (n-i>=3 && memcmp(s+i,"-->",3)) i++;
            i=n-i>=3 ? i+3 : n;
            continue;
        }
        bool close=i<n && s[i]=='/';
        if (close) i++;
        size_t name=i;
        while (i<n && ((s[i]>='a' && s[i]<='z') || (s[i]>='A' && s[i]<='Z') || (s[i]>='0' && s[i]<='9'))) i++;
        size_t len=i-name;
        if (i<n && s[i]!=' ' && s[i]!='\t' && s[i]!='\n' && s[i]!='\r' && s[i]!='/' && s[i]!='>') len=0;
        char quote=0;
        while (i<n) {
            char c=s[i++];
            if (quote) { if (quote==c) quote=0; }
            else if (c=='"' || c=='\'') quote=c;
            else if (c=='>') break;
        }
        if (skip) { if (close && eqtag(s+name,len,skip)) skip=NULL; continue; }
        if (!close && eqtag(s+name,len,"script")) { skip="script"; continue; }
        if (!close && eqtag(s+name,len,"style")) { skip="style"; continue; }
        for (size_t k=0;k<sizeof(allowed)/sizeof(allowed[0]);k++) {
            if (!eqtag(s+name,len,allowed[k])) continue;
            if (!LIT(w,"<") || (close && !LIT(w,"/")) || !put(w,allowed[k],len) || !LIT(w,">")) return false;
            break;
        }
    }
    return true;
}
static bool render(writer_t *w, const pad_share_snapshot_t *s) {
    if (!LIT(w,"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Card</title></head><body>")) return false;
    if (s->html) {
        if (!project(w,s->html,s->html_size)) return false;
    } else {
        if (!LIT(w,"<h1>") || !escaped(w,s->title,512) || !LIT(w,"</h1><ol>")) return false;
        for (size_t i=0;i<s->step_count;i++)
            if (!LIT(w,"<li>") || !escaped(w,s->steps[i],4096) || !LIT(w,"</li>")) return false;
        if (!LIT(w,"</ol>") || (s->image && !LIT(w,"<img src=\"image\" alt=\"\">"))) return false;
    }
    return LIT(w,"</body></html>");
}
void share_clear(share_view_t *v) {
    free(v->page); free(v->image); memset(v,0,sizeof(*v));
}
esp_err_t share_build(share_view_t *v, const pad_share_snapshot_t *s, const uint8_t random[16]) {
    if (!s || !v || !random) return ESP_ERR_INVALID_ARG;
    memset(v,0,sizeof(*v));
    if (s->html || s->html_size) {
        if (!s->html || !s->html_size || s->html_size>PAD_SHARE_MAX_HTML || s->image || s->image_size || s->image_mime || s->title || s->steps || s->step_count) return ESP_ERR_INVALID_ARG;
    } else if (!s->title || s->step_count>PAD_SHARE_MAX_STEPS || (s->step_count && !s->steps)) return ESP_ERR_INVALID_ARG;
    if (s->image || s->image_size || s->image_mime) {
        if (!s->image || !s->image_mime || s->image_size>PAD_SHARE_MAX_IMAGE) return ESP_ERR_INVALID_ARG;
        if (!strcmp(s->image_mime,"image/png") && s->image_size>=8 && !memcmp(s->image,"\x89PNG\r\n\x1a\n",8)) v->mime="image/png";
        else if (!strcmp(s->image_mime,"image/jpeg") && s->image_size>=3 && !memcmp(s->image,"\xff\xd8\xff",3)) v->mime="image/jpeg";
        else return ESP_ERR_INVALID_ARG;
    }
    writer_t w={.cap=MAX_PAGE};
    if (!render(&w,s)) return ESP_ERR_INVALID_SIZE;
    v->page=malloc(w.len+1);
    if (!v->page) return ESP_ERR_NO_MEM;
    v->page_size=w.len; w=(writer_t){.buf=v->page,.cap=v->page_size};
    if (!render(&w,s) || w.len!=v->page_size) { share_clear(v); return ESP_ERR_INVALID_SIZE; }
    v->page[w.len]='\0';
    if (v->mime) {
        v->image=malloc(s->image_size);
        if (!v->image) { share_clear(v); return ESP_ERR_NO_MEM; }
        memcpy(v->image,s->image,s->image_size); v->image_size=s->image_size;
    }
    strcpy(v->card,"/s/");
    const char hex[]="0123456789abcdef";
    for (size_t i=0;i<16;i++) { v->card[3+2*i]=hex[random[i]>>4]; v->card[4+2*i]=hex[random[i]&15]; }
    memcpy(v->asset,v->card,35); strcpy(v->asset+35,"/image"); strcpy(v->card+35,"/card");
    return ESP_OK;
}
enum share_resource share_lookup(const share_view_t *v, bool active, int64_t now, const char *uri) {
    if (!v || !v->page || !active || now>=v->deadline_us || !uri) return SHARE_NONE;
    size_t n=strlen(uri);
    if (n!=40 && n!=41) return SHARE_NONE;
    unsigned diff=0;
    for (size_t i=0;i<35;i++) diff|=(unsigned char)uri[i]^(unsigned char)v->card[i];
    if (diff) return SHARE_NONE;
    if (!strcmp(uri+35,"/card")) return SHARE_PAGE;
    if (v->image && !strcmp(uri+35,"/image")) return SHARE_IMAGE;
    return SHARE_NONE;
}
