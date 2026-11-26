#include "upload.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

void upload_paths(upload_paths_t *p, const uint8_t random[16]) {
    static const char digits[]="0123456789abcdef";
    memcpy(p->page,"/u/",3);
    for (int i=0;i<16;i++) {
        p->page[3+2*i]=digits[random[i]>>4]; p->page[4+2*i]=digits[random[i]&15];
    }
    strcpy(p->page+35,"/"); strcpy(p->photo,p->page); strcat(p->photo,"photo");
}
enum up_ticket upload_check_id(const upload_history_t *h,const char *id) {
    if (!id || strnlen(id,33)!=32 || strspn(id,"0123456789abcdef")!=32) return UP_BAD_ID;
    for (unsigned i=0;i<h->count;i++) if (!strcmp(h->saved[i],id)) return UP_REPLAY;
    return h->count<PAD_SHARE_UPLOAD_LIMIT ? UP_NEW : UP_FULL;
}
void upload_record(upload_history_t *h,const char *id) {
    if (upload_check_id(h,id)==UP_NEW) memcpy(h->saved[h->count++],id,33);
}
enum up_route upload_lookup(const upload_paths_t *p, bool live, bool get, bool post, const char *uri) {
    if (!live || !uri) return UP_NONE;
    if (get && !strcmp(uri,p->page)) return UP_FORM;
    return post && !strcmp(uri,p->photo) ? UP_PHOTO : UP_NONE;
}
/* Exact ASCII component, never an arbitrary directory. Reserve FAT device aliases. */
static bool valid_id(const char *s) {
    if (!s) return false;
    size_t n=strnlen(s,PAD_SHARE_PROJECT_SIZE);
    if (!n || n>=PAD_SHARE_PROJECT_SIZE) return false;
    for (size_t i=0;i<n;i++) if (!(s[i]>='a' && s[i]<='z') && !(s[i]>='0' && s[i]<='9') && s[i]!='_' && s[i]!='-') return false;
    if (!strcmp(s,"aux") || !strcmp(s,"con") || !strcmp(s,"nul") || !strcmp(s,"prn")) return false;
    return !(n==4 && (!strncmp(s,"com",3)||!strncmp(s,"lpt",3)) && s[3]>='0' && s[3]<='9');
}
#define PATH_CAP 256
static bool join(char *out,const char *parent,const char *name) {
    int n=snprintf(out,PATH_CAP,"%s/%s",parent,name); return n>0 && n<PATH_CAP;
}
bool upload_project(const char *root,char out[PAD_SHARE_PROJECT_SIZE]) {
    char path[PATH_CAP], buf[PAD_SHARE_PROJECT_SIZE+2];
    out[0]=0;
    if (!join(path,root,"current.id")) return false;
    FILE *f=fopen(path,"rb"); if (!f) return false;
    size_t n=fread(buf,1,sizeof(buf),f);
    bool ok=n<sizeof(buf) && !ferror(f) && !memchr(buf,0,n);
    if (fclose(f)!=0 || !ok) return false;
    if (n && buf[n-1]=='\n') { n--; if (n && buf[n-1]=='\r') n--; }
    buf[n]=0; if (!valid_id(buf)) return false;
    memcpy(out,buf,n+1); return true;
}
bool upload_bound(const char *root,const char *project) {
    char id[PAD_SHARE_PROJECT_SIZE]; return valid_id(project) && upload_project(root,id) && !strcmp(project,id);
}
static bool directory(const char *path) {
    struct stat st;
    if (mkdir(path,0700)==0) return true;
    return errno==EEXIST && stat(path,&st)==0 && S_ISDIR(st.st_mode);
}
static bool photos_dir(char *dir,const char *root,const char *id,bool create) {
    char project[PATH_CAP]; return valid_id(id) && join(project,root,id) && (!create || directory(project)) &&
        join(dir,project,"photos") && (!create || directory(dir));
}
bool upload_prepare(const char *root,const char *project) {
    char dir[PATH_CAP], tmp[PATH_CAP];
    if (!upload_bound(root,project) || !photos_dir(dir,root,project,true) || !join(tmp,dir,"receive.tmp")) return false;
    /* Reserved staging name: reclaim a power-interrupted upload on next opening. */
    return unlink(tmp)==0 || errno==ENOENT;
}

