import { ThemeProvider } from '@mui/material'
import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate } from 'react-router'

import { BaseErrorBoundary } from '@/components/base/base-error-boundary'
import { NoticeManager } from '@/components/layout/notice-manager'
import {
  WindowControls,
  WindowResizeHandles,
} from '@/components/layout/window-controller'
import { useI18n } from '@/hooks/use-i18n'
import { useTonoStatus } from '@/hooks/use-tono'
import { useTonoPreferences } from '@/hooks/use-tono-preferences'
import { useUpdate } from '@/hooks/use-update'
import { useWindowDecorations } from '@/hooks/use-window'
import {
  useCustomTheme,
  useLayoutEvents,
  useLoadingOverlay,
} from '@/pages/_layout/hooks'
import { TonoAuthGuard } from '@/pages/_layout/tono-auth-guard'
import { handleNoticeMessage } from '@/pages/_layout/utils'
import { useThemeMode } from '@/services/states'
import getSystem from '@/utils/get-system'

import { MeshBackground } from './MeshBackground'
import { TONO_FONT_STACK, tonoText } from './theme'
import { TonoSidebar } from './TonoSidebar'
import { ProtectedOfflineBanner } from './ProtectedOfflineBanner'
import { TonoToastProvider } from './TonoToast'

import './design-tokens.css'
import './tono.css'
import 'dayjs/locale/ru'
import 'dayjs/locale/zh-cn'

const OS = getSystem()

/**
 * The Tono application shell: frosted window background, 200px sidebar,
 * custom titlebar on undecorated windows, and the existing auth guard. The
 * MUI ThemeProvider stays for leftover setting widgets that still use MUI.
 */
const TonoLayout = () => {
  const mode = useThemeMode()
  const isDark = mode !== 'light'
  const text = tonoText(isDark)
  const { t } = useTranslation()
  const { theme } = useCustomTheme()
  const { status } = useTonoStatus()
  const { preferences } = useTonoPreferences()
  const { language } = preferences ?? {}
  const { switchLanguage } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const themeReady = useMemo(() => Boolean(theme), [theme])

  const windowControlsRef = useRef<any>(null)
  const { decorated } = useWindowDecorations()

  const isLoginRoute = location.pathname === '/login'
  const isTrayRoute = location.pathname === '/tray'

  useLoadingOverlay(themeReady)

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload
      try {
        handleNoticeMessage(status, msg, t, navigate)
      } catch (error) {
        console.error('[通知处理] 失败:', error)
      }
    },
    [t, navigate],
  )

  useLayoutEvents(handleNotice)
  useUpdate(true)

  useEffect(() => {
    if (language) {
      dayjs.locale(language === 'zh' ? 'zh-cn' : language)
      switchLanguage(language)
    }
  }, [language, switchLanguage])

  if (!themeReady) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: mode === 'light' ? '#fff' : '#181a1b',
        }}
      />
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <NoticeManager position={preferences?.notice_position} />
      <div
        // A perpetual spinner over a frosted surface makes WebView2 recomposite
        // the whole blurred region every frame; on a GPU-less VM or over RDP
        // that is a software Gaussian blur at 60Hz. Give up the glass exactly
        // while something is animating — the states a real machine froze in.
        className={`tono-root ${OS}${
          status?.uiState === 'connecting' ||
          status?.uiState === 'disconnecting'
            ? ' tono-root--transacting'
            : ''
        }`}
        data-tono-theme={isDark ? 'dark' : 'light'}
        data-tono-refined=""
        style={{
          fontFamily: TONO_FONT_STACK,
          color: text.primary,
          ...(isTrayRoute
            ? { background: 'transparent', overflow: 'hidden' }
            : {}),
        }}
      >
        {!isTrayRoute && <MeshBackground dark={isDark} />}

        {!isTrayRoute && decorated === false && (
          <>
            <WindowResizeHandles />
            <div className="tono-titlebar" data-tauri-drag-region="true">
              <WindowControls ref={windowControlsRef} />
            </div>
          </>
        )}

        <TonoToastProvider>
          <TonoAuthGuard>
            {/* Structural layout is also inline (see TonoSidebar): a real
                machine was found rendering with no layout stylesheet, which
                turned the shell into a single unstyled column. */}
            <div
              className="tono-shell"
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                height: '100%',
              }}
            >
              {!isLoginRoute && !isTrayRoute && <TonoSidebar />}
              <main
                className="tono-main"
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflowY: isTrayRoute ? 'hidden' : 'auto',
                  position: 'relative',
                  display: isTrayRoute ? undefined : 'flex',
                  flexDirection: isTrayRoute ? undefined : 'column',
                }}
              >
                {!isLoginRoute && !isTrayRoute && <ProtectedOfflineBanner />}
                <div style={{ flex: isTrayRoute ? undefined : 1, minHeight: 0 }}>
                  <BaseErrorBoundary>
                    <Outlet />
                  </BaseErrorBoundary>
                </div>
              </main>
            </div>
          </TonoAuthGuard>
        </TonoToastProvider>
      </div>
    </ThemeProvider>
  )
}

export default TonoLayout
