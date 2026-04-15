import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

interface ToastContextValue {
  toastMsg: string | null
  showToast: (msg: string, ms?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((msg: string, ms = 2000) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToastMsg(msg)
    timerRef.current = setTimeout(() => setToastMsg(null), ms)
  }, [])

  return (
    <ToastContext.Provider value={{ toastMsg, showToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToastContext() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToastContext must be used within ToastProvider')
  return ctx
}
