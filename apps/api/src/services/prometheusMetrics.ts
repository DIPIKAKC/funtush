import { Router, Request, Response, NextFunction } from 'express';
import prometheus from 'prom-client';

/**
 * Prometheus Metrics Service
 * Tracks: Request rate, latency, error rate per endpoint
 */

// Create registry
const register = new prometheus.Registry();

// Default metrics (CPU, memory, etc)
prometheus.collectDefaultMetrics({ register });

// CUSTOM METRICS

// 1. Request Counter - total requests per endpoint
const httpRequestsTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// 2. Request Duration Histogram - latency per endpoint
const httpRequestDurationSeconds = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// 3. Error Rate Counter
const httpRequestsError = new prometheus.Counter({
  name: 'http_requests_error_total',
  help: 'Total HTTP request errors',
  labelNames: ['method', 'route', 'error_type'],
  registers: [register],
});

// 4. Database Metrics
const dbConnectionPoolSize = new prometheus.Gauge({
  name: 'db_connection_pool_size',
  help: 'Database connection pool size',
  labelNames: ['pool_name'],
  registers: [register],
});

const dbConnectionPoolUsed = new prometheus.Gauge({
  name: 'db_connection_pool_used',
  help: 'Database connections in use',
  labelNames: ['pool_name'],
  registers: [register],
});

const dbQueryDurationSeconds = new prometheus.Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query latency',
  labelNames: ['query_type', 'table'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

// 5. Redis Metrics
const redisHitRate = new prometheus.Counter({
  name: 'redis_hits_total',
  help: 'Redis cache hits',
  labelNames: ['cache_key'],
  registers: [register],
});

const redisMissRate = new prometheus.Counter({
  name: 'redis_misses_total',
  help: 'Redis cache misses',
  labelNames: ['cache_key'],
  registers: [register],
});

const redisOperationDurationSeconds = new prometheus.Histogram({
  name: 'redis_operation_duration_seconds',
  help: 'Redis operation latency',
  labelNames: ['operation'],
  buckets: [0.001, 0.01, 0.05, 0.1],
  registers: [register],
});

// 6. GPS Pipeline Metrics
const gpsPipelineThroughput = new prometheus.Counter({
  name: 'gps_pipeline_throughput_total',
  help: 'GPS pipeline throughput (locations processed)',
  labelNames: ['pipeline_stage'],
  registers: [register],
});

const gpsPipelineLatency = new prometheus.Histogram({
  name: 'gps_pipeline_latency_seconds',
  help: 'GPS pipeline latency',
  labelNames: ['pipeline_stage'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// 7. SOS Metrics
const sosRequestsTotal = new prometheus.Counter({
  name: 'sos_requests_total',
  help: 'Total SOS requests',
  labelNames: ['status'],
  registers: [register],
});

const sosResponseTime = new prometheus.Histogram({
  name: 'sos_response_time_seconds',
  help: 'SOS response time',
  labelNames: ['tier'],
  buckets: [5, 10, 15, 30, 60],
  registers: [register],
});

const sosUnacknowledged = new prometheus.Gauge({
  name: 'sos_unacknowledged_total',
  help: 'Total unacknowledged SOS requests',
  registers: [register],
});

// 8. Payment Gateway Metrics
const paymentGatewayRequests = new prometheus.Counter({
  name: 'payment_gateway_requests_total',
  help: 'Payment gateway requests',
  labelNames: ['gateway', 'status'],
  registers: [register],
});

const paymentGatewayLatency = new prometheus.Histogram({
  name: 'payment_gateway_latency_seconds',
  help: 'Payment gateway latency',
  labelNames: ['gateway'],
  buckets: [0.5, 1, 2, 5, 10],
  registers: [register],
});

const paymentGatewayErrors = new prometheus.Counter({
  name: 'payment_gateway_errors_total',
  help: 'Payment gateway errors',
  labelNames: ['gateway', 'error_type'],
  registers: [register],
});

// 9. Business Metrics
const activeUsers = new prometheus.Gauge({
  name: 'active_users_total',
  help: 'Total active users',
  registers: [register],
});

const bookingsTotal = new prometheus.Counter({
  name: 'bookings_total',
  help: 'Total bookings',
  labelNames: ['status'],
  registers: [register],
});

const revenueTotal = new prometheus.Counter({
  name: 'revenue_total',
  help: 'Total revenue',
  labelNames: ['currency'],
  registers: [register],
});

// Middleware to track HTTP metrics
const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const route = req.route?.path || req.path;

  // Track response
  const originalSend = res.send;

  res.send = function (data: string | Buffer) {
    const duration = (Date.now() - start) / 1000;
    const statusCode = res.statusCode || 500;

    // Record metrics
    httpRequestsTotal.labels(req.method, route, statusCode).inc();
    httpRequestDurationSeconds.labels(req.method, route, statusCode).observe(duration);

    if (statusCode >= 400) {
      httpRequestsError.labels(req.method, route, 'http_error').inc();
    }

    return originalSend.call(this, data);
  };

  next();
};

// Export metrics endpoint
const metricsRouter = Router();

metricsRouter.get('/metrics', (_req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(register.metrics());
});

// Health check endpoint
metricsRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

export {
  metricsRouter,
  metricsMiddleware,
  register,
  // Counters
  httpRequestsTotal,
  httpRequestsError,
  redisHitRate,
  redisMissRate,
  gpsPipelineThroughput,
  sosRequestsTotal,
  paymentGatewayRequests,
  paymentGatewayErrors,
  bookingsTotal,
  revenueTotal,
  // Histograms
  httpRequestDurationSeconds,
  dbQueryDurationSeconds,
  redisOperationDurationSeconds,
  gpsPipelineLatency,
  sosResponseTime,
  paymentGatewayLatency,
  // Gauges
  dbConnectionPoolSize,
  dbConnectionPoolUsed,
  sosUnacknowledged,
  activeUsers,
};