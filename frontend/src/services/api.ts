import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
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
          const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken });
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
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  logout: (refreshToken?: string) =>
    api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

export const dashboardApi = {
  getKPIs: () => api.get('/dashboard/kpis'),
  getCharts: () => api.get('/dashboard/charts'),
};

export const usersApi = {
  list: (params?: object) => api.get('/users', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: object) => api.post('/users', data),
  update: (id: string, data: object) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  roles: () => api.get('/users/roles'),
  departments: () => api.get('/users/departments'),
  auditLogs: (params?: object) => api.get('/users/audit-logs', { params }),
};

export const customersApi = {
  list: (params?: object) => api.get('/customers', { params }),
  get: (id: string) => api.get(`/customers/${id}`),
  create: (data: object) => api.post('/customers', data),
  update: (id: string, data: object) => api.put(`/customers/${id}`, data),
  delete: (id: string) => api.delete(`/customers/${id}`),
  orders: (id: string) => api.get(`/customers/${id}/orders`),
};

export const productsApi = {
  list: (params?: object) => api.get('/products', { params }),
  get: (id: string) => api.get(`/products/${id}`),
  create: (data: object) => api.post('/products', data),
  update: (id: string, data: object) => api.put(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  categories: () => api.get('/products/categories/list'),
  saveBOM: (id: string, data: object) => api.post(`/products/${id}/bom`, data),
};

export const inventoryApi = {
  materials: (params?: object) => api.get('/inventory/materials', { params }),
  lowStock: () => api.get('/inventory/materials/low-stock'),
  createMaterial: (data: object) => api.post('/inventory/materials', data),
  suppliers: (params?: object) => api.get('/inventory/suppliers', { params }),
  createSupplier: (data: object) => api.post('/inventory/suppliers', data),
  warehouses: () => api.get('/inventory/warehouses'),
  stockLevels: (params?: object) => api.get('/inventory/stock-levels', { params }),
  adjustStock: (data: object) => api.post('/inventory/adjust', data),
  purchaseOrders: (params?: object) => api.get('/inventory/purchase-orders', { params }),
  createPurchaseOrder: (data: object) => api.post('/inventory/purchase-orders', data),
};

export const operationsApi = {
  salesOrders: (params?: object) => api.get('/operations/orders', { params }),
  createSalesOrder: (data: object) => api.post('/operations/orders', data),
  updateOrderStatus: (id: string, status: string) =>
    api.patch(`/operations/orders/${id}/status`, { status }),
  quotations: (params?: object) => api.get('/operations/quotations', { params }),
  production: (params?: object) => api.get('/operations/production', { params }),
  createProduction: (data: object) => api.post('/operations/production', data),
  startProduction: (id: string) => api.post(`/operations/production/${id}/start`),
  completeProduction: (id: string, data: object) =>
    api.post(`/operations/production/${id}/complete`, data),
};

export const financeApi = {
  company: () => api.get('/finance/company'),
  updateCompany: (data: object) => api.put('/finance/company', data),
  invoices: (params?: object) => api.get('/finance/invoices', { params }),
  createInvoice: (data: object) => api.post('/finance/invoices', data),
  payments: (data: object) => api.post('/finance/payments', data),
  accounts: () => api.get('/finance/accounts'),
  employees: (params?: object) => api.get('/finance/employees', { params }),
  machines: () => api.get('/finance/machines'),
  maintenance: () => api.get('/finance/maintenance'),
  quality: (params?: object) => api.get('/finance/quality', { params }),
  notifications: () => api.get('/finance/notifications'),
  markNotificationRead: (id: string) => api.patch(`/finance/notifications/${id}/read`),
  reportsSummary: () => api.get('/finance/reports/summary'),
};
