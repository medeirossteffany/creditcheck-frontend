export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  socketUrl: import.meta.env.VITE_SOCKET_URL ?? 'ws://localhost:3000',
  mockApiUrl: import.meta.env.VITE_MOCK_API_URL ?? 'http://localhost:4000',
}
