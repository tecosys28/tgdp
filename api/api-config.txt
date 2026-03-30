// ═══════════════════════════════════════════════════════════════════════════
// TGDP ECOSYSTEM - API CONFIGURATION
// Version: 1.0.0
// ═══════════════════════════════════════════════════════════════════════════

const API_CONFIG = {
  // Base URLs
  baseUrl: 'https://api.trot-gold.com',
  version: 'v1',
  
  // Endpoints
  endpoints: {
    // Authentication
    auth: {
      login: '/auth/login',
      register: '/auth/register',
      logout: '/auth/logout',
      refresh: '/auth/refresh',
      forgotPassword: '/auth/forgot-password',
      resetPassword: '/auth/reset-password',
      verifyEmail: '/auth/verify-email',
      verifyPhone: '/auth/verify-phone'
    },
    
    // Users
    users: {
      profile: '/users/profile',
      update: '/users/update',
      roles: '/users/roles',
      kyc: '/users/kyc',
      documents: '/users/documents'
    },
    
    // TGDP Operations
    tgdp: {
      balance: '/tgdp/balance',
      mint: '/tgdp/mint',
      trade: '/tgdp/trade',
      transfer: '/tgdp/transfer',
      withdraw: '/tgdp/withdraw',
      transactions: '/tgdp/transactions',
      statement: '/tgdp/statement'
    },
    
    // FTR Operations
    ftr: {
      balance: '/ftr/balance',
      swap: '/ftr/swap',
      redeem: '/ftr/redeem',
      partners: '/ftr/partners',
      categories: '/ftr/categories'
    },
    
    // GIC Operations
    gic: {
      balance: '/gic/balance',
      earnings: '/gic/earnings',
      redeem: '/gic/redeem',
      households: '/gic/households',
      stats: '/gic/stats'
    },
    
    // Trading
    trading: {
      orderBook: '/trading/orderbook',
      placeOrder: '/trading/order',
      cancelOrder: '/trading/order/cancel',
      myOrders: '/trading/my-orders',
      trades: '/trading/trades'
    },
    
    // T-JR (Jewelry Return)
    tjr: {
      submit: '/tjr/submit',
      returns: '/tjr/returns',
      schedule: '/tjr/schedule',
      assessment: '/tjr/assessment',
      jewelers: '/tjr/jewelers'
    },
    
    // T-JDB (Design Bank)
    tjdb: {
      designs: '/tjdb/designs',
      register: '/tjdb/register',
      purchase: '/tjdb/purchase',
      favorites: '/tjdb/favorites',
      custom: '/tjdb/custom',
      ipr: '/tjdb/ipr'
    },
    
    // Complaints
    complaints: {
      file: '/complaints/file',
      list: '/complaints/list',
      details: '/complaints/details',
      update: '/complaints/update',
      appeal: '/complaints/appeal'
    },
    
    // LBMA Rates
    rates: {
      current: '/rates/current',
      history: '/rates/history'
    },
    
    // Blockchain
    blockchain: {
      verify: '/blockchain/verify',
      records: '/blockchain/records',
      mint: '/blockchain/mint',
      burn: '/blockchain/burn'
    },
    
    // Admin
    admin: {
      users: '/admin/users',
      kyc: '/admin/kyc',
      complaints: '/admin/complaints',
      transactions: '/admin/transactions',
      config: '/admin/config',
      audit: '/admin/audit'
    }
  },
  
  // HTTP Methods
  methods: {
    GET: 'GET',
    POST: 'POST',
    PUT: 'PUT',
    PATCH: 'PATCH',
    DELETE: 'DELETE'
  },
  
  // Status Codes
  statusCodes: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    INTERNAL_ERROR: 500
  },
  
  // Request timeout (ms)
  timeout: 30000,
  
  // Retry configuration
  retry: {
    maxAttempts: 3,
    delay: 1000,
    backoff: 2
  }
};

// API Client Class
class APIClient {
  constructor(config = API_CONFIG) {
    this.config = config;
    this.token = null;
  }
  
  setToken(token) {
    this.token = token;
  }
  
  clearToken() {
    this.token = null;
  }
  
  async request(endpoint, method = 'GET', data = null, options = {}) {
    const url = `${this.config.baseUrl}/${this.config.version}${endpoint}`;
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    const fetchOptions = {
      method,
      headers,
      ...options
    };
    
    if (data && method !== 'GET') {
      fetchOptions.body = JSON.stringify(data);
    }
    
    try {
      const response = await fetch(url, fetchOptions);
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.message || 'API request failed');
      }
      
      return result;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }
  
  // Convenience methods
  get(endpoint, options) {
    return this.request(endpoint, 'GET', null, options);
  }
  
  post(endpoint, data, options) {
    return this.request(endpoint, 'POST', data, options);
  }
  
  put(endpoint, data, options) {
    return this.request(endpoint, 'PUT', data, options);
  }
  
  patch(endpoint, data, options) {
    return this.request(endpoint, 'PATCH', data, options);
  }
  
  delete(endpoint, options) {
    return this.request(endpoint, 'DELETE', null, options);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { API_CONFIG, APIClient };
}
