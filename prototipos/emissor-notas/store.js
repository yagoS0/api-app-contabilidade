/* =============================================================================
   store.js — ÚNICO lugar que escreve em `state`.
   Nenhuma tela altera `state` direto: quando a regra mudar (numeração, auditoria,
   o que conta como "enviada"), muda aqui e vale para todas as telas.

   ⚠ NADA AQUI EMITE COISA ALGUMA. `emitirNota` é setTimeout + sorteio.
     Zero fetch, zero XHR, zero rede — de propósito (README).
   ============================================================================= */
"use strict";

const Store = (() => {

  // --- Notificação -----------------------------------------------------------
  // As telas se inscrevem para saber que algo mudou. O evento carrega o tipo
  // porque redesenhar a tela inteira a cada tecla mataria o foco do formulário:
  // quem redesenha o quê é decisão da tela, não do store.
  const ouvintes = new Set();
  function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
  function avisar(evento) { ouvintes.forEach((fn) => fn(evento || { tipo: "estado" })); }

  // --- Identidade ------------------------------------------------------------
  // O número continua de onde os mocks pararam. Repetir número de nota já
  // emitida seria mentira visível na lista.
  let proximoNumero = state.notas.reduce(
    (max, n) => (n.numero ? Math.max(max, Number(n.numero)) : max), 1000
  ) + 1;
  let seqNota = state.notas.length;
  let seqCliente = state.clientes.length;
  let seqServico = state.servicos.length;

  const hojeIso = () => new Date().toISOString().slice(0, 10);
  const agoraIso = () => new Date().toISOString();

  // --- Leitura ---------------------------------------------------------------
  const clientePorId = (id) => state.clientes.find((c) => c.id === id) || null;
  const servicoPorId = (id) => state.servicos.find((s) => s.id === id) || null;
  const notaPorId = (id) => state.notas.find((n) => n.id === id) || null;
  const recorrenciaPorId = (id) => state.recorrencias.find((r) => r.id === id) || null;
  const lotePorId = (id) => state.lotes.find((l) => l.id === id) || null;

  /**
   * Impostos de um rascunho de nota. Devolve `null` quando não há valor:
   * ⚠ ausência não é zero — imposto "R$ 0,00" sobre valor não digitado seria
   * uma afirmação que ninguém fez.
   */
  function calcularPrevia({ valor, clienteId, servicoId }) {
    if (valor == null) return null;
    const servico = servicoPorId(servicoId);
    const cliente = clientePorId(clienteId);
    return calcularImpostos({
      valor,
      aliquotaIss: servico ? servico.aliquotaIss : 0,
      retencoes: cliente ? cliente.retencoes : null,
    });
  }

  // --- Auditoria -------------------------------------------------------------
  function registrar(nota, acao, quem) {
    if (!Array.isArray(nota.auditoria)) nota.auditoria = [];
    nota.auditoria.push({ quando: agoraIso(), quem: quem || "Yago (contador)", acao });
  }

  // --- Escrita: notas --------------------------------------------------------
  function criarNota(dados) {
    const valor = typeof dados.valor === "string" ? Fmt.paraNumero(dados.valor) : (dados.valor ?? null);
    const referencia = dados.referencia || Fmt.refDeHoje();
    const servico = servicoPorId(dados.servicoId);
    const impostos = calcularPrevia({ valor, clienteId: dados.clienteId, servicoId: dados.servicoId });
    const descricaoBase = dados.descricao || (servico ? servico.descricao : "");

    const nota = {
      id: `n${++seqNota}`,
      // ⚠ Nasce sem número. O número só existe depois da emissão (data.js já
      // segue essa regra nos mocks) — rascunho numerado vira buraco na sequência.
      numero: null,
      clienteId: dados.clienteId || null,
      servicoId: dados.servicoId || null,
      descricao: Fmt.aplicarVariaveis(descricaoBase, referencia),
      valor,
      impostos,
      liquido: impostos ? impostos.liquido : null,
      status: dados.status || "rascunho",
      origem: dados.origem || "avulsa",
      origemId: dados.origemId || null,
      referencia,
      emitidaEm: null,
      canceladaEm: null,
      motivoRejeicao: null,
      observacoes: dados.observacoes || "",
      enviarEmail: dados.enviarEmail !== false,
      emailEnviadoEm: null,
      auditoria: [],
    };
    registrar(nota, "Nota criada");
    state.notas.push(nota);
    avisar({ tipo: "nota-criada", nota });
    return nota;
  }

  /** Reescreve os campos editáveis e RECALCULA — impostos nunca ficam de fora. */
  function atualizarNota(id, dados) {
    const nota = notaPorId(id);
    if (!nota) return null;
    if ("clienteId" in dados) nota.clienteId = dados.clienteId || null;
    if ("servicoId" in dados) nota.servicoId = dados.servicoId || null;
    if ("valor" in dados) {
      nota.valor = typeof dados.valor === "string" ? Fmt.paraNumero(dados.valor) : (dados.valor ?? null);
    }
    if ("referencia" in dados && dados.referencia) nota.referencia = dados.referencia;
    if ("descricao" in dados) nota.descricao = Fmt.aplicarVariaveis(dados.descricao || "", nota.referencia);
    if ("observacoes" in dados) nota.observacoes = dados.observacoes || "";
    if ("enviarEmail" in dados) nota.enviarEmail = dados.enviarEmail !== false;
    nota.impostos = calcularPrevia(nota);
    nota.liquido = nota.impostos ? nota.impostos.liquido : null;
    avisar({ tipo: "nota-atualizada", nota });
    return nota;
  }

  function salvarRascunho(dados) {
    const nota = dados.id ? atualizarNota(dados.id, dados) : criarNota({ ...dados, status: "rascunho" });
    if (nota) {
      registrar(nota, "Rascunho salvo");
      toast("Rascunho salvo. Ele fica na lista sem número até você emitir.");
      avisar({ tipo: "nota-atualizada", nota });
    }
    return nota;
  }

  /**
   * ⚠ SIMULAÇÃO. Não fala com prefeitura, SEFAZ, ADN, SERPRO nem com a API do
   * projeto. Espera 800–1500 ms e sorteia: 90% emitida, 10% rejeitada com um
   * erro de `ERROS`. Resolve nos DOIS casos — rejeição é resposta, não falha.
   */
  function emitirNota(nota) {
    nota.status = "processando";
    nota.motivoRejeicao = null;
    registrar(nota, "Enviada, aguardando retorno", "Sistema");
    avisar({ tipo: "nota-processando", nota });

    return new Promise((resolve) => {
      const espera = 800 + Math.floor(Math.random() * 700);
      setTimeout(() => {
        const aceita = Math.random() >= 0.10;
        if (aceita) {
          nota.status = "emitida";
          nota.numero = String(proximoNumero++);
          nota.emitidaEm = hojeIso();
          registrar(nota, `Autorizada — nº ${nota.numero}`, "Prefeitura");
          if (nota.enviarEmail) {
            const cliente = clientePorId(nota.clienteId);
            nota.emailEnviadoEm = hojeIso();
            registrar(nota, `E-mail enviado para ${cliente ? cliente.email : "o cliente"}`, "Sistema");
          }
        } else {
          const erro = ERROS[Math.floor(Math.random() * ERROS.length)];
          nota.status = "rejeitada";
          nota.motivoRejeicao = erro;
          registrar(nota, `Rejeitada — ${erro.codigo}`, "Prefeitura");
        }
        avisar({ tipo: "nota-emitida", nota });
        resolve(nota);
      }, espera);
    });
  }

  /** Só nota emitida pode ser cancelada — as demais devolvem o motivo da recusa. */
  function cancelarNota(id, motivo) {
    const nota = notaPorId(id);
    if (!nota) return { ok: false, motivo: "Nota não encontrada." };
    if (nota.status !== "emitida") {
      return { ok: false, motivo: `Só nota emitida pode ser cancelada — esta está ${nota.status}.` };
    }
    nota.status = "cancelada";
    nota.canceladaEm = hojeIso();
    registrar(nota, motivo ? `Cancelada — ${motivo}` : "Cancelada");
    avisar({ tipo: "nota-cancelada", nota });
    return { ok: true, nota };
  }

  /** Só marca o envio e registra no histórico — nenhum e-mail sai daqui. */
  function enviarPorEmail(ids) {
    const alvos = ids.map(notaPorId).filter((n) => n && n.status === "emitida");
    alvos.forEach((n) => {
      const cliente = clientePorId(n.clienteId);
      n.emailEnviadoEm = hojeIso();
      registrar(n, `E-mail enviado para ${cliente ? cliente.email : "o cliente"}`, "Sistema");
    });
    avisar({ tipo: "notas-enviadas", ids });
    return alvos.length;
  }

  /** PDF/XML são fictícios: o protótipo não gera arquivo nenhum. */
  function baixarArquivos(ids, formato) {
    const alvos = ids.map(notaPorId).filter((n) => n && n.numero);
    alvos.forEach((n) => registrar(n, `${(formato || "PDF/XML").toUpperCase()} baixado`, "Sistema"));
    avisar({ tipo: "notas-baixadas", ids });
    return alvos.length;
  }

  // --- Escrita: cadastros ----------------------------------------------------
  function criarCliente(dados) {
    const num = (v) => {
      const n = Fmt.paraNumero(v);
      return n == null ? 0 : n;
    };
    const cliente = {
      id: `c${++seqCliente}`,
      razaoSocial: (dados.razaoSocial || "").trim(),
      cnpj: Fmt.soDigitos(dados.cnpj),
      email: (dados.email || "").trim(),
      endereco: dados.endereco || { logradouro: "", bairro: "", municipio: "", uf: "", cep: "" },
      // Retenção não informada entra como 0 porque aqui o cadastro AFIRMA:
      // "este tomador não retém". Diferente de valor de nota não digitado.
      retencoes: {
        irrf: num(dados.irrf), pis: num(dados.pis), cofins: num(dados.cofins),
        csll: num(dados.csll), inss: num(dados.inss),
      },
    };
    state.clientes.push(cliente);
    avisar({ tipo: "cliente-criado", cliente });
    return cliente;
  }

  function criarServico(dados) {
    const servico = {
      id: `s${++seqServico}`,
      descricao: (dados.descricao || "").trim(),
      codigoMunicipal: (dados.codigoMunicipal || "").trim(),
      aliquotaIss: Fmt.paraNumero(dados.aliquotaIss) ?? 0,
      valorPadrao: Fmt.paraNumero(dados.valorPadrao),
    };
    state.servicos.push(servico);
    avisar({ tipo: "servico-criado", servico });
    return servico;
  }

  // --- Consulta de notas -----------------------------------------------------
  /** Filtros do formulário + busca global. Devolve cópia ordenada, nunca `state.notas`. */
  function filtrarNotas(filtros) {
    const f = filtros || {};
    const busca = String(f.busca || "").trim().toLowerCase();
    const digitos = Fmt.soDigitos(busca);

    const casaBusca = (n) => {
      if (!busca) return true;
      const cliente = clientePorId(n.clienteId);
      const campos = [
        n.numero || "",
        n.descricao || "",
        cliente ? cliente.razaoSocial : "",
        cliente ? cliente.email : "",
      ].join(" ").toLowerCase();
      if (campos.includes(busca)) return true;
      if (digitos) {
        if (cliente && Fmt.soDigitos(cliente.cnpj).includes(digitos)) return true;
        if (n.numero && n.numero.includes(digitos)) return true;
        if (n.valor != null && String(n.valor).replace(".", "").includes(digitos)) return true;
      }
      return false;
    };

    return state.notas
      .filter((n) => {
        if (f.periodo && n.referencia !== f.periodo) return false;
        if (f.clienteId && n.clienteId !== f.clienteId) return false;
        if (f.status && n.status !== f.status) return false;
        if (f.origem && n.origem !== f.origem) return false;
        return casaBusca(n);
      })
      // Rascunho não tem data de emissão; entra no fim do próprio mês para
      // aparecer no topo — é justamente o que ainda pede ação.
      .sort((a, b) => {
        const chave = (n) => n.emitidaEm || `${n.referencia}-31`;
        return chave(b).localeCompare(chave(a));
      });
  }

  function setFiltrosNotas(patch) {
    Object.assign(state.ui.filtrosNotas, patch);
    avisar({ tipo: "filtros", filtros: state.ui.filtrosNotas });
    return state.ui.filtrosNotas;
  }

  // --- Seleção (lista de notas) ---------------------------------------------
  function alternarSelecao(id, ligado) {
    if (ligado) state.ui.selecaoNotas.add(id);
    else state.ui.selecaoNotas.delete(id);
    avisar({ tipo: "selecao" });
    return state.ui.selecaoNotas;
  }
  function definirSelecao(ids) {
    state.ui.selecaoNotas.clear();
    ids.forEach((id) => state.ui.selecaoNotas.add(id));
    avisar({ tipo: "selecao" });
    return state.ui.selecaoNotas;
  }
  function limparSelecao() { return definirSelecao([]); }
  const selecionadas = () => Array.from(state.ui.selecaoNotas);

  // --- Toast -----------------------------------------------------------------
  let seqToast = 0;
  /** tipo: "info" (padrão) | "sucesso" | "erro" | "aviso" */
  function toast(mensagem, tipo) {
    state.ui.toast = { id: ++seqToast, mensagem, tipo: tipo || "info" };
    avisar({ tipo: "toast", toast: state.ui.toast });
    return state.ui.toast;
  }

  // --- Painel ----------------------------------------------------------------
  /** Dias até o vencimento do certificado — negativo se já venceu. */
  function diasParaVencerCertificado(hoje = new Date()) {
    const validade = state.empresa.certificadoValidade;
    if (!validade) return null;
    const [a, m, d] = validade.split("-").map(Number);
    const alvo = Date.UTC(a, m - 1, d);
    const agora = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.round((alvo - agora) / 86400000);
  }

  return {
    state,
    assinar,
    // leitura
    clientePorId, servicoPorId, notaPorId, recorrenciaPorId, lotePorId,
    calcularPrevia, filtrarNotas, selecionadas, diasParaVencerCertificado,
    // escrita
    criarNota, atualizarNota, salvarRascunho, emitirNota, cancelarNota,
    enviarPorEmail, baixarArquivos, criarCliente, criarServico,
    setFiltrosNotas, alternarSelecao, definirSelecao, limparSelecao,
    toast,
  };
})();
