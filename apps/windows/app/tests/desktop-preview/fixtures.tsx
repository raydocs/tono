import { navigationItems } from '@/pages/_navigation-meta'
import { TonoIcon } from '@/tono-ui/TonoIcon'

export const useThemeMode = () =>
  new URLSearchParams(location.search).get('theme') || 'light'
export const useTonoStatus = () => ({
  status: {
    accountState:
      new URLSearchParams(location.search).get('account') || 'signedOut',
  },
  mutateTonoStatus: async () => {},
})
const wait = () =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      new URLSearchParams(location.search).has('slow') ? 3000 : 700,
    ),
  )
export const tonoSignInStart = async () => {
  await wait()
  return { expiresIn: 600 }
}
export const tonoSignInVerify = async (_email: string, code: string) => {
  await wait()
  if (code !== '123456')
    throw new Error(
      'That code did not work. Check the latest email and try again.',
    )
  return { suspended: false }
}
export const tonoDisconnect = async () => {}
export const tonoRetryRestore = async () => {}
export const formatTonoActionError = (error: Error) => error.message
export const SupportContact = () => <span>Contact Tono support</span>
export const navItems = Object.values(navigationItems).map((item) => ({
  ...item,
  icon: <TonoIcon name="dashboard" size={16} />,
}))
