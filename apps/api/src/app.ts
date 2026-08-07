import express from "express";
import { db, redis } from "@funtush/database";
import { resolveTenant } from "./middleware/resolveTenant.middleware";
import { rateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { requestLogger } from "./middleware/requestLogger.middleware";
import adminRouter from "./routes/admin/index";
import agencyRoutes from "./routes/agency.routes";
import bookingRoutes from "./routes/booking.routes";
import paymentWebhookRoutes from "./routes/payment.webhook.routes";
import { startSubscriptionCron } from "./jobs/subscriptionExpiry.job";
import reportsRouter from "./routes/agency/reports.route";
import billingRoutes from './routes/billing.routes';
import stripeWebhookRoutes from './routes/webhooks/stripe';
import paymentMethodsRoutes from "./routes/paymentMethods";
import adCampaignRoutes from "./routes/adCampaign.routes";
import bugRoutes from "./routes/bug.routes";
import bugAdminRoutes from "./routes/bug.routes.js";
import apiKeyRoutes from "./routes/apiKey.routes.js";
import publicApiRoutes from "./routes/publicApi.routes.js";

const app = express();  

app.use(express.json());
app.use(requestLogger);

app.get("/health", async (_req, res) => {
  const [dbStatus, redisStatus] = await Promise.all([
    db.$queryRaw`SELECT 1`.then(() => "ok" as const).catch(() => "error" as const),
    redis.ping().then(() => "ok" as const).catch(() => "error" as const),
  ]);

  const allOk = dbStatus === "ok" && redisStatus === "ok";

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "error",
    db: dbStatus,
    redis: redisStatus,
  });
});

app.post("/sos", (_req, res) => {
  res.json({ status: "SOS received" });
});

app.use(resolveTenant);
app.use(rateLimitMiddleware);
app.use("/admin", adminRouter);
app.use("/agencies/me/reports", reportsRouter);
app.use("/", agencyRoutes);
app.use("/bookings", bookingRoutes);
app.use("/webhooks/payment", paymentWebhookRoutes);
app.use("/agencies/me/payment-methods", paymentMethodsRoutes);

app.use('/billing', billingRoutes);
app.use('/webhooks', stripeWebhookRoutes);
app.use('/agencies/me/ad-campaigns', adCampaignRoutes);

app.use("/agencies/me/bugs", bugRoutes);
app.use("/admin/bugs", bugAdminRoutes);
app.use("/agencies/me/api-keys", apiKeyRoutes);
app.use("/public-api/v1", publicApiRoutes);

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  startSubscriptionCron();
}

export default app;