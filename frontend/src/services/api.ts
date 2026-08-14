import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config/api';
import { ERP_DATA_MUTATED_EVENT } from '../config/realtime';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

/** Fired when refresh fails so AuthContext can drop in-memory user state immediately. */
export const SESSION_EXPIRED_EVENT = 'abexcore:session-expired';

let redirectingToLogin = false;
/** Blocks further API calls after logout / failed refresh (stops 401 spam). */
let sessionDead = false;

export function resetSessionGuards() {
  sessionDead = false;
  redirectingToLogin = false;
}

export function hasStoredAccessToken(): boolean {
  return !!localStorage.getItem('accessToken');
}

export function redirectToLogin(reason: 'session' | 'inactive' = 'session') {
  if (redirectingToLogin) return;
  const path = window.location.pathname;
  if (path === '/login' || path.endsWith('/login')) return;
  redirectingToLogin = true;
  sessionDead = true;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { reason } }));
  window.location.replace(`/login?reason=${reason}`);
}

function endSession(reason: 'session' | 'inactive' = 'session') {
  clearStoredSession();
  redirectToLogin(reason);
}

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const url = config.url || '';
  const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh');

  if (sessionDead && !isAuthEndpoint) {
    return Promise.reject(new AxiosError('Session expired', 'ERR_SESSION', config));
  }

  // Renew access token before the request when it is about to expire.
  if (!isAuthEndpoint && localStorage.getItem('refreshToken')) {
    const access = localStorage.getItem('accessToken');
    if (!access || isAccessTokenExpired(access)) {
      const refreshed = await refreshAccessToken();
      if (!refreshed && !localStorage.getItem('accessToken')) {
        endSession('session');
        return Promise.reject(new AxiosError('Session expired', 'ERR_SESSION', config));
      }
    }
  }

  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const method = response.config.method?.toUpperCase();
    if (method && MUTATION_METHODS.has(method)) {
      window.dispatchEvent(new CustomEvent(ERP_DATA_MUTATED_EVENT));
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const url = originalRequest?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh');

    // Never hammer login/refresh when rate-limited.
    if (error.response?.status === 429) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true;
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        originalRequest.headers.Authorization = `Bearer ${localStorage.getItem('accessToken')}`;
        return api(originalRequest);
      }
      endSession('session');
    }
    return Promise.reject(error);
  }
);

export default api;

/** Only one refresh in flight — concurrent callers share the same promise. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refresh tokens using the stored refresh token.
 * Safe under concurrent calls (page reload + API 401 retry) so a losing race
 * does not wipe a token that another call just rotated successfully.
 */
export async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    try {
      const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
      localStorage.setItem('accessToken', data.data.accessToken);
      localStorage.setItem('refreshToken', data.data.refreshToken);
      return true;
    } catch {
      // Another concurrent refresh may have already rotated tokens — keep those.
      const stillSame = localStorage.getItem('refreshToken') === refreshToken;
      if (stillSame) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
      }
      return !stillSame && !!localStorage.getItem('accessToken');
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export function isAccessTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
    if (!payload.exp) return false;
    return payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

export function clearStoredSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

/** Access token missing, malformed, or past exp (with skew buffer). */
export function accessTokenNeedsRefresh(token: string | null = localStorage.getItem('accessToken')): boolean {
  if (!token) return true;
  return isAccessTokenExpired(token);
}

export const authApi = {
  login: (companySlug: string, email: string, password: string, totpCode?: string) =>
    api.post('/auth/login', { companySlug, email, password, totpCode }),
  resolveTenant: (slug: string) => api.get(`/auth/resolve-tenant/${encodeURIComponent(slug)}`),
  logout: (refreshToken?: string) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return api.post('/auth/avatar', formData);
  },
  setup2FA: () => api.post('/auth/2fa/setup'),
  verify2FA: (token: string) => api.post('/auth/2fa/verify', { token }),
};

export const dashboardApi = {
  getKPIs: () => api.get('/dashboard/kpis'),
  getCharts: (days = 30) => api.get('/dashboard/charts', { params: { days } }),
};

export const usersApi = {
  list: (params?: object) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: object) => api.post('/users', data),
  update: (id: string, data: object) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  stats: () => api.get('/users/stats'),
  roles: () => api.get('/users/roles'),
  departments: () => api.get('/users/departments'),
  branches: () => api.get('/users/branches'),
  linkableEmployees: () => api.get('/users/linkable-employees'),
  auditLogs: (params?: object) => api.get('/users/audit-logs', { params }),
};

export const customersApi = {
  list: (params?: object) => api.get('/customers', { params }),
  get: (id: string) => api.get(`/customers/${id}`),
  create: (data: object) => api.post('/customers', data),
  update: (id: string, data: object) => api.put(`/customers/${id}`, data),
  delete: (id: string) => api.delete(`/customers/${id}`),
  activate: (id: string) => api.post(`/customers/${id}/activate`),
  orders: (id: string) => api.get(`/customers/${id}/orders`),
  statement: (id: string, params?: object) => api.get(`/customers/${id}/statement`, { params }),
  vatReport: (vatStatus: 'VAT' | 'NON_VAT' | 'ALL' = 'ALL') =>
    api.get('/customers/reports/vat-status', { params: { vatStatus } }),
  addContact: (customerId: string, data: object) => api.post(`/customers/${customerId}/contacts`, data),
  deleteContact: (customerId: string, contactId: string) =>
    api.delete(`/customers/${customerId}/contacts/${contactId}`),
  importTemplatePath: '/customers/import/template',
  importExcel: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/customers/import', form);
  },
};

export const crmApi = {
  stats: () => api.get('/crm/stats'),
  complaints: (params?: object) => api.get('/crm/complaints', { params }),
  getComplaint: (id: string) => api.get(`/crm/complaints/${id}`),
  createComplaint: (data: object) => api.post('/crm/complaints', data),
  resolveComplaint: (id: string, data: object) => api.patch(`/crm/complaints/${id}/resolve`, data),
  opportunities: (params?: object) => api.get('/crm/opportunities', { params }),
  getOpportunity: (id: string) => api.get(`/crm/opportunities/${id}`),
  createOpportunity: (data: object) => api.post('/crm/opportunities', data),
  updateOpportunity: (id: string, data: object) => api.put(`/crm/opportunities/${id}`, data),
  advanceOpportunity: (id: string) => api.patch(`/crm/opportunities/${id}/advance`),
  warranties: (params?: object) => api.get('/crm/warranties', { params }),
  createWarranty: (data: object) => api.post('/crm/warranties', data),
};

export const productsApi = {
  stats: () => api.get('/products/stats'),
  list: (params?: object) => api.get('/products', { params }),
  available: (params?: object) => api.get('/products/available', { params }),
  get: (id: string) => api.get(`/products/${id}`),
  create: (data: object) => api.post('/products', data),
  update: (id: string, data: object) => api.put(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  categories: () => api.get('/products/categories/list'),
  manageCategories: () => api.get('/products/categories/manage'),
  createCategory: (data: { name: string }) => api.post('/products/categories', data),
  updateCategory: (id: string, data: { name?: string; isActive?: boolean }) =>
    api.patch(`/products/categories/${id}`, data),
  deactivateCategory: (id: string) => api.delete(`/products/categories/${id}`),
  reorderCategories: (ids: string[]) => api.put('/products/categories/reorder', { ids }),
  stockWarehouses: () => api.get('/products/warehouses/stock'),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api.post(`/products/${id}/image`, form);
  },
  importTemplatePath: '/products/import/template',
  importExcel: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/products/import', form);
  },
};

export const inventoryApi = {
  stats: () => api.get('/inventory/stats'),
  procurementStats: () => api.get('/inventory/procurement-stats'),
  transactions: (params?: object) => api.get('/inventory/transactions', { params }),
  materials: (params?: object) => api.get('/inventory/materials', { params }),
  lowStock: () => api.get('/inventory/materials/low-stock'),
  materialTypes: () => api.get('/inventory/materials/types/list'),
  manageMaterialTypes: () => api.get('/inventory/materials/types/manage'),
  createMaterialType: (data: { name: string }) => api.post('/inventory/materials/types', data),
  updateMaterialType: (id: string, data: { name?: string; isActive?: boolean }) =>
    api.patch(`/inventory/materials/types/${id}`, data),
  reorderMaterialTypes: (ids: string[]) => api.put('/inventory/materials/types/reorder', { ids }),
  createMaterial: (data: object) => api.post('/inventory/materials', data),
  updateMaterial: (id: string, data: object) => api.put(`/inventory/materials/${id}`, data),
  deleteMaterial: (id: string) => api.delete(`/inventory/materials/${id}`),
  suppliers: (params?: object) => api.get('/inventory/suppliers', { params }),
  createSupplier: (data: object) => api.post('/inventory/suppliers', data),
  updateSupplier: (id: string, data: object) => api.put(`/inventory/suppliers/${id}`, data),
  deleteSupplier: (id: string) => api.delete(`/inventory/suppliers/${id}`),
  vendorStatement: (id: string, params?: object) =>
    api.get(`/inventory/suppliers/${id}/statement`, { params }),
  warehouses: () => api.get('/inventory/warehouses'),
  stockLevels: (params?: object) => api.get('/inventory/stock-levels', { params }),
  adjustStock: (data: object) => api.post('/inventory/adjust', data),
  cycleCount: (data: object) => api.post('/inventory/cycle-counts', data),
  transfers: () => api.get('/inventory/transfers'),
  transferStock: (data: object) => api.post('/inventory/transfers', data),
  purchaseOrders: (params?: object) => api.get('/inventory/purchase-orders', { params }),
  createPurchaseOrder: (data: object) => api.post('/inventory/purchase-orders', data),
  purchaseOrderPdfPath: (id: string) => `/inventory/purchase-orders/${id}/pdf`,
  sendPurchaseOrder: (id: string) => api.post(`/inventory/purchase-orders/${id}/send`),
  requisitions: (params?: object) => api.get('/inventory/requisitions', { params }),
  createRequisition: (data: object) => api.post('/inventory/requisitions', data),
  approveRequisition: (id: string, status?: string) =>
    api.patch(`/inventory/requisitions/${id}/approve`, { status }),
  goodsReceipts: (params?: object) => api.get('/inventory/goods-receipts', { params }),
  createGoodsReceipt: (data: object) => api.post('/inventory/goods-receipts', data),
  postGoodsReceiptToStock: (id: string) => api.post(`/inventory/goods-receipts/${id}/post-to-stock`),
  rfqs: (params?: object) => api.get('/inventory/rfqs', { params }),
  createRfq: (requisitionId: string, data: object) =>
    api.post(`/inventory/requisitions/${requisitionId}/rfq`, data),
  awardRfq: (id: string, quotationId: string) =>
    api.patch(`/inventory/rfqs/${id}/award`, { quotationId }),
  updateQuotation: (id: string, data: object) =>
    api.patch(`/inventory/quotations/${id}`, data),
  importMaterialsTemplatePath: '/inventory/materials/import/template',
  importMaterialsExcel: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/inventory/materials/import', form);
  },
  importSuppliersTemplatePath: '/inventory/suppliers/import/template',
  importSuppliersExcel: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/inventory/suppliers/import', form);
  },
};

export const searchApi = {
  search: (q: string) => api.get('/search', { params: { q } }),
};

