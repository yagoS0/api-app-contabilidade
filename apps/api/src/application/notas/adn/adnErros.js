// Nunca propagar texto/corpo do provedor ou do cofre: podem conter dados de outro contribuinte.
const mensagens = Object.freeze({
  ADN_REJEICAO: 'O ADN Nacional rejeitou a consulta. A causa precisa ser conferida; este retorno não comprova falha do certificado.',
  ADN_RESPOSTA_INCONCLUSIVA: 'A resposta do ADN não comprovou o término da consulta. Conferência necessária.',
  ADN_COLETA_INCOMPLETA: 'A consulta ADN contém documentos ou erros que impedem comprovar a coleta completa.',
  ADN_CURSOR_SEM_AVANCO: 'A consulta ADN não avançou o identificador de distribuição. A coleta ficou incompleta.',
  ADN_LIMITE_PAGINACAO: 'O limite de páginas foi atingido sem comprovar o fim da consulta ADN.',
  CERT_STORAGE_UNAVAILABLE: 'O certificado está cadastrado, mas não foi possível acessar o arquivo no cofre.',
  CERT_PASSWORD_DECRYPT_FAILED: 'Não foi possível recuperar a senha do certificado cadastrado.',
  CERT_CNPJ_MISMATCH: 'O certificado cadastrado não corresponde à identidade desta empresa.',
  CERT_RESOLUTION_FAILED: 'Não foi possível resolver o certificado desta empresa. Isso não comprova ausência de certificado.',
  PFX_REQUIRED: 'O material do certificado não está disponível para esta consulta.',
  PFX_PARSE_FAILED: 'Não foi possível abrir o certificado. Confira o arquivo e a senha cadastrados.',
  PFX_NO_CERT_OR_KEY: 'O arquivo cadastrado não forneceu certificado e chave para esta consulta.',
  NO_COMPANY_CERT: 'Esta operação exige o certificado A1 próprio da empresa cadastrado.',
  ADN_SYNC_FAILED: 'Não foi possível concluir a consulta ADN. Confira a falha antes de tentar novamente.',
  NETWORK_ERROR: 'Não foi possível concluir a conexão segura com o ADN Nacional.',
  ADN_UNAVAILABLE: 'O ADN Nacional está temporariamente indisponível.',
  CNPJ_NOT_IN_ADN: 'A consulta não obteve resposta conclusiva do ADN para esta empresa.',
  INVALID_CNPJ: 'A identificação da empresa é inválida para esta consulta.',
  INVALID_ENV: 'O ambiente da consulta ADN é inválido.',
  ENDPOINT_NOT_FOUND: 'O ADN não retornou uma resposta reconhecida.',
});

export function errosAdnSeguros(errors) {
  const lista = Array.isArray(errors) ? errors : errors ? [errors] : [];
  const codes = lista.slice(0, 50).map(e => e?.Codigo ?? e?.codigo ?? e?.Code ?? e?.code)
    .filter(c => (typeof c === 'string' || typeof c === 'number') && /^(?:[A-Z]{1,3})?\d{1,6}$/.test(String(c)))
    .map(String);
  return [...new Set(codes)].slice(0, 10).map(code => ({ code }));
}

export function erroAdnSeguro(err, fallback = 'ADN_SYNC_FAILED') {
  const candidate = err?.code;
  const code = Object.hasOwn(mensagens, candidate) || /^HTTP_\d{3}$/.test(candidate || '') ? candidate : fallback;
  const errors = errosAdnSeguros(err?.errors);
  const message = (mensagens[code] || `O ADN não concluiu a consulta (${code}). Aguarde o prazo indicado antes de tentar novamente.`)
    + (errors.length ? ` Códigos ADN: ${errors.map(e => e.code).join(', ')}.` : '');
  return { code, message, errors };
}

export function falhaAdn(code, errors) {
  const safe = erroAdnSeguro({ code, errors });
  return Object.assign(new Error(safe.message), safe);
}

// Contrato lote=true: HTTP 404 / E2220 também é término legítimo. Não usar a
// lista sanitizada aqui: descartar um código inválido não torna o retorno válido.
export function fimAdnComprovado(batch) {
  return batch?.status === 'NENHUM_DOCUMENTO_LOCALIZADO'
    && Array.isArray(batch.items) && batch.items.length === 0
    && (batch.errors == null || (Array.isArray(batch.errors)
      && batch.errors.every(e => (e?.Codigo ?? e?.codigo ?? e?.Code ?? e?.code) === 'E2220')));
}
