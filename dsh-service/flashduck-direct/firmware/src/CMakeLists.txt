# This small allowlist is the motor-ownership boundary. Do NOT add duckclaw.c,
# otto_movements, LCD, portals, CLI, agent or any other motor producer here.
set(stock "${CMAKE_CURRENT_LIST_DIR}/../../duckclaw/main")
idf_component_register(SRCS "direct.c" "control.c" "${stock}/wifi/wifi_manager.c" "${stock}/otto/oscillator.c"
    INCLUDE_DIRS "." "${stock}"
    REQUIRES esp_driver_gpio esp_driver_ledc esp_timer esp_hw_support nvs_flash esp_http_server esp_event esp_wifi esp_netif espressif__cjson)
