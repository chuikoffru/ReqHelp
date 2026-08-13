import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch, ApiError } from '../lib/api'

export interface AuthUser {
  id: number
  login: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (login: string, password: string) => Promise<void>
  register: (login: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const me = await apiFetch<AuthUser>('/api/auth/me')
        if (!cancelled) setUser(me)
      } catch (err) {
        if (!cancelled) {
          if (!(err instanceof ApiError && err.status === 401)) {
            console.error(err)
          }
          setUser(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (loginValue: string, password: string) => {
    const me = await apiFetch<AuthUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: loginValue, password }),
    })
    setUser(me)
  }, [])

  const register = useCallback(async (loginValue: string, password: string) => {
    const me = await apiFetch<AuthUser>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ login: loginValue, password }),
    })
    setUser(me)
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
