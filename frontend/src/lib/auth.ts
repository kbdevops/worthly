// Central place for auth token storage and the login/register/logout calls.
// Deliberately framework-light (no context provider needed) — components read
// isAuthed()/getToken() directly, and useAuth() below gives a reactive hook
// for components that need to re-render on login/logout.

import { useState, useEffect, useCallback } from 'react'

const TOKEN_KEY = 'worthly_token'
const USER_KEY = 'worthly_user'

export interface AuthUser {
  id: number
  email: string
}

// "Keep me signed in" checked -> localStorage (survives closing the browser).
// Unchecked -> sessionStorage (cleared as soon as the tab/browser closes).
// Reads check both, since we don't know which one was used at login time.
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY) ?? sessionStorage.getItem(USER_KEY)
  return raw ? JSON.parse(raw) : null
}

export function isAuthed(): boolean {
  return !!getToken()
}

function setSession(token: string, user: AuthUser, remember: boolean) {
  const store = remember ? localStorage : sessionStorage
  const other = remember ? sessionStorage : localStorage
  store.setItem(TOKEN_KEY, token)
  store.setItem(USER_KEY, JSON.stringify(user))
  other.removeItem(TOKEN_KEY) // clear any stale copy in the other storage from a previous login
  other.removeItem(USER_KEY)
  window.dispatchEvent(new Event('worthly-auth-change'))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  window.dispatchEvent(new Event('worthly-auth-change'))
}

async function authRequest(path: string, email: string, password: string, remember: boolean) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Something went wrong')
  }
  setSession(data.token, data.user, remember)
  return data.user as AuthUser
}

export const login = (email: string, password: string, remember = true) => authRequest('/api/login', email, password, remember)
export const register = (email: string, password: string, remember = true) => authRequest('/api/register', email, password, remember)

export function logout() {
  clearSession()
}

/** Reactive hook — re-renders when login/logout happens anywhere in the app. */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser())

  const sync = useCallback(() => setUser(getStoredUser()), [])

  useEffect(() => {
    window.addEventListener('worthly-auth-change', sync)
    window.addEventListener('storage', sync) // cross-tab logout
    return () => {
      window.removeEventListener('worthly-auth-change', sync)
      window.removeEventListener('storage', sync)
    }
  }, [sync])

  return { user, isAuthed: !!user }
}