// Erro único da camada de API. `code` é o `error` que o backend devolve no
// corpo JSON (ex.: "invalid_credentials"); `status` é o HTTP.
// ⚠ `status: 0` é reservado para falha de rede (fetch rejeitou) — nesse caso
// não houve resposta, e tratar como 500 esconderia "você está offline".
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code || null;
  }
}
