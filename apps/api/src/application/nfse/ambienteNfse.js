// Sem configuração global, certificados ou rede: também usado pelo preflight local.
const HOSTS = Object.freeze({
  producao: 'sefin.nfse.gov.br',
  homolog: 'sefin.producaorestrita.nfse.gov.br',
});

function recusar(code, message) {
  throw Object.assign(new Error(message), { code, antesDoPost: true });
}

export function validarAmbienteNfse({ ambiente, baseUrl, caminhos = [] } = {}) {
  if (!Object.hasOwn(HOSTS, ambiente)) {
    recusar('NFSE_INVALID_ENV', 'NFSe: ambiente deve ser producao ou homolog.');
  }
  let url;
  try { url = new URL(baseUrl); } catch {
    recusar('NFSE_INVALID_BASE_URL', 'NFSe: endpoint absoluto HTTPS obrigatório.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== '443')) {
    recusar('NFSE_INVALID_BASE_URL', 'NFSe: endpoint HTTPS sem credenciais, query, fragmento ou porta alternativa obrigatório.');
  }
  // Allowlist exata: texto em caminho/query/userinfo e sufixos parecidos não comprovam ambiente.
  if (url.hostname !== HOSTS[ambiente]) {
    recusar('NFSE_ENV_HOST_MISMATCH', 'NFSe: host Sefin não corresponde ao ambiente configurado.');
  }
  for (const caminho of caminhos) {
    if (typeof caminho !== 'string' || !caminho.startsWith('/') ||
        caminho.startsWith('//') || /[\\\u0000-\u0020]/.test(caminho)) {
      recusar('NFSE_INVALID_PATH', 'NFSe: caminhos devem ser relativos ao host fiscal validado.');
    }
  }
  return { ambiente, hostname: url.hostname, baseUrl: url.href.replace(/\/+$/, '') };
}
