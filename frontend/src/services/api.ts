import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
          localStorage.setItem('accessToken', data.data.accessToken);
          localStorage.setItem('refreshToken', data.data.refreshToken);
          originalRequest.headers.Authorization = `Bearer ${data.data.accessToken}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          window.location.href = '/login';
        }
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

export const authApi = {
  login: (email: string, password: string, totpCode?: string) =>
    api.post('/auth/login', { email, password, totpCode }),
  logout: (refreshToken?: string) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
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
  auditLogs: (params?: object) => api.get('/users/audit-logs', { params }),
};

export const customersApi = {
  list: (params?: object) => api.get('/customers', { params }),
  get: (id: string) => api.get(`/customers/${id}`),
  create: (data: object) => api.post('/customers', data),
  update: (id: string, data: object) => api.put(`/customers/${id}`, data),
  delete: (id: string) => api.delete(`/customers/${id}`),
  orders: (id: string) => api.get(`/customers/${id}/orders`),
  addContact: (customerId: string, data: object) => api.post(`/customers/${customerId}/contacts`, data),
  deleteContact: (customerId: string, contactId: string) =>
    api.delete(`/customers/${customerId}/contacts/${contactId}`),
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
  get: (id: string) => api.get(`/products/${id}`),
  create: (data: object) => api.post('/products', data),
  update: (id: string, data: object) => api.put(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  categories: () => api.get('/products/categories/list'),
  saveBOM: (id: string, data: object) => api.post(`/products/${id}/bom`, data),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api.post(`/products/${id}/image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const inventoryApi = {
  stats: () => api.get('/inventory/stats'),
  procurementStats: () => api.get('/inventory/procurement-stats'),
  transactions: (params?: object) => api.get('/inventory/transactions', { params }),
  materials: (params?: object) => api.get('/inventory/materials', { params }),
  lowStock: () => api.get('/inventory/materials/low-stock'),
  createMaterial: (data: object) => api.post('/inventory/materials', data),
  updateMaterial: (id: string, data: object) => api.put(`/inventory/materials/${id}`, data),
  suppliers: (params?: object) => api.get('/inventory/suppliers', { params }),
  createSupplier: (data: object) => api.post('/inventory/suppliers', data),
  updateSupplier: (id: string, data: object) => api.put(`/inventory/suppliers/${id}`, data),
  warehouses: () => api.get('/inventory/warehouses'),
  stockLevels: (params?: object) => api.get('/inventory/stock-levels', { params }),
  adjustStock: (data: object) => api.post('/inventory/adjust', data),
  cycleCount: (data: object) => api.post('/inventory/cycle-counts', data),
  transfers: () => api.get('/inventory/transfers'),
  transferStock: (data: object) => api.post('/inventory/transfers', data),
  purchaseOrders: (params?: object) => api.get('/inventory/purchase-orders', { params }),
  createPurchaseOrder: (data: object) => api.post('/inventory/purchase-orders', data),
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
};

export const searchApi = {
  search: (q: string) => api.get('/search', { params: { q } }),
};

export const operationsApi = {
  stats: () => api.get('/operations/stats'),
  salesOrders: (params?: object) => api.get('/operations/orders', { params }),
  getSalesOrder: (id: string) => api.get(`/operations/orders/${id}`),
  createSalesOrder: (data: object) => api.post('/operations/orders', data),
  updateOrderStatus: (id: string, status: string) =>
    api.patch(`/operations/orders/${id}/status`, { status }),
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
  get: (id: string) => api.get(`/delivery/${id}`),
  create: (data: object) => api.post('/delivery', data),
  updateStatus: (id: string, data: object) => api.patch(`/delivery/${id}/status`, data),
  vehicles: (params?: object) => api.get('/delivery/vehicles', { params }),
  createVehicle: (data: object) => api.post('/delivery/vehicles', data),
};

export const hrApi = {
  stats: () => api.get('/hr/stats'),
  employees: (params?: object) => api.get('/hr/employees', { params }),
  getEmployee: (id: string) => api.get(`/hr/employees/${id}`),
  createEmployee: (data: object) => api.post('/hr/employees', data),
  updateEmployee: (id: string, data: object) => api.put(`/hr/employees/${id}`, data),
  attendance: (params?: object) => api.get('/hr/attendance', { params }),
  recordAttendance: (data: object) => api.post('/hr/attendance', data),
  leave: (params?: object) => api.get('/hr/leave', { params }),
  createLeave: (data: object) => api.post('/hr/leave', data),
  approveLeave: (id: string, status: string) => api.patch(`/hr/leave/${id}/approve`, { status }),
  payroll: (params?: object) => api.get('/hr/payroll', { params }),
  createPayroll: (data: object) => api.post('/hr/payroll', data),
  payPayroll: (id: string) => api.patch(`/hr/payroll/${id}/pay`),
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
  mpesaStatus: () => api.get('/finance/mpesa/status'),
  mpesaStkPush: (data: object) => api.post('/finance/mpesa/stk-push', data),
};

export const reportsApi = {
  summary: () => api.get('/finance/reports/summary'),
  profitLoss: (params?: object) => api.get('/finance/reports/profit-loss', { params }),
  balanceSheet: (params?: object) => api.get('/finance/reports/balance-sheet', { params }),
  cashFlow: (params?: object) => api.get('/finance/reports/cash-flow', { params }),
  vatReport: (params?: object) => api.get('/finance/reports/vat', { params }),
};

export const settingsApi = {
  company: () => api.get('/finance/company'),
  updateCompany: (data: object) => api.put('/finance/company', data),
};

export const qualityApi = {
  stats: () => api.get('/quality/stats'),
  list: (params?: object) => api.get('/quality', { params }),
  get: (id: string) => api.get(`/quality/${id}`),
  create: (data: object) => api.post('/quality', data),
  update: (id: string, data: object) => api.patch(`/quality/${id}`, data),
};
