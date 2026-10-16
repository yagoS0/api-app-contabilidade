// Mesma fonte e valores utilizados pelos workers. Não infere regime de documentos,
// procuração ou pró-labore e não altera escolhas salvas quando o cadastro muda.
const COMMON_KEYS = ['inss', 'pagamento', 'conferencia'];
const REGIME_KEYS = {
  SIMPLES: ['das', 'extrato', 'parcelamento'],
  LUCRO_PRESUMIDO: ['presumido'],
  LUCRO_REAL: [],
};

export function aplicarRegimeRotinas(companyLegacy) {
  const raw = String(companyLegacy?.regimeTributario || companyLegacy?.tipoTributario || '').trim().toUpperCase();
  if (!Object.hasOwn(REGIME_KEYS, raw)) {
    return { regime: null, applicableKeys: [], unavailableReason: 'Regime tributário não confirmado no cadastro da empresa.' };
  }
  return { regime: raw, applicableKeys: [...REGIME_KEYS[raw], ...COMMON_KEYS], unavailableReason: null };
}

export function labelRotinaAplicavel(key, labels) {
  return key === 'parcelamento' ? 'Parcelamento do Simples' : labels[key];
}
