// Erro único da camada de API. `code` é o `error` que o backend devolve no
// corpo JSON (ex.: "invalid_credentials"); `status` é o HTTP.
// ⚠ `status: 0` é reservado para falha de rede (fetch rejeitou) — nesse caso
// não houve resposta, e tratar como 500 esconderia "você está offline".
//
// ⚠ `corpo` GUARDA A RESPOSTA INTEIRA, e existe por causa da emissão de NFS-e: as recusas de lá
// não cabem num código só. Elas trazem `camada` (NOSSA/TRANSPORTE/RECEITA), `correcao` (o que
// fazer), `motivos`, `papelMinimo`, `numeroReutilizavel` e a linha `nfse` — e é `numeroReutilizavel`
// que decide se um reenvio reaproveita o número ou queima outro. Reduzir tudo isso a `code`
// apagaria exatamente a informação que separa "corrija e envie de novo" de "NÃO reenvie".
export class ApiError extends Error {
  constructor(status, code, message, corpo = null) {
    super(message || code || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code || null;
    this.corpo = corpo && typeof corpo === "object" ? corpo : null;
  }
}
