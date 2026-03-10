export function requireAuth() {
  return async function requireAuthMiddleware(req, res, next) {
    const ensureAuthorized = req.app?.locals?.ensureAuthorized;
    if (typeof ensureAuthorized !== "function") {
      return res.status(500).json({ error: "auth_middleware_not_configured" });
    }
    const ok = await ensureAuthorized(req, res, { allowApiKeyFallback: false });
    if (!ok) return;
    return next();
  };
}

