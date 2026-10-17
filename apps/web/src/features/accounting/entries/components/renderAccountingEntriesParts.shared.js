
export function contasDesconhecidas(lines, accounts) {
  if (!accounts?.length) return [];
  const conhecidas = new Set(accounts.map((a) => String(a.codigo)));
  return [...new Set(
    (lines || [])
      .map((l) => String(l?.conta || "").trim())
      .filter((c) => c && !conhecidas.has(c)),
  )];
}

export function hasDuplicateAccountAcrossSides(lines) {
  const debitAccounts = new Set(
    (Array.isArray(lines) ? lines : [])
      .filter((line) => String(line.tipo || "").toUpperCase() === "D")
      .map((line) => String(line.conta || "").trim())
      .filter(Boolean)
  );

  return (Array.isArray(lines) ? lines : []).some((line) => {
    if (String(line.tipo || "").toUpperCase() !== "C") return false;
    const accountCode = String(line.conta || "").trim();
    return accountCode && debitAccounts.has(accountCode);
  });
}
