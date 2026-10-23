export type UserRole = 'ADMIN' | 'USER'

export type CustomerStatus =
  | 'NOT_CONSULTED'
  | 'PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'IN_PROGRESS'

export interface User {
  id: number
  name: string
  email: string
  role: UserRole
  created_at: string
}

export interface LoginResponse {
  token: string
  user: User
}

export interface CustomerItem {
  id: number
  name: string
  cpf: string
  created_at: string
  status: CustomerStatus
  last_transaction_id: number | null
  last_consulted_at: string | null
}

export interface CustomerListResponse {
  items: CustomerItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface ConsultationResult {
  protocol?: string
  provider?: string
  name?: string
  cpf?: string
  score?: number
  risk?: string
  hasRestrictions?: boolean
  restrictions?: Array<{
    type: string
    amount?: number
    origin?: string
    date?: string
  }>
  consultedAt?: string
  [key: string]: unknown
}

export interface ConsultationRecord {
  id: number
  transaction_id?: number
  result?: ConsultationResult
  completed_at?: string
  expires_at?: string
}

export interface Transaction {
  id: number
  customer_id: number
  user_id: number
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  error_message: string | null
  created_at: string
  completed_at: string | null
  consultation?: ConsultationRecord | null
  user_name?: string
}

export interface CustomerDetails {
  id: number
  name: string
  cpf: string
  created_at: string
  status: CustomerStatus
  validConsultation: ConsultationRecord | null
  transactions: Array<{
    id: number
    status: 'PENDING' | 'COMPLETED' | 'FAILED'
    error_message: string | null
    created_at: string
    completed_at: string | null
    user_id: number
    user_name: string
  }>
}

export interface ConsultationRequestResponse {
  status: 'PENDING' | 'COMPLETED'
  cached: boolean
  transactionId: number
  alreadyInProgress?: boolean
  consultation?: ConsultationRecord
}