export const operationsApi = {
  stats: () => api.get('/operations/stats'),
  productionStats: () => api.get('/operations/production-stats'),
  salesOfficers: () => api.get('/operations/sales-officers'),
  salesOrders: (params?: object) => api.get('/operations/orders', { params }),
  getSalesOrder: (id: string) => api.get(`/operations/orders/${id}`),
  createSalesOrder: (data: object) => api.post('/operations/orders', data),
  updateOrderStatus: (id: string, status: string) =>
    api.patch(`/operations/orders/${id}/status`, { status }),
  updateOrderItems: (id: string, data: object) => api.patch(`/operations/orders/${id}/items`, data),
  generateProductionFromOrder: (orderId: string) =>
    api.post(`/operations/orders/${orderId}/generate-production`),
  quotations: (params?: object) => api.get('/operations/quotations', { params }),
  getQuotation: (id: string) => api.get(`/operations/quotations/${id}`),
  createQuotation: (data: object) => api.post('/operations/quotations', data),
  convertQuotation: (id: string) => api.post(`/operations/quotations/${id}/convert`),
  production: (params?: object) => api.get('/operations/production', { params }),
  createProduction: (data: object) => api.post('/operations/production', data),
  startProduction: (id: string) => api.post(`/operations/production/${id}/start`),
  completeProduction: (id: string, data: object) =>
    api.post(`/operations/production/${id}/complete`, data),
  machines: () => api.get('/operations/machines'),
};

export const deliveryApi = {
  stats: () => api.get('/delivery/stats'),
  list: (params?: object) => api.get('/delivery', { params }),
  trips: (params?: object) => api.get('/delivery/trips', { params }),
  getTrip: (id: string) => api.get(`/delivery/trips/${id}`),
  get: (id: string) => api.get(`/delivery/${id}`),
  readyOrders: (params?: object) => api.get('/delivery/ready-orders', { params }),
  create: (data: object) => api.post('/delivery', data),
  updateStatus: (id: string, data: object) => api.patch(`/delivery/${id}/status`, data),
  updateTripStatus: (id: string, data: object) => api.patch(`/delivery/trips/${id}/status`, data),
  drivers: () => api.get('/delivery/drivers/list'),
  vehicles: (params?: object) => api.get('/delivery/vehicles', { params }),
  createVehicle: (data: object) => api.post('/delivery/vehicles', data),
  pdfPath: (id: string) => `/delivery/${id}/pdf`,
};

export const hrApi = {
  stats: () => api.get('/hr/stats'),
  employees: (params?: object) => api.get('/hr/employees', { params }),
  getEmployee: (id: string) => api.get(`/hr/employees/${id}`),
  createEmployee: (data: object) => api.post('/hr/employees', data),
  updateEmployee: (id: string, data: object) => api.put(`/hr/employees/${id}`, data),
  deleteEmployee: (id: string) => api.delete(`/hr/employees/${id}`),
  linkableUsers: () => api.get('/hr/linkable-users'),
  linkEmployeeUser: (id: string, userId: string | null) =>
    api.patch(`/hr/employees/${id}/link-user`, { userId }),
  attendance: (params?: object) => api.get('/hr/attendance', { params }),
  recordAttendance: (data: object) => api.post('/hr/attendance', data),
  leave: (params?: object) => api.get('/hr/leave', { params }),
  myLeave: (params?: object) => api.get('/hr/leave/mine', { params }),
  myLeaveBalances: (params?: object) => api.get('/hr/leave/balances/me', { params }),
  leaveBalances: (params?: object) => api.get('/hr/leave/balances', { params }),
  updateLeaveBalance: (data: object) => api.put('/hr/leave/balances', data),
  onLeave: (params?: object) => api.get('/hr/leave/on-leave', { params }),
  leaveReportExcelPath: (year?: number) =>
    `/hr/leave/report/excel${year ? `?year=${year}` : ''}`,
  leaveReportPdfPath: (year?: number) =>
    `/hr/leave/report/pdf${year ? `?year=${year}` : ''}`,
  requestMyLeave: (data: object) => api.post('/hr/leave/me', data),
  createLeave: (data: object) => api.post('/hr/leave', data),
  approveLeave: (id: string, status: string, decisionNote?: string) =>
    api.patch(`/hr/leave/${id}/approve`, { status, decisionNote }),
  payroll: (params?: object) => api.get('/hr/payroll', { params }),
  createPayroll: (data: object) => api.post('/hr/payroll', data),
  calculatePayroll: (data: object) => api.post('/hr/payroll/calculate', data),
  payPayroll: (id: string) => api.patch(`/hr/payroll/${id}/pay`),
  advanceStats: () => api.get('/hr/advances/stats'),
  advances: (params?: object) => api.get('/hr/advances', { params }),
  getAdvance: (id: string) => api.get(`/hr/advances/${id}`),
  createAdvance: (data: object) => api.post('/hr/advances', data),
  updateAdvance: (id: string, data: object) => api.patch(`/hr/advances/${id}`, data),
  approveAdvance: (id: string, data?: object) => api.patch(`/hr/advances/${id}/approve`, data || {}),
  rejectAdvance: (id: string, data?: object) => api.patch(`/hr/advances/${id}/reject`, data || {}),
  disburseAdvance: (id: string, data?: object) => api.patch(`/hr/advances/${id}/disburse`, data || {}),
  repayAdvance: (id: string, data: object) => api.post(`/hr/advances/${id}/repay`, data),
  cancelAdvance: (id: string, data?: object) => api.patch(`/hr/advances/${id}/cancel`, data || {}),
  writeOffAdvance: (id: string, data?: object) => api.patch(`/hr/advances/${id}/write-off`, data || {}),
  importEmployeesTemplatePath: '/hr/employees/import/template',
  importEmployeesExcel: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/hr/employees/import', form);
  },
};

