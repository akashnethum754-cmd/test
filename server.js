require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoSanitize = require("express-mongo-sanitize");

const { connectDB, getStatus } = require("./src/config/db");
const { apiLimiter } = require("./src/middleware/rateLimit");
const { requireAuth } = require("./src/middleware/auth");
const { exposeCsrfToken, doubleCsrfProtection } = require("./src/middleware/csrf");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// View engine
// ---------------------------------------------------------------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.locals.BRAND_NAME = "SHAGGY XMD";
app.locals.BRAND_SUB = "BOT ADMIN PANEL";
app.locals.FOOTER_TEXT = "POWERED BY LYNKO";

// ---------------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------------
app.set("trust proxy", 1); // needed for secure cookies behind a proxy (Railway, Render, etc.)
app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(mongoSanitize()); // strips $ and . from user input to prevent operator injection
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Sessions (stored in MongoDB, separate from bot data, in admin_sessions)
// ---------------------------------------------------------------------------
app.use(
  session({
    name: "shaggy.sid",
    secret: process.env.SESSION_SECRET || "insecure-dev-secret-change-me",
    resave: false,
    // true (not false) so the session ID is stable from the very first GET
    // request onward — this keeps the CSRF token (bound to the session id)
    // valid between loading the login form and submitting it. Traffic on
    // an internal admin panel is low, so the extra session-store writes
    // are a fine trade-off for that stability.
    saveUninitialized: true,
    store: process.env.MONGODB_URI
      ? MongoStore.create({
          mongoUrl: process.env.MONGODB_URI,
          dbName: process.env.MONGODB_DB_NAME || undefined,
          collectionName: "admin_sessions",
          ttl: 60 * 60 * 24, // 1 day
        })
      : undefined,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 8, // 8 hours hard cap; idle timeout is enforced separately
    },
  })
);

// CSRF protection for all state-changing requests. Token is exposed to
// views via res.locals.csrfToken and must be sent back as the
// "x-csrf-token" header on POST/PUT/PATCH/DELETE requests.
app.use(exposeCsrfToken);
app.use((req, res, next) => {
  // Skip CSRF for safe methods; enforce for mutating ones.
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  return doubleCsrfProtection(req, res, next);
});

app.use("/api", apiLimiter);

// Expose the logged-in admin's identity to every view (username/role only).
app.use((req, res, next) => {
  res.locals.admin = req.session && req.session.adminId
    ? { username: req.session.adminUsername, role: req.session.role }
    : null;
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/", require("./src/routes/auth"));
app.use("/", require("./src/routes/dashboard"));
app.use("/", require("./src/routes/settings"));
app.use("/", require("./src/routes/commands"));
app.use("/", require("./src/routes/users"));
app.use("/", require("./src/routes/groups"));
app.use("/", require("./src/routes/apiManager"));
app.use("/", require("./src/routes/logs"));
app.use("/", require("./src/routes/analytics"));
app.use("/", require("./src/routes/database"));
app.use("/", require("./src/routes/audit"));

app.get("/", (req, res) => res.redirect(req.session && req.session.adminId ? "/dashboard" : "/login"));

app.get("/api/session/ping", requireAuth, (req, res) => {
  // Lightweight endpoint the frontend polls to keep the idle-timeout clock
  // accurate and to detect server-side session expiry.
  res.json({ ok: true, username: req.session.adminUsername, role: req.session.role });
});

app.get("/healthz", (req, res) => {
  const status = getStatus();
  res.json({ ok: true, db: status.status });
});

// ---------------------------------------------------------------------------
// 404 + error handling
// ---------------------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.status(404).render("404", { active: "" });
});

app.use((err, req, res, next) => {
  if (err && err.code === "EBADCSRFTOKEN") {
    if (req.path.startsWith("/api/") || req.xhr) {
      return res.status(403).json({ error: "Invalid or missing CSRF token. Please refresh and try again." });
    }
    return res.status(403).send("Invalid request (CSRF check failed). Please refresh and try again.");
  }
  console.error("[server] Unhandled error:", err.message);
  if (req.path.startsWith("/api/")) return res.status(500).json({ error: "Internal server error." });
  res.status(500).render("500", { active: "" });
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
(async () => {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[server] SHAGGY XMD Admin Panel listening on port ${PORT}`);
  });
})();
