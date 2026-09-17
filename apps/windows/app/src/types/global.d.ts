type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

/**
 * defines in `vite.config.ts`
 */
declare const OS_PLATFORM: Platform

interface ITrafficItem {
  up: number
  down: number
  up_rate?: number
  down_rate?: number
  last_updated?: number
  upTotal?: number
  downTotal?: number
}

interface IConnectionsItem {
  id: string
  metadata: {
    network: string
    type: string
    host: string
    sourceIP: string
    sourcePort: string
    destinationPort: string
    destinationIP?: string
    remoteDestination?: string
    process?: string
    processPath?: string
  }
  upload: number
  download: number
  start: string
  chains: string[]
  rule: string
  rulePayload: string
  curUpload?: number // upload speed, calculate at runtime
  curDownload?: number // download speed, calculate at runtime
}

interface IConnections {
  downloadTotal: number
  uploadTotal: number
  connections: IConnectionsItem[]
}

interface TonoTestItem {
  uid: string
  name?: string
  icon?: string
  url: string
}

interface TonoPreferences {
  app_log_level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | string
  app_log_max_size?: number // KB
  app_log_max_count?: number
  language?: string
  tray_event?:
    | 'main_window'
    | 'tray_menu'
    | 'system_proxy'
    | 'tun_mode'
    | string
  env_type?: 'bash' | 'cmd' | 'powershell' | 'fish' | string
  startup_script?: string
  start_page?: string
  clash_core?: string
  theme_mode?: 'light' | 'dark' | 'system'
  enable_refined_ui?: boolean
  traffic_graph?: boolean
  enable_memory_usage?: boolean
  enable_group_icon?: boolean
  pause_render_traffic_stats_on_blur?: boolean
  menu_icon?: 'monochrome' | 'colorful' | 'disable'
  menu_order?: string[]
  notice_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  collapse_navbar?: boolean
  tray_icon?: 'monochrome' | 'colorful'
  common_tray_icon?: boolean
  sysproxy_tray_icon?: boolean
  tun_tray_icon?: boolean
  macos_kill_switch_mode?: 'disabled' | 'standard' | 'permanent'
  enable_tray_speed?: boolean
  // enable_tray_icon?: boolean;
  tray_proxy_groups_display_mode?: 'default' | 'inline' | 'disable'
  tray_inline_outbound_modes?: boolean
  enable_tun_mode?: boolean
  enable_auto_light_weight_mode?: boolean
  auto_light_weight_minutes?: number
  enable_auto_launch?: boolean
  auto_launch_seeded?: boolean
  enable_silent_start?: boolean
  enable_system_proxy?: boolean
  enable_global_hotkey?: boolean
  enable_dns_settings?: boolean
  proxy_auto_config?: boolean
  pac_file_content?: string
  proxy_host?: string
  enable_random_port?: boolean
  verge_mixed_port?: number
  verge_socks_port?: number
  verge_redir_port?: number
  verge_tproxy_port?: number
  verge_port?: number
  verge_redir_enabled?: boolean
  verge_tproxy_enabled?: boolean
  verge_socks_enabled?: boolean
  verge_http_enabled?: boolean
  enable_proxy_guard?: boolean
  enable_bypass_check?: boolean
  use_default_bypass?: boolean
  proxy_guard_duration?: number
  system_proxy_bypass?: string
  web_ui_list?: string[]
  hotkeys?: string[]
  theme_setting?: {
    primary_color?: string
    secondary_color?: string
    primary_text?: string
    secondary_text?: string
    info_color?: string
    error_color?: string
    warning_color?: string
    success_color?: string
    font_family?: string
    css_injection?: string
    background_image?: string
    background_blend_mode?: string
    background_opacity?: number
  }
  auto_close_connection?: boolean
  auto_check_update?: boolean
  default_latency_test?: string
  default_latency_timeout?: number
  enable_auto_delay_detection?: boolean
  auto_delay_detection_interval_minutes?: number
  enable_builtin_enhanced?: boolean
  auto_log_clean?: 0 | 1 | 2 | 3 | 4
  enable_auto_backup_schedule?: boolean
  auto_backup_interval_hours?: number
  auto_backup_on_change?: boolean
  proxy_layout_column?: number
  test_list?: TonoTestItem[]
  webdav_url?: string
  webdav_username?: string
  webdav_password?: string
  home_cards?: Record<string, boolean>
  enable_hover_jump_navigator?: boolean
  hover_jump_navigator_delay?: number
  enable_external_controller?: boolean
}

// Traffic monitor types
interface ITrafficDataPoint {
  up: number
  down: number
  timestamp: number
  name: string
}

interface ISamplingConfig {
  rawDataMinutes: number
  compressedDataMinutes: number
  compressionRatio: number
}

interface ISamplerStats {
  rawBufferSize: number
  compressedBufferSize: number
  compressionQueueSize: number
  totalMemoryPoints: number
}

interface ITrafficWorkerInitMessage {
  type: 'init'
  config: ISamplingConfig & {
    snapshotIntervalMs: number
    defaultRangeMinutes: number
  }
}

interface ITrafficWorkerAppendMessage {
  type: 'append'
  payload: {
    up: number
    down: number
    timestamp?: number
  }
}

interface ITrafficWorkerClearMessage {
  type: 'clear'
}

interface ITrafficWorkerSetRangeMessage {
  type: 'setRange'
  minutes: number
}

interface ITrafficWorkerRequestSnapshotMessage {
  type: 'requestSnapshot'
}

type TrafficWorkerRequestMessage =
  | ITrafficWorkerInitMessage
  | ITrafficWorkerAppendMessage
  | ITrafficWorkerClearMessage
  | ITrafficWorkerSetRangeMessage
  | ITrafficWorkerRequestSnapshotMessage

interface ITrafficWorkerSnapshotMessage {
  type: 'snapshot'
  dataPoints: ITrafficDataPoint[]
  availableDataPoints: ITrafficDataPoint[]
  samplerStats: ISamplerStats
  rangeMinutes: number
  lastTimestamp?: number
  reason:
    | 'init'
    | 'interval'
    | 'range-change'
    | 'request'
    | 'append-throttle'
    | 'clear'
}

interface ITrafficWorkerLogMessage {
  type: 'log'
  message: string
}

type TrafficWorkerResponseMessage =
  | ITrafficWorkerSnapshotMessage
  | ITrafficWorkerLogMessage
