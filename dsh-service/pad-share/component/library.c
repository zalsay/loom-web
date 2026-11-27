#include "library.h"
#include "upload.h"
#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

/* Production storage is FatFs, which cannot contain symlinks. Do not follow
 * links in POSIX fixtures. Only names captured locally can reach file I/O. */
#ifdef ESP_PLATFORM
#define node_stat stat
#else
#define node_stat lstat
#endif
#define PATH_CAP 512
#define NAME_CAP 255
static bool join(char path[PATH_CAP],const char *a,const char *b) {
    int n=snprintf(path,PATH_CAP,"%s/%s",a,b);
    return n>0 && n<PATH_CAP;
}
static esp_err_t directory(const char *path) {
    struct stat st;
    if (node_stat(path,&st)!=0) return errno==ENOENT?ESP_ERR_NOT_FOUND:ESP_FAIL;
    return S_ISDIR(st.st_mode)?ESP_OK:ESP_FAIL;
}
static esp_err_t cards_dir(const library_t *lib,char out[PATH_CAP]) {
    char project[PATH_CAP];
    if (!join(project,lib->root,lib->id) || !join(out,project,"cards")) return ESP_ERR_INVALID_SIZE;
    esp_err_t err=directory(project);
    return err==ESP_OK?directory(out):err;
}
static esp_err_t read_html(const char *path,share_view_t *out,unsigned list_page) {
    struct stat st;
    if (node_stat(path,&st)!=0) return errno==ENOENT?ESP_ERR_NOT_FOUND:ESP_FAIL;
    if (!S_ISREG(st.st_mode)) return ESP_FAIL;
    if (st.st_size<=0 || st.st_size>PAD_SHARE_MAX_HTML) return ESP_ERR_INVALID_SIZE;
    size_t n=(size_t)st.st_size;
    FILE *f=fopen(path,"rb");
    if (!f) return ESP_FAIL;
    char *buf=malloc(n);
    esp_err_t err=ESP_ERR_NO_MEM;
    if (buf) {
        bool ok=fread(buf,1,n,f)==n && fgetc(f)==EOF && !ferror(f);
        err=ok?share_library_html(out,buf,n,list_page):ESP_FAIL;
        free(buf);
    }
    if (fclose(f)!=0 && err==ESP_OK) { share_clear(out); err=ESP_FAIL; }
    return err;
}
void library_clear(library_t *lib) {
    for (unsigned i=0;i<lib->archived;i++) free(lib->names[i]);
    memset(lib,0,sizeof(*lib));
}
static int by_name(const void *a,const void *b) {
    return strcmp(*(char *const *)a,*(char *const *)b);
}
static esp_err_t scan(library_t *lib,const char *dir) {
    DIR *d=opendir(dir);
    if (!d) return ESP_FAIL;
    esp_err_t err=ESP_OK;
    for (;;) {
        errno=0;
        struct dirent *entry=readdir(d);
        if (!entry) { if (errno) err=ESP_FAIL; break; }
        const char *s=entry->d_name;
        size_t n=strlen(s);
        if (n<5 || strcasecmp(s+n-5,".html")) continue;
        if (n>NAME_CAP) { err=ESP_ERR_INVALID_SIZE; break; }
        if (strpbrk(s,"/\\:") || n==5) { err=ESP_ERR_INVALID_ARG; break; }
        for (size_t i=0;i<n;i++) if ((unsigned char)s[i]<32 || (unsigned char)s[i]==127) err=ESP_ERR_INVALID_ARG;
        if (err!=ESP_OK) break;
        char path[PATH_CAP]; struct stat st;
        if (!join(path,dir,s) || node_stat(path,&st)!=0) { err=ESP_FAIL; break; }
        if (!S_ISREG(st.st_mode)) continue;
        if (lib->archived==PAD_SHARE_LIBRARY_LIMIT) { err=ESP_ERR_INVALID_SIZE; break; }
        char *copy=malloc(n+1);
        if (!copy) { err=ESP_ERR_NO_MEM; break; }
        memcpy(copy,s,n+1); lib->names[lib->archived++]=copy;
    }
    if (closedir(d)!=0) err=ESP_FAIL;
    if (err==ESP_OK) qsort(lib->names,lib->archived,sizeof(lib->names[0]),by_name);
    return err;
}
esp_err_t library_open(library_t *lib,const char *root,const char *id,const uint8_t random[16]) {
    if (!lib || !root || !random || !upload_bound(root,id)) return ESP_ERR_INVALID_STATE;
    lib->root=root; strcpy(lib->id,id);
    char path[PATH_CAP];
    esp_err_t err=cards_dir(lib,path);
    if (err==ESP_OK) err=scan(lib,path);
    else if (err==ESP_ERR_NOT_FOUND) err=ESP_OK;
    if (err!=ESP_OK) goto fail;
    if (!upload_bound(root,id)) { err=ESP_ERR_INVALID_STATE; goto fail; }
    upload_paths_t token; upload_paths(&token,random); strcpy(lib->path,token.page); lib->path[1]='l';
    return ESP_OK;
fail:
    library_clear(lib); return err;
}
/* Names only appear as escaped link TEXT. No URI includes a filename. */
static char *label(char *dst,const char *s) {
    size_t n=strlen(s)-5;
    for (size_t i=0;i<n;i++) {
        const char *text=s[i]=='<'?"&lt;":s[i]=='>'?"&gt;":s[i]=='&'?"&amp;":NULL;
        if (text) { size_t size=strlen(text); memcpy(dst,text,size); dst+=size; }
        else *dst++=s[i];
    }
    return dst;
}
static esp_err_t listing(const library_t *lib,unsigned page,unsigned total,share_view_t *out) {
    unsigned start=(page-1)*LIBRARY_PAGE_SIZE, end=start+LIBRARY_PAGE_SIZE;
    if (end>total) end=total;
    size_t cap=1024;
    for (unsigned i=start;i<end;i++) {
        cap+=64+5*strlen(lib->names[i]);
    }
    char *buf=malloc(cap); if (!buf) return ESP_ERR_NO_MEM;
    char *p=buf;
    p+=sprintf(p,"<!doctype html><html lang=zh><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>项目卡片</title></head><body><h1>项目卡片</h1><p>共 %u 张 · 第 %u 页</p><ul>",total,page);
    for (unsigned i=start;i<end;i++) {
        p+=sprintf(p,"<li><a href='c%u'>",i+1);
        p=label(p,lib->names[i]);
        p+=sprintf(p,"</a></li>");
    }
    p+=sprintf(p,"</ul>");
    if (!total) p+=sprintf(p,"<p>暂无卡片</p>");
    if (page==2) p+=sprintf(p,"<a href='./'>上一页</a> ");
    if (page>2) p+=sprintf(p,"<a href='p%u'>上一页</a> ",page-1);
    if (end<total) p+=sprintf(p,"<a href='p%u'>下一页</a>",page+1);
    p+=sprintf(p,"</body></html>");
    out->page=buf; out->page_size=(size_t)(p-buf); return ESP_OK;
}
esp_err_t library_page(const library_t *lib,const char *uri,share_view_t *out) {
    if (!lib || !out || !uri || !lib->path[0]) return ESP_ERR_NOT_FOUND;
    size_t prefix=strlen(lib->path);
    if (strncmp(uri,lib->path,prefix)) return ESP_ERR_NOT_FOUND;
    const char *s=uri+prefix;
    unsigned total=lib->archived;
    if (!*s) return listing(lib,1,total,out);
    char kind=*s++;
    if ((kind!='p' && kind!='c') || *s<'1' || *s>'9') return ESP_ERR_NOT_FOUND;
    unsigned n=0;
    while (*s>='0' && *s<='9') {
        n=n*10+(unsigned)(*s++-'0'); if (n>total) return ESP_ERR_NOT_FOUND;
    }
    if (*s) return ESP_ERR_NOT_FOUND;
    if (kind=='p') return n>=2 && (n-1)*LIBRARY_PAGE_SIZE<total?listing(lib,n,total,out):ESP_ERR_NOT_FOUND;
    char dir[PATH_CAP],path[PATH_CAP];
    esp_err_t err=cards_dir(lib,dir);
    if (err!=ESP_OK) return err;
    if (!join(path,dir,lib->names[n-1])) return ESP_ERR_INVALID_SIZE;
    return read_html(path,out,1+(n-1)/LIBRARY_PAGE_SIZE);
}
