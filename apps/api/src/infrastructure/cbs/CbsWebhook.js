// Contrato CBS: HEAD verifica alcance. Não documenta autenticação do POST.
// Este componente não abre rota, não consulta Receita e não confia no arquivo recebido.
export function criarReceptorWebhookCbs({ habilitado = false, registrarSinalPendente } = {}) {
  if (typeof habilitado !== 'boolean' || (habilitado && typeof registrarSinalPendente !== 'function')) throw new Error('Configuração de callback CBS inválida.');
  return Object.freeze({
    head: () => ({ status: habilitado ? 204 : 503 }),
    async receber(bytes) {
      if (!habilitado) return { status: 503 };
      if (!Buffer.isBuffer(bytes) || bytes.length > 65536) return { status: 413 };
      let data;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return { status: 400 }; }
      if (!data || Array.isArray(data) || typeof data.tiqueteSolicitacao !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(data.tiqueteSolicitacao)) return { status: 400 };
      try {
        // O repositório deve correlacionar apenas ticket já conhecido, deduplicar
        // atomicamente e persistir antes de resolver. Não aceita grupo do payload.
        // URLs, erros e demais campos não atravessam esta fronteira.
        await registrarSinalPendente({ tiqueteSolicitacao: data.tiqueteSolicitacao, origem: 'WEBHOOK_NAO_AUTENTICADO', estado: 'REQUER_CONSULTA_AUTENTICADA' });
        // Resposta idêntica para ticket conhecido/desconhecido; sem oracle de existência.
        return { status: 202 };
      } catch { return { status: 503 }; }
    },
  });
}