/* Baseline sequential JPEG, one interleaved scan. Check every coded block
 * without calculating pixel values or allocating a decompressed framebuffer. */
typedef struct { unsigned char counts[16], symbols[256]; } huff_table;
typedef struct { FILE *f; unsigned byte; int bits; } bit_reader;
static int bit(bit_reader *r) {
    if (!r->bits) {
        int b=fgetc(r->f); if (b<0 || (b==255 && fgetc(r->f)!=0)) return -1;
        r->byte=(unsigned)b; r->bits=8;
    }
    return (r->byte >> --r->bits)&1;
}
static int symbol(bit_reader *r,const huff_table *t) {
    int index=0,code=0;
    for (int i=0;i<16;i++) {
        int b=bit(r); if (b<0) return -1;
        code=code*2+b;
        if (code<t->counts[i]) return t->symbols[index+code];
        code-=t->counts[i]; index+=t->counts[i];
    }
    return -1;
}
static bool block(bit_reader *r,const huff_table *dc,const huff_table *ac) {
    int d=symbol(r,dc); if (d<0 || d>11) return false;
    while (d--) if (bit(r)<0) return false;
    int k=1;
    while (k<64) {
        int a=symbol(r,ac); if (a<0) return false;
        if (!a) return true;
        if (a==0xf0) { k+=16; continue; }
        int n=a&15; k+=a>>4;
        if (!n || n>10 || k>=64) return false;
        while (n--) if (bit(r)<0) return false;
        k++;
    }
    return k==64;
}
static bool marker(bit_reader *r,int expected) {
    while (r->bits) if (bit(r)!=1) return false;
    if (fgetc(r->f)!=255) return false;
    int b; do { b=fgetc(r->f); } while (b==255);
    return b==expected;
}
static int u16(FILE *f) { int a=fgetc(f),b=fgetc(f); return a<0 || b<0 ? -1 : (a<<8)|b; }
static bool jpeg(FILE *f,up_live_fn live,void *ctx) {
    if (u16(f)!=0xffd8) return false;
    unsigned q=0,dc=0,ac=0; int nc=0,ids[3]={0},tq[3]={0},blocks[3]={0};
    int height=0,width=0,max_h=1,max_v=1,restart=0;
    huff_table tables[2][4];
    for (;;) {
        if (fgetc(f)!=255) return false;
        int m; do { m=fgetc(f); } while (m==255);
        if (m<0) return false;
        int len=u16(f)-2; if (len<0) return false;
        if ((m>=0xe0 && m<=0xef) || m==0xfe) {
            if (fseek(f,len,SEEK_CUR)!=0) return false;
        } else if (m==0xdb) {
            if (!len || len%65) return false;
            while (len) { int t=fgetc(f); if (t<0 || t>3) return false;
                q|=1u<<t; for (int i=0;i<64;i++) if (fgetc(f)<=0) return false; len-=65; }
        } else if (m==0xc4) {
            if (!len) return false;
            while (len) {
                int t=fgetc(f); if (len<17 || t<0 || (t & ~0x13)) return false;
                int count=0, free_codes=1;
                for (int i=0;i<16;i++) { int b=fgetc(f); if (b<0) return false;
                    free_codes=2*free_codes-b; if (free_codes<=0) return false; count+=b;
                    tables[t>>4][t&3].counts[i]=(unsigned char)b; }
                len-=17; if (!count || count>256 || count>len || fread(tables[t>>4][t&3].symbols,1,(size_t)count,f)!=(size_t)count) return false;
                len-=count; if (t&16) ac|=1u<<(t&3); else dc|=1u<<t;
            }
        } else if (m==0xc0) {
            if (nc || fgetc(f)!=8) return false;
            height=u16(f); width=u16(f); nc=fgetc(f);
            if (height<=0 || height>2048 || width<=0 || width>2048 || (nc!=1 && nc!=3) || len!=6+3*nc) return false;
            for (int i=0;i<nc;i++) { ids[i]=fgetc(f); int s=fgetc(f); tq[i]=fgetc(f);
                if (ids[i]<0 || tq[i]<0 || tq[i]>3 || (s>>4)<1 || (s>>4)>4 || (s&15)<1 || (s&15)>4) return false;
                for (int j=0;j<i;j++) if (ids[i]==ids[j]) return false;
                blocks[i]=(s>>4)*(s&15);
                if ((s>>4)>max_h) max_h=s>>4;
                if ((s&15)>max_v) max_v=s&15;
            }
            if (nc==1) { max_h=max_v=1; blocks[0]=1; }
            if (blocks[0]+blocks[1]+blocks[2]>10) return false;
        } else if (m==0xdd) {
            if (len!=2 || (restart=u16(f))<0) return false;
        } else if (m==0xda) {
            if (!nc || len!=4+2*nc || fgetc(f)!=nc) return false;
            unsigned seen=0; int order[3],sel[3];
            for (int i=0;i<nc;i++) { int id=fgetc(f),t=fgetc(f),k=0;
                while (k<nc && ids[k]!=id) k++;
                if (k==nc || (seen&(1u<<k)) || t<0 || (t&~0x33) || !(q&(1u<<tq[k])) || !(ac&(1u<<(t&3))) || !(dc&(1u<<(t>>4)))) return false;
                seen|=1u<<k; order[i]=k; sel[i]=t;
            }
            if (u16(f)!=63 || fgetc(f)!=0) return false;
            int units=((width+8*max_h-1)/(8*max_h))*((height+8*max_v-1)/(8*max_v));
            bit_reader bits={f,0,0}; int rst=0;
            for (int u=0;u<units;u++) {
                if (!(u%256) && !live(ctx)) return false;
                if (u && restart && !(u%restart) && !marker(&bits,0xd0+(rst++%8))) return false;
                for (int i=0;i<nc;i++) for (int b=0;b<blocks[order[i]];b++)
                    if (!block(&bits,&tables[0][sel[i]>>4],&tables[1][sel[i]&3])) return false;
            }
            return marker(&bits,0xd9) && fgetc(f)==EOF && !ferror(f);
        } else return false;
    }
}