export const maintenanceApi = {
  stats: () => api.get('/maintenance/stats'),
  machines: (params?: object) => api.get('/maintenance/machines', { params }),
  createMachine: (data: object) => api.post('/maintenance/machines', data),
  requests: (params?: object) => api.get('/maintenance/requests', { params }),
  getRequest: (id: string) => api.get(`/maintenance/requests/${id}`),
  createRequest: (data: object) => api.post('/maintenance/requests', data),
  completeRequest: (id: string, data: object) =>
    api.patch(`/maintenance/requests/${id}/complete`, data),
};

export const financeApi = {
  stats: () => api.get('/finance/stats'),
  overview: (days = 30) => api.get('/finance/overview', { params: { days } }),
  config: () => api.get('/finance/config'),
  company: () => api.get('/finance/company'),
  updateCompany: (data: object) => api.put('/finance/company', data),
  invoices: (params?: object) => api.get('/finance/invoices', { params }),
  getInvoice: (id: string) => api.get(`/finance/invoices/${id}`),
  createInvoice: (data: object) => api.post('/finance/invoices', data),
  createInvoiceFromOrder: (orderId: string) => api.post(`/finance/invoices/from-order/${orderId}`),
  createPurchaseInvoiceFromGrn: (grnId: string) => api.post(`/finance/invoices/from-grn/${grnId}`),
  listPayments: (params?: object) => api.get('/finance/payments', { params }),
  payments: (data: object) => api.post('/finance/payments', data),
  accounts: () => api.get('/finance/accounts'),
  journalEntries: (params?: object) => api.get('/finance/journal-entries', { params }),
  createJournalEntry: (data: object) => api.post('/finance/journal-entries', data),
  notifications: () => api.get('/finance/notifications'),
  markNotificationRead: (id: string) => api.patch(`/finance/notifications/${id}/read`),
  markAllNotificationsRead: () => api.patch('/finance/notifications/read-all'),
  paymentsExcelPath: () => '/finance/payments/excel',
  reportsSummary: () => api.get('/finance/reports/summary'),
  profitLoss: (params?: object) => api.get('/finance/reports/profit-loss', { params }),
  balanceSheet: (params?: object) => api.get('/finance/reports/balance-sheet', { params }),
  cashFlow: (params?: object) => api.get('/finance/reports/cash-flow', { params }),
  vatReport: (params?: object) => api.get('/finance/reports/vat', { params }),
  bankReconciliation: () => api.get('/finance/bank-reconciliation'),
  importBankStatement: (data: object) => api.post('/finance/bank-statements/import', data),
  autoMatchBankStatement: (statementId: string) =>
    api.post(`/finance/bank-reconciliation/auto-match/${statementId}`),
  reconcilePayment: (id: string, bankReference?: string) =>
    api.patch(`/finance/payments/${id}/reconcile`, { bankReference }),
  submitEtims: (invoiceId: string) => api.post(`/finance/invoices/${invoiceId}/submit-etims`),
  vatItaxExport: (params?: object) => api.get('/finance/reports/vat-itax-export', { params }),
  mySales: (params?: object) => api.get('/finance/my-sales', { params }),
  salesPerformance: (params?: object) => api.get('/finance/sales-performance', { params }),
  salesTargets: (params?: object) => api.get('/finance/sales-targets', { params }),
  upsertSalesTarget: (data: object) => api.put('/finance/sales-targets', data),
  mpesaStatus: () => api.get('/finance/mpesa/status'),
  mpesaStkPush: (data: object) => api.post('/finance/mpesa/stk-push', data),
};

