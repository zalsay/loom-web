/* Browser smoke fixture: expose rendered pages, never substitute a different HTML renderer. */
#include "library.h"
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv){
 if(argc!=3)return 2;
 library_t lib={0};share_view_t out={0};const uint8_t nonce[16]={0x42};
 if(library_open(&lib,argv[1],"demo",nonce)!=ESP_OK)return 3;
 int code=0;
 if(!strcmp(argv[2],"ROOT"))puts(lib.path);
 else if(library_page(&lib,argv[2],&out)!=ESP_OK)code=4;
 else fwrite(out.page,1,out.page_size,stdout);
 share_clear(&out);library_clear(&lib);return code;
}
