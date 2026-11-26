/* Host smoke fixture: exercise the same snapshot builder used by the ESP component. */
#include "snapshot.h"
#include <stdio.h>
int main(void) {
    static const char card[] = "<h1>我的机器狗</h1><p onclick='alert(1)'>看一下转轴</p><script>window.ran=1</script><img src='https://example.invalid/private'><a href='/secret'>回到桌面</a>";
    const uint8_t bytes[16] = {1}; /* fixture only, firmware uses hardware entropy */
    const pad_share_snapshot_t in = {.html=card,.html_size=sizeof(card)-1};
    share_view_t v={0}; if(share_build(&v,&in,bytes)!=ESP_OK) return 1;
    printf("%s\n%s\n%s\n",v.card, SHARE_CACHE, SHARE_HTML_CSP);
    fwrite(v.page,1,v.page_size,stdout); share_clear(&v); return 0;
}