enum up_result upload_save(const char *root,const char *project,uint32_t nonce,size_t length,
                           up_receive_fn receive,up_live_fn live,void *ctx) {
    char dir[PATH_CAP],tmp[PATH_CAP],dst[PATH_CAP],name[16];
    if (!length || length>PAD_SHARE_PHOTO_MAX) return UP_FORMAT;
    if (!live(ctx) || !upload_bound(root,project)) return UP_STOPPED;
    if (!photos_dir(dir,root,project,false) || !join(tmp,dir,"receive.tmp")) return UP_STORAGE;
    snprintf(name,sizeof(name),"%08lx.jpg",(unsigned long)nonce);
    struct stat st;
    if (!join(dst,dir,name) || stat(dst,&st)==0 || errno!=ENOENT) return UP_STORAGE;
    int fd=open(tmp,O_RDWR|O_CREAT|O_EXCL,0600); if (fd<0) return UP_STORAGE;
    FILE *f=fdopen(fd,"w+b"); if (!f) { close(fd); unlink(tmp); return UP_STORAGE; }
    enum up_result result=UP_STORAGE;
    char chunk[1024];
    while (length) {
        if (!live(ctx)) { result=UP_STOPPED; goto done; }
        size_t want=length<sizeof(chunk)?length:sizeof(chunk);
        int got=receive(ctx,chunk,want);
        if (got<=0 || (size_t)got>want) { result=UP_INCOMPLETE; goto done; }
        if (fwrite(chunk,1,(size_t)got,f)!=(size_t)got) goto done;
        length-=(size_t)got;
    }
    if (fflush(f) || fseek(f,0,SEEK_SET)) goto done;
    if (!jpeg(f,live,ctx)) { result=!live(ctx)?UP_STOPPED:(ferror(f)?UP_STORAGE:UP_FORMAT); goto done; }
    if (fsync(fd)!=0) goto done;
    if (fclose(f)!=0) { f=NULL; goto done; } f=NULL;
    /* A switched project may never redirect this file: destination was fixed at
     * start and publication is gated again after all potentially lengthy I/O. */
    if (!upload_bound(root,project) || !live(ctx)) { result=UP_STOPPED; goto done; }
    if (rename(tmp,dst)==0) return UP_SAVED; /* FatFs f_rename syncs directory metadata */
done:
    if (f) fclose(f);
    unlink(tmp); return result;
}
