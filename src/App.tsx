import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './App.css'
import { env } from './config/env'
import { apiRequest, buildQueryString } from './services/api'
import type {
  ConsultationRequestResponse,
  CustomerDetails,
  CustomerItem,
  CustomerListResponse,
  LoginResponse,
  Transaction,
  User,
} from './types'

const storageKeys = {
  token: 'creditcheck_token',
  user: 'creditcheck_user',
}

const statusVariant: Record<string, string> = {
  NOT_CONSULTED: 'secondary',
  PENDING: 'warning',
  COMPLETED: 'success',
  FAILED: 'danger',
  IN_PROGRESS: 'info',
}

const formatDate = (value?: string | null) => {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

const normalizeCpf = (value: string) => value.replace(/\D/g, '')

function App() {
  const [token, setToken] = useState<string>(() => localStorage.getItem(storageKeys.token) ?? '')
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(storageKeys.user)
    return raw ? (JSON.parse(raw) as User) : null
  })
  const [loginForm, setLoginForm] = useState({ email: 'admin@creditcheck.local', password: 'Admin@12345' })
  const [loginError, setLoginError] = useState('')
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false)
  const [customers, setCustomers] = useState<CustomerItem[]>([])
  const [customerPage, setCustomerPage] = useState(1)
  const [customerPageSize] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [customerTotal, setCustomerTotal] = useState(0)
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false)
  const [filters, setFilters] = useState({ name: '', cpf: '', status: '' })
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetails | null>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', cpf: '' })
  const [registerError, setRegisterError] = useState('')
  const [isSendingRegister, setIsSendingRegister] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const socketRef = useRef<Socket | null>(null)

  const fetchCustomers = async (page = customerPage) => {
    if (!token) return

    setIsLoadingCustomers(true)

    try {
      const query = buildQueryString({
        name: filters.name,
        cpf: normalizeCpf(filters.cpf),
        status: filters.status,
        page,
        pageSize: customerPageSize,
      })

      const response = await apiRequest<CustomerListResponse>(`/customers${query}`, {}, token)
      setCustomers(response.items)
      setCustomerPage(response.page)
      setTotalPages(response.totalPages)
      setCustomerTotal(response.total)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível carregar os clientes.'
      setToast(message)
    } finally {
      setIsLoadingCustomers(false)
    }
  }

  const fetchCustomer = async (customerId: number) => {
    if (!token) return

    const response = await apiRequest<CustomerDetails>(`/customers/${customerId}`, {}, token)
    setSelectedCustomer(response)
    setShowCustomerModal(true)
  }

  const pollTransaction = async (transactionId: number, customerId: number) => {
    if (!token) return

    for (let i = 0; i < 25; i += 1) {
      try {
        const transaction = await apiRequest<Transaction>(`/transactions/${transactionId}`, {}, token)

        if (transaction.status !== 'PENDING') {
          await fetchCustomers()
          await fetchCustomer(customerId)
          const summary = transaction.status === 'COMPLETED' ? 'Consulta concluída com sucesso.' : `Consulta falhou: ${transaction.error_message ?? 'erro desconhecido'}`
          setToast(summary)
          return
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro ao consultar o status da transação.'
        setToast(message)
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 1500))
    }

    await fetchCustomers()
    await fetchCustomer(customerId)
    setToast('Consulta em andamento. Atualize a página em alguns segundos.')
  }

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError('')
    setIsSubmittingLogin(true)

    try {
      const response = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: loginForm.email,
          password: loginForm.password,
        }),
      })

      setToken(response.token)
      setUser(response.user)
      localStorage.setItem(storageKeys.token, response.token)
      localStorage.setItem(storageKeys.user, JSON.stringify(response.user))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível fazer login.'
      setLoginError(message)
    } finally {
      setIsSubmittingLogin(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(storageKeys.token)
    localStorage.removeItem(storageKeys.user)
    setToken('')
    setUser(null)
    setCustomers([])
    setSelectedCustomer(null)
    setShowCustomerModal(false)
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
  }

  const handleRegisterCustomer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRegisterError('')
    setIsSendingRegister(true)

    try {
      await apiRequest('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: newCustomer.name.trim(),
          cpf: normalizeCpf(newCustomer.cpf),
        }),
      }, token)

      setShowRegisterModal(false)
      setNewCustomer({ name: '', cpf: '' })
      await fetchCustomers(1)
      setToast('Cliente cadastrado com sucesso.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível cadastrar o cliente.'
      setRegisterError(message)
    } finally {
      setIsSendingRegister(false)
    }
  }

  const handleConsultCustomer = async (customerId: number) => {
    if (!token) return

    try {
      const response = await apiRequest<ConsultationRequestResponse>(`/customers/${customerId}/consultations`, {
        method: 'POST',
      }, token)

      if (response.status === 'COMPLETED') {
        await fetchCustomer(customerId)
        setToast('Consulta já disponível para esse cliente.')
        return
      }

      await pollTransaction(response.transactionId, customerId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível consultar o cliente.'
      setToast(message)
    }
  }

  const handleApplyFilters = async () => {
    setCustomerPage(1)
    await fetchCustomers(1)
  }

  useEffect(() => {
    if (!token) {
      setIsCheckingSession(false)
      return
    }

    const validateSession = async () => {
      try {
        const currentUser = await apiRequest<User>('/auth/me', {}, token)
        setUser(currentUser)
        localStorage.setItem(storageKeys.user, JSON.stringify(currentUser))
      } catch {
        handleLogout()
      } finally {
        setIsCheckingSession(false)
      }
    }

    validateSession()
  }, [token])

  useEffect(() => {
    if (!token) return

    const socket = io(env.socketUrl, {
      transports: ['websocket'],
      auth: { token },
    })

    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('subscribe', { room: 'consultations' })
    })

    socket.on('consultation:updated', async (payload: { customerId?: number; transactionId?: number; status?: string; error?: string; completedAt?: string }) => {
      setToast(
        payload.status === 'FAILED'
          ? `Consulta falhou: ${payload.error ?? 'erro desconhecido'}`
          : 'Consulta atualizada em tempo real.',
      )

      await fetchCustomers()

      if (payload.customerId) {
        await fetchCustomer(payload.customerId)
      }
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [token])

  useEffect(() => {
    if (!token) return

    fetchCustomers(customerPage)
  }, [token])

  useEffect(() => {
    if (!toast) return

    const timeout = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timeout)
  }, [toast])

  const customerRows = useMemo(
    () =>
      customers.map((item) => ({
        ...item,
        statusLabel: item.status.replace('_', ' '),
      })),
    [customers],
  )

  if (!token && !isCheckingSession) {
    return (
      <div className="auth-shell">
        <div className="container auth-container">
          <div className="row justify-content-center align-items-center min-vh-100">
            <div className="col-lg-4 col-md-6 col-sm-8">
              <div className="card shadow border-0 auth-card">
                <div className="card-body p-4 p-lg-5">
                  <div className="text-center mb-4">
                    <h1 className="h3 mb-1 mt-3 fw-bold">CreditCheck</h1>
                    <p className="text-muted mb-0">Acesso administrativo</p>
                  </div>

                  <form onSubmit={handleLogin}>
                    <div className="mb-3">
                      <label className="form-label">E-mail</label>
                      <input
                        className="form-control"
                        type="email"
                        value={loginForm.email}
                        onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                        placeholder="admin@creditcheck.local"
                        required
                      />
                    </div>

                    <div className="mb-3">
                      <label className="form-label">Senha</label>
                      <input
                        className="form-control"
                        type="password"
                        value={loginForm.password}
                        onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                        placeholder="••••••••"
                        required
                      />
                    </div>

                    {loginError ? <div className="alert alert-danger py-2">{loginError}</div> : null}

                    <button type="submit" className="btn btn-primary w-100 mt-2" disabled={isSubmittingLogin}>
                      {isSubmittingLogin ? 'Entrando...' : 'Entrar'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (token && !user) {
    return (
      <div className="d-flex min-vh-100 align-items-center justify-content-center">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Carregando...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="app-shell">
        <nav className="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm">
          <div className="container-fluid px-4 py-2">
            <span className="navbar-brand fw-bold mb-0">CreditCheck</span>
            <div className="ms-auto d-flex align-items-center gap-3 text-white">
              <span className="small text-white-50">{user?.name}</span>
              <button type="button" className="btn btn-outline-light btn-sm" onClick={handleLogout}>
                Sair
              </button>
            </div>
          </div>
        </nav>

        <main className="container py-4">
          <div className="d-flex justify-content-between align-items-center mb-4">
            <div>
              <p className="text-uppercase text-secondary small mb-1 fw-semibold">Dashboard</p>
              <h2 className="mb-0">Clientes</h2>
            </div>
            <button type="button" className="btn btn-success" onClick={() => setShowRegisterModal(true)}>
              Cadastrar cliente
            </button>
          </div>

          <div className="card shadow-sm border-0 mb-4">
            <div className="card-body">
              <div className="row g-3 align-items-end">
                <div className="col-md-4">
                  <label className="form-label">Nome</label>
                  <input
                    className="form-control"
                    value={filters.name}
                    onChange={(event) => setFilters((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Buscar por nome"
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CPF</label>
                  <input
                    className="form-control"
                    value={filters.cpf}
                    onChange={(event) => setFilters((current) => ({ ...current, cpf: event.target.value }))}
                    placeholder="00000000000"
                  />
                </div>
                <div className="col-md-3">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={filters.status}
                    onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="">Todos</option>
                    <option value="NOT_CONSULTED">Não consultado</option>
                    <option value="PENDING">Pendente</option>
                    <option value="COMPLETED">Concluído</option>
                    <option value="FAILED">Falhou</option>
                  </select>
                </div>
                <div className="col-md-2 d-grid">
                  <button type="button" className="btn btn-primary" onClick={handleApplyFilters}>
                    Filtrar
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card shadow-sm border-0">
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table align-middle mb-0 table-hover">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>Nome</th>
                      <th>CPF</th>
                      <th>Status</th>
                      <th>Última consulta</th>
                      <th className="text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingCustomers ? (
                      <tr>
                        <td colSpan={6} className="text-center py-5">
                          <div className="spinner-border text-primary" role="status">
                            <span className="visually-hidden">Carregando</span>
                          </div>
                        </td>
                      </tr>
                    ) : customerRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-muted py-5">
                          Nenhum cliente encontrado.
                        </td>
                      </tr>
                    ) : (
                      customerRows.map((customer) => (
                        <tr key={customer.id} className="customer-row" onClick={() => fetchCustomer(customer.id)}>
                          <td>{customer.id}</td>
                          <td className="fw-semibold">{customer.name}</td>
                          <td>{customer.cpf}</td>
                          <td>
                            <span className={`badge text-bg-${statusVariant[customer.status] ?? 'secondary'}`}>
                              {customer.status}
                            </span>
                          </td>
                          <td>{formatDate(customer.last_consulted_at)}</td>
                          <td className="text-center">
                            <div className="d-flex justify-content-center gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleConsultCustomer(customer.id)
                                }}
                              >
                                Consultar CPF
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary action-menu"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void fetchCustomer(customer.id)
                                }}
                                aria-label={`Detalhes do cliente ${customer.name}`}
                              >
                                ⋯
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="d-flex justify-content-between align-items-center mt-3 text-muted small">
            <span>Mostrando {customerRows.length} de {customerTotal}</span>
            <div className="btn-group" role="group">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={customerPage <= 1}
                onClick={async () => {
                  const nextPage = Math.max(customerPage - 1, 1)
                  setCustomerPage(nextPage)
                  await fetchCustomers(nextPage)
                }}
              >
                Anterior
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={customerPage >= totalPages}
                onClick={async () => {
                  const nextPage = Math.min(customerPage + 1, totalPages)
                  setCustomerPage(nextPage)
                  await fetchCustomers(nextPage)
                }}
              >
                Próxima
              </button>
            </div>
          </div>
        </main>
      </div>

      {showRegisterModal ? (
        <div className="modal-backdrop fade show" />
      ) : null}

      {showRegisterModal ? (
        <div className="modal d-block" tabIndex={-1} role="dialog">
          <div className="modal-dialog modal-dialog-centered" role="document">
            <div className="modal-content">
              <form onSubmit={handleRegisterCustomer}>
                <div className="modal-header">
                  <h5 className="modal-title">Cadastrar cliente</h5>
                  <button type="button" className="btn-close" onClick={() => setShowRegisterModal(false)} aria-label="Fechar" />
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">Nome</label>
                    <input
                      className="form-control"
                      value={newCustomer.name}
                      onChange={(event) => setNewCustomer((current) => ({ ...current, name: event.target.value }))}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">CPF</label>
                    <input
                      className="form-control"
                      value={newCustomer.cpf}
                      onChange={(event) => setNewCustomer((current) => ({ ...current, cpf: event.target.value }))}
                      maxLength={14}
                      placeholder="529.982.247-25"
                      required
                    />
                  </div>

                  {registerError ? <div className="alert alert-danger py-2 mb-0">{registerError}</div> : null}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowRegisterModal(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={isSendingRegister}>
                    {isSendingRegister ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {showCustomerModal && selectedCustomer ? (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1} role="dialog">
            <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <div>
                    <h5 className="modal-title">{selectedCustomer.name}</h5>
                    <span className="text-muted small">#{selectedCustomer.id} • CPF {selectedCustomer.cpf}</span>
                  </div>
                  <button type="button" className="btn-close" onClick={() => setShowCustomerModal(false)} aria-label="Fechar" />
                </div>

                <div className="modal-body">
                  <div className="row g-4">
                    <div className="col-lg-5">
                      <div className="card border-0 bg-light-subtle h-100">
                        <div className="card-body">
                          <div className="d-flex justify-content-between align-items-center mb-3">
                            <h6 className="mb-0 fw-bold">Dados do cliente</h6>
                            <span className={`badge text-bg-${statusVariant[selectedCustomer.status] ?? 'secondary'}`}>
                              {selectedCustomer.status}
                            </span>
                          </div>

                          <dl className="row mb-0">
                            <dt className="col-sm-5">Nome</dt>
                            <dd className="col-sm-7">{selectedCustomer.name}</dd>

                            <dt className="col-sm-5">CPF</dt>
                            <dd className="col-sm-7">{selectedCustomer.cpf}</dd>

                            <dt className="col-sm-5">Cadastro</dt>
                            <dd className="col-sm-7">{formatDate(selectedCustomer.created_at)}</dd>

                            <dt className="col-sm-5">Última consulta</dt>
                            <dd className="col-sm-7">{formatDate(selectedCustomer.validConsultation?.completed_at ?? selectedCustomer.validConsultation?.expires_at)}</dd>
                          </dl>

                          <button
                            type="button"
                            className="btn btn-primary w-100 mt-4"
                            onClick={() => void handleConsultCustomer(selectedCustomer.id)}
                          >
                            Consultar CPF
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="col-lg-7">
                      <div className="card border-0 bg-light-subtle h-100">
                        <div className="card-body">
                          <h6 className="fw-bold mb-3">Consulta válida</h6>

                          {selectedCustomer.validConsultation?.result ? (
                            <div>
                              <div className="mb-2">
                                <strong>Provedor:</strong> {selectedCustomer.validConsultation.result.provider ?? 'N/A'}
                              </div>
                              <div className="mb-2">
                                <strong>Score:</strong> {selectedCustomer.validConsultation.result.score ?? '—'}
                              </div>
                              <div className="mb-2">
                                <strong>Risk:</strong> {selectedCustomer.validConsultation.result.risk ?? '—'}
                              </div>
                              <div className="mb-2">
                                <strong>Possui restrições:</strong>{' '}
                                {selectedCustomer.validConsultation.result.hasRestrictions ? 'Sim' : 'Não'}
                              </div>

                              {selectedCustomer.validConsultation.result.restrictions?.length ? (
                                <ul className="list-group list-group-flush mt-3">
                                  {selectedCustomer.validConsultation.result.restrictions.map((restriction, index) => (
                                    <li key={`${restriction.type}-${index}`} className="list-group-item bg-transparent px-0">
                                      <strong>{restriction.type}</strong>
                                      <div className="text-muted small">
                                        {restriction.origin ?? 'Origem não informada'} • {restriction.amount ? `R$ ${restriction.amount}` : '—'}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-muted mb-0">Nenhuma consulta válida na janela atual.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <h6 className="fw-bold mb-3">Histórico de transações</h6>
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Status</th>
                            <th>Usuário</th>
                            <th>Criada em</th>
                            <th>Concluída em</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCustomer.transactions.length ? (
                            selectedCustomer.transactions.map((transaction) => (
                              <tr key={transaction.id}>
                                <td>{transaction.id}</td>
                                <td>
                                  <span className={`badge text-bg-${statusVariant[transaction.status] ?? 'secondary'}`}>
                                    {transaction.status}
                                  </span>
                                </td>
                                <td>{transaction.user_name}</td>
                                <td>{formatDate(transaction.created_at)}</td>
                                <td>{formatDate(transaction.completed_at)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="text-center text-muted py-3">
                                Nenhuma transação registrada.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowCustomerModal(false)}>
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {toast ? (
        <div className="toast-container position-fixed bottom-0 end-0 p-3">
          <div className="toast show align-items-center text-bg-dark border-0" role="alert" aria-live="assertive" aria-atomic="true">
            <div className="d-flex">
              <div className="toast-body">{toast}</div>
              <button type="button" className="btn-close btn-close-white me-2 m-auto" onClick={() => setToast(null)} aria-label="Fechar" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default App