export const reportsApi = {
  summary: () => api.get('/finance/reports/summary'),
  profitLoss: (params?: object) => api.get('/finance/reports/profit-loss', { params }),
  balanceSheet: (params?: object) => api.get('/finance/reports/balance-sheet', { params }),
  cashFlow: (params?: object) => api.get('/finance/reports/cash-flow', { params }),
  vatReport: (params?: object) => api.get('/finance/reports/vat', { params }),
  salesOfficers: () => api.get('/finance/reports/sales-by-person/sales-officers'),
  salesByPerson: (params?: object) => api.get('/finance/reports/sales-by-person', { params }),
  productsSold: (params?: object) => api.get('/finance/reports/products-sold', { params }),
};

export const settingsApi = {
  company: () => api.get('/finance/company'),
  updateCompany: (data: object) => api.put('/finance/company', data),
};

export const trashApi = {
  list: (params?: object) => api.get('/trash', { params }),
  restore: (resource: string, id: string) => api.post(`/trash/${resource}/${id}/restore`),
  purge: (resource: string, id: string) => api.delete(`/trash/${resource}/${id}`),
};

export const tenantApi = {
  workspace: () => api.get('/tenant/workspace'),
  updateWorkspace: (data: object) => api.patch('/tenant/workspace', data),
  resetDemoWorkspace: (confirmSlug: string) =>
    api.post('/tenant/workspace/reset-demo', { confirmSlug }),
  seedDemoData: () => api.post('/tenant/workspace/seed-demo'),
  team: () => api.get('/tenant/team'),
  inviteUser: (data: object) => api.post('/tenant/invite-user', data),
  listCompanies: () => api.get('/tenant/companies'),
  updateCompanyStatus: (id: string, isActive: boolean) =>
    api.patch(`/tenant/companies/${id}/status`, { isActive }),
  deleteCompany: (id: string, confirmSlug: string) =>
    api.delete(`/tenant/companies/${id}`, { data: { confirmSlug } }),
  registerCompany: (formData: FormData) => api.post('/tenant/companies', formData),
  uploadLogo: (formData: FormData) => api.post('/tenant/logo', formData),
  emailConfig: () => api.get('/tenant/email-config'),
  updateEmailConfig: (data: object) => api.put('/tenant/email-config', data),
  testEmailConfig: (to?: string) => api.post('/tenant/email-config/test', to ? { to } : {}),
};

export const systemApi = {
  metrics: () => api.get('/system/metrics'),
};

export const qualityApi = {
  stats: () => api.get('/quality/stats'),
  list: (params?: object) => api.get('/quality', { params }),
  get: (id: string) => api.get(`/quality/${id}`),
  create: (data: object) => api.post('/quality', data),
  update: (id: string, data: object) => api.patch(`/quality/${id}`, data),
};
