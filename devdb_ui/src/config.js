// API base URL — uses Vite proxy (/api → http://localhost:8765) in dev.
// Override with VITE_API_BASE env var if needed.
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'
