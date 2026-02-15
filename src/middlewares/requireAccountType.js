function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

export function requireAccountType(expectedType) {
  const expected = normalize(expectedType);
  return function requireAccountTypeMiddleware(req, res, next) {
    const user = req?.auth?.user;
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const role = String(user.role || "").toLowerCase();
    if (role === "admin") return next();

    const accountType = normalize(user.accountType);
    if (accountType !== expected) {
      return res.status(403).json({
        error: "forbidden_account_type",
        expected,
        received: accountType || null,
      });
    }
    return next();
  };
}

