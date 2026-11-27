idf_component_register(SRCS "snapshot.c" "upload.c" "library.c" "pad_share.c"
                       INCLUDE_DIRS "include"
                       PRIV_REQUIRES esp_http_server esp_timer esp_event esp_wifi esp_netif esp_hw_support lwip pthread)
