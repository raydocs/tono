import { createContext, use } from 'react'

/**
 * Shared channel for the app-wide Tono toast (see TonoToast.tsx). Kept in a
 * component-free module so the provider file stays a clean fast-refresh unit.
 */

export type ShowTonoToast = (message: string) => void

export const TonoToastContext = createContext<ShowTonoToast>(() => {})

/** Queue a transient confirmation toast ("Switched to …"). */
export const useTonoToast = () => use(TonoToastContext)
