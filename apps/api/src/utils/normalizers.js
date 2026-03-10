export function onlyDigits(value) {
  if (typeof value !== "string") {
    return typeof value === "number" ? String(value) : "";
  }
  return value.replace(/\D/g, "");
}

export function toNullableString(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

export function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return ["1", "true", "yes", "sim"].includes(s);
  }
  return false;
}

