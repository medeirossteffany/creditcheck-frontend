import { env } from '../config/env'

const normalizeBody = (body: BodyInit | undefined, headers: Headers) => {
  if (typeof body === 'undefined' || body === null) {
    return
  }

  if (body instanceof FormData) {
    return body
  }

  headers.set('Content-Type', 'application/json')
  return body
}

export const buildQueryString = (params: Record<string, string | number | null | undefined>) => {
  const query = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value))
    }
  })

  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

export const apiRequest = async <T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> => {
  const url = endpoint.startsWith('http') ? endpoint : `${env.apiBaseUrl}${endpoint}`
  const headers = new Headers(options.headers ?? {})

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const body = normalizeBody(options.body as BodyInit | undefined, headers)

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  })

  const rawText = await response.text()
  const payload = rawText ? JSON.parse(rawText) : null

  if (!response.ok) {
    const message = payload?.error ?? 'Erro inesperado ao tentar acessar a API.'
    throw new Error(message)
  }

  return payload as T
}
