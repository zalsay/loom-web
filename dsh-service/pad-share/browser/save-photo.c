/* Browser-test adapter; exercises the firmware's actual JPEG validation and storage code. */
#include "upload.h"
#include <stdio.h>
#include <stdlib.h>
static bool live(void *ctx) { (void)ctx; return true; }
static int read_stdin(void *ctx, char *out, size_t n) { (void)ctx; return (int)fread(out,1,n,stdin); }
int main(int argc,char **argv) {
    if(argc!=3 || !upload_prepare(argv[1],"demo")) return 1;
    return upload_save(argv[1],"demo",1,(size_t)strtoul(argv[2],NULL,10),read_stdin,live,NULL)==UP_SAVED?0:2;
}
