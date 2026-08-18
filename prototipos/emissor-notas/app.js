/* =============================================================================
   app.js — roteador por hash + telas.

   Regras deste arquivo:
   - Nenhuma linha escreve em `state`. Tudo passa por `Store`.
   - Nenhuma linha formata número, data ou CNPJ. Tudo passa por `Fmt`.
   - `Fmt.esc` em TODO dado do estado antes de qualquer `innerHTML`.
   - Nenhuma chamada de rede. Não existe `fetch` neste protótipo.
   ============================================================================= */
"use strict";

(() => {

  // ===========================================================================
  // Utilidades de DOM
  // ===========================================================================
  const app = document.getElementById("app");

  function tpl(id) {
    const t = document.getElementById(id);
    if (!t) throw new Error(`Template ausente: ${id}`);
    return t.content.cloneNode(true);
  }
  const criar = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  };

  // ===========================================================================
  // Vocabulário — os únicos rótulos que aparecem na tela.
  // ===========================================================================
  const ROTULO_STATUS = {
    rascunho: "Rascunho", processando: "Processando", emitida: "Emitida",
    rejeitada: "Rejeitada", cancelada: "Cancelada", substituida: "Substituída",
  };
  const ROTULO_ORIGEM = { avulsa: "Avulsa", recorrente: "Recorrente", lote: "Lote" };

  const rotuloStatus = (s) => ROTULO_STATUS[s] || s;

  /** Mesma marcação de #tpl-chip-status; string porque a linha da tabela é innerHTML. */
  const chipHtml = (status) =>
    `<span class="chip" data-status="${Fmt.esc(status)}">${Fmt.esc(rotuloStatus(status))}</span>`;

  function chipEl(status) {
    const frag = tpl("tpl-chip-status");
    const span = frag.querySelector(".chip");
    span.dataset.status = status;
    span.textContent = rotuloStatus(status);
    return span;
  }

  /**
   * De onde a nota veio. Critério de aceite: TODA nota diz a procedência —
   * "avulsa" sozinha não responde "qual recorrência?" nem "qual lote?".
   */
  function origemHtml(nota) {
    const base = Fmt.esc(ROTULO_ORIGEM[nota.origem] || nota.origem);
    if (nota.origem === "recorrente" && nota.origemId) {
      const r = Store.recorrenciaPorId(nota.origemId);
      const detalhe = r ? Fmt.aplicarVariaveis(r.descricao, nota.referencia) : "";
      return `${base}<span class="origem-id" title="${Fmt.esc(detalhe)}">recorrência ${Fmt.esc(nota.origemId)}</span>`;
    }
    if (nota.origem === "lote" && nota.origemId) {
      return `${base}<span class="origem-id">lote ${Fmt.esc(nota.origemId)}</span>`;
    }
    return base;
  }

  function origemTexto(nota) {
    const base = ROTULO_ORIGEM[nota.origem] || nota.origem;
    if (nota.origem === "recorrente" && nota.origemId) {
      const r = Store.recorrenciaPorId(nota.origemId);
      return `${base} — recorrência ${nota.origemId}${r ? ` (${Fmt.aplicarVariaveis(r.descricao, nota.referencia)})` : ""}`;
    }
    if (nota.origem === "lote" && nota.origemId) {
      const l = Store.lotePorId(nota.origemId);
      return `${base} — lote ${nota.origemId}${l ? ` (${l.origem}, ${Fmt.data(l.criadoEm)})` : ""}`;
    }
    return base;
  }

  const nomeCliente = (id) => {
    const c = Store.clientePorId(id);
    return c ? c.razaoSocial : "—";
  };

  const RETENCOES = [
    ["irrf", "IRRF"], ["pis", "PIS"], ["cofins", "COFINS"], ["csll", "CSLL"], ["inss", "INSS"],
  ];

  /**
   * Endereço do tomador. Cliente criado na hora não tem endereço: montar a linha
   * assim mesmo imprimiria " — , /", que parece dado corrompido em vez de dado
   * ausente. Sem endereço, a linha não existe.
   */
  function enderecoLinha(cliente) {
    const e = cliente.endereco || {};
    const rua = [e.logradouro, e.bairro].filter(Boolean).join(" — ");
    const cidade = [e.municipio, e.uf].filter(Boolean).join("/");
    const texto = [rua, cidade].filter(Boolean).join(", ");
    return texto ? `<div class="origem-id">${Fmt.esc(texto)}</div>` : "";
  }

  // ===========================================================================
  // Toast
  // ===========================================================================
  const toastRoot = document.getElementById("toast-root");
  function mostrarToast(t) {
    const el = criar("div", "toast", t.mensagem);
    el.dataset.tipo = t.tipo;
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ===========================================================================
  // Modal
  // ===========================================================================
  const Modal = (() => {
    let aberto = null;
    let focoAnterior = null;

    function aoTeclar(ev) {
      if (ev.key === "Escape") { ev.stopPropagation(); fechar(); }
    }

    function fechar() {
      if (!aberto) return;
      aberto.remove();
      aberto = null;
      document.removeEventListener("keydown", aoTeclar, true);
      if (focoAnterior && document.contains(focoAnterior)) focoAnterior.focus();
      focoAnterior = null;
    }

    function abrir({ titulo, corpoHtml, acoes }) {
      fechar();
      focoAnterior = document.activeElement;
      const frag = tpl("tpl-modal");
      const backdrop = frag.querySelector(".modal-backdrop");
      frag.querySelector("[data-modal-title]").textContent = titulo;
      const corpo = frag.querySelector("[data-modal-body]");
      corpo.innerHTML = corpoHtml || "";

      const rodape = frag.querySelector("[data-modal-actions]");
      (acoes || []).forEach((a) => {
        const b = criar("button", `btn${a.primaria ? " btn-primary" : ""}${a.perigo ? " btn-danger" : ""}`, a.rotulo);
        b.type = "button";
        b.addEventListener("click", () => { if (a.aoClicar) a.aoClicar(corpo); else fechar(); });
        rodape.appendChild(b);
      });

      // Só o fundo fecha; clique dentro da caixa não pode descartar o que foi digitado.
      backdrop.addEventListener("mousedown", (ev) => { if (ev.target === backdrop) fechar(); });

      document.getElementById("modal-root").appendChild(frag);
      aberto = document.querySelector("#modal-root .modal-backdrop");
      document.addEventListener("keydown", aoTeclar, true);
      const primeiro = aberto.querySelector("input, select, textarea, button");
      if (primeiro) primeiro.focus();
      return aberto;
    }

    return { abrir, fechar, estaAberto: () => !!aberto };
  })();

  // ===========================================================================
  // Máscaras
  // ===========================================================================
  /** Formata no blur, não a cada tecla: reescrever enquanto se digita joga o cursor. */
  function ligarMascaraDinheiro(input) {
    input.addEventListener("blur", () => {
      const n = Fmt.paraNumero(input.value);
      input.value = n == null ? "" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    });
  }
  function ligarMascaraCnpj(input) {
    input.addEventListener("input", () => { input.value = Fmt.cnpj(input.value); });
  }

  // ===========================================================================
  // Autocomplete (cliente e serviço), com "criar novo" na própria lista.
  // ===========================================================================
  function ligarAutocomplete(cfg) {
    const { input, hidden, lista } = cfg;
    let itens = [];
    let ativo = -1;

    const idLista = `ac-${cfg.nome}`;
    lista.id = idLista;
    lista.setAttribute("role", "listbox");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", idLista);
    input.setAttribute("aria-expanded", "false");

    function pintar() {
      const linhas = itens.map((it, i) => `
        <div class="ac-item" role="option" id="${idLista}-${i}" data-i="${i}" aria-selected="${i === ativo}">
          <strong>${Fmt.esc(cfg.rotulo(it))}</strong>
          <small>${Fmt.esc(cfg.sublinha(it))}</small>
        </div>`).join("");
      const iNovo = itens.length;
      const novo = `
        <div class="ac-item ac-novo" role="option" id="${idLista}-${iNovo}" data-i="${iNovo}" aria-selected="${ativo === iNovo}">
          + ${Fmt.esc(cfg.rotuloNovo(input.value))}
        </div>`;
      const vazio = itens.length ? "" : `<div class="ac-vazio">Nada encontrado com esse texto.</div>`;
      lista.innerHTML = linhas + vazio + novo;
      const marcado = ativo >= 0 ? `${idLista}-${ativo}` : "";
      if (marcado) input.setAttribute("aria-activedescendant", marcado);
      else input.removeAttribute("aria-activedescendant");
    }

    function abrir() {
      itens = cfg.buscar(input.value);
      ativo = -1;
      lista.hidden = false;
      input.setAttribute("aria-expanded", "true");
      pintar();
    }

    function fechar() {
      lista.hidden = true;
      ativo = -1;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function escolher(i) {
      if (i === itens.length) { fechar(); cfg.aoCriar(input.value); return; }
      const item = itens[i];
      if (!item) return;
      fechar();
      cfg.aoEscolher(item);
    }

    input.addEventListener("focus", abrir);
    input.addEventListener("input", () => {
      // Texto mudou ⇒ a escolha anterior não vale mais. Manter o id enquanto o
      // texto diz outra coisa emitiria nota para o cliente errado.
      if (hidden.value) { hidden.value = ""; if (cfg.aoLimpar) cfg.aoLimpar(); }
      abrir();
    });
    input.addEventListener("blur", fechar);
    input.addEventListener("keydown", (ev) => {
      if (lista.hidden && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) { abrir(); return; }
      if (lista.hidden) return;
      const total = itens.length + 1;
      if (ev.key === "ArrowDown") { ev.preventDefault(); ativo = (ativo + 1) % total; pintar(); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); ativo = (ativo - 1 + total) % total; pintar(); }
      else if (ev.key === "Enter") {
        if (ativo >= 0) { ev.preventDefault(); escolher(ativo); }
        else if (itens.length === 1) { ev.preventDefault(); escolher(0); }
      } else if (ev.key === "Escape") { fechar(); }
    });

    // mousedown antes do blur: sem o preventDefault o campo perde o foco e a
    // lista fecha antes do clique chegar.
    lista.addEventListener("mousedown", (ev) => ev.preventDefault());
    lista.addEventListener("click", (ev) => {
      const item = ev.target.closest("[data-i]");
      if (item) escolher(Number(item.dataset.i));
    });

    return { abrir, fechar };
  }

  // ===========================================================================
  // TELA: painel
  // ===========================================================================
  function telaPainel() {
    const frag = tpl("tpl-painel");
    const raiz = frag.querySelector("[data-page]");
    const ref = Fmt.refDeHoje();

    // --- Precisa de ação: o que está parado esperando alguém.
    const pendentes = Store.filtrarNotas({}).filter(
      (n) => n.status === "rascunho" || n.status === "rejeitada" || n.status === "processando"
    );
    const ul = raiz.querySelector('[data-list="pendencias"]');
    ul.innerHTML = pendentes.length
      ? pendentes.map((n) => `
          <li>
            ${chipHtml(n.status)}
            <a href="#/notas/${Fmt.esc(n.id)}">${Fmt.esc(nomeCliente(n.clienteId))}</a>
            — ${Fmt.esc(Fmt.dinheiro(n.valor))}
          </li>`).join("")
      : `<li class="hint">Nada parado. Nenhuma nota aguarda ação.</li>`;

    // --- Este mês
    const doMes = Store.filtrarNotas({ periodo: ref });
    const emitidas = doMes.filter((n) => n.status === "emitida");
    const soma = (arr, campo) => arr.reduce((t, n) => t + (n[campo] || 0), 0);
    const dl = raiz.querySelector('[data-list="resumo"]');
    dl.innerHTML = `
      <dt>Referência</dt><dd>${Fmt.esc(Fmt.referencia(ref))}</dd>
      <dt>Notas emitidas</dt><dd>${emitidas.length}</dd>
      <dt>Faturado</dt><dd>${Fmt.esc(emitidas.length ? Fmt.dinheiro(soma(emitidas, "valor")) : Fmt.dinheiro(null))}</dd>
      <dt>Líquido</dt><dd>${Fmt.esc(emitidas.length ? Fmt.dinheiro(soma(emitidas, "liquido")) : Fmt.dinheiro(null))}</dd>
      <dt>Aguardando ação</dt><dd>${pendentes.length}</dd>`;

    // --- Recorrências desta semana (7 dias a partir de hoje)
    const hoje = new Date();
    const diaHoje = hoje.getDate();
    const daSemana = Store.state.recorrencias.filter(
      (r) => r.ativa && r.diaDoMes >= diaHoje && r.diaDoMes <= diaHoje + 7
    );
    const ulRec = raiz.querySelector('[data-list="recorrencias"]');
    ulRec.innerHTML = daSemana.length
      ? daSemana.map((r) => `
          <li>
            dia ${Fmt.esc(String(r.diaDoMes))} — ${Fmt.esc(nomeCliente(r.clienteId))}
            <span class="origem-id">${Fmt.esc(Fmt.aplicarVariaveis(r.descricao, ref))} · ${Fmt.esc(Fmt.dinheiro(r.valor))}</span>
          </li>`).join("")
      : `<li class="hint">Nenhuma recorrência nos próximos 7 dias.</li>`;

    // TODO(Fase 3): emitir recorrentes é a tela de revisão do mês (tpl-revisao-mes).
    raiz.querySelector('[data-action="emitir-recorrentes"]').addEventListener("click", () => {
      Store.toast("Recorrências chegam na Fase 3 — este botão ainda não emite nada.", "aviso");
    });

    return { no: frag };
  }

  // ===========================================================================
  // TELA: lista de notas
  // ===========================================================================
  function telaNotas() {
    const frag = tpl("tpl-notas-lista");
    const raiz = frag.querySelector("[data-page]");
    const filtros = raiz.querySelector('[data-form="filtros-notas"]');
    const tbody = raiz.querySelector("tbody");
    const vazio = raiz.querySelector("[data-empty]");
    const barra = raiz.querySelector("[data-bulk]");
    const contador = raiz.querySelector("[data-bulk-count]");
    const selecionarTodas = raiz.querySelector("[data-select-all]");

    // Seleção não sobrevive à troca de tela: agir em massa sobre nota que saiu
    // do filtro é o tipo de erro que ninguém percebe até ser tarde.
    Store.limparSelecao();

    const selectCliente = filtros.elements.clienteId;
    Store.state.clientes
      .slice()
      .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial, "pt-BR"))
      .forEach((c) => {
        const op = criar("option", null, c.razaoSocial);
        op.value = c.id;
        selectCliente.appendChild(op);
      });

    const atuais = Store.state.ui.filtrosNotas;
    filtros.elements.periodo.value = atuais.periodo || "";
    filtros.elements.clienteId.value = atuais.clienteId || "";
    filtros.elements.status.value = atuais.status || "";
    filtros.elements.origem.value = atuais.origem || "";

    let visiveis = [];

    function linha(n) {
      const cliente = Store.clientePorId(n.clienteId);
      return `
        <tr data-id="${Fmt.esc(n.id)}">
          <td><input type="checkbox" data-select="${Fmt.esc(n.id)}"
                     aria-label="Selecionar nota de ${Fmt.esc(cliente ? cliente.razaoSocial : "cliente")}"></td>
          <td>${n.numero ? Fmt.esc(n.numero) : "—"}</td>
          <td>${Fmt.esc(cliente ? cliente.razaoSocial : "—")}
              <span class="origem-id">${Fmt.esc(cliente ? Fmt.cnpj(cliente.cnpj) : "")}</span></td>
          <td class="col-desc"><span class="truncar" title="${Fmt.esc(n.descricao)}">${Fmt.esc(n.descricao)}</span></td>
          <td class="num">${Fmt.esc(Fmt.dinheiro(n.valor))}</td>
          <td>${Fmt.esc(n.emitidaEm ? Fmt.data(n.emitidaEm) : Fmt.referencia(n.referencia))}</td>
          <td>${origemHtml(n)}</td>
          <td>${chipHtml(n.status)}</td>
          <td><a href="#/notas/${Fmt.esc(n.id)}">Abrir</a></td>
        </tr>`;
    }

    function atualizarBarra() {
      const n = Store.selecionadas().length;
      barra.hidden = n === 0;
      contador.textContent = String(n);
      const total = visiveis.length;
      selecionarTodas.checked = total > 0 && n === total;
      selecionarTodas.indeterminate = n > 0 && n < total;
    }

    function pintar() {
      visiveis = Store.filtrarNotas(Store.state.ui.filtrosNotas);
      tbody.innerHTML = visiveis.map(linha).join("");
      vazio.hidden = visiveis.length > 0;
      const marcadas = Store.selecionadas();
      tbody.querySelectorAll("[data-select]").forEach((cb) => {
        cb.checked = marcadas.includes(cb.dataset.select);
      });
      atualizarBarra();
    }

    filtros.addEventListener("change", () => {
      Store.limparSelecao();
      Store.setFiltrosNotas({
        periodo: filtros.elements.periodo.value,
        clienteId: filtros.elements.clienteId.value,
        status: filtros.elements.status.value,
        origem: filtros.elements.origem.value,
      });
      pintar();
    });
    filtros.addEventListener("submit", (ev) => ev.preventDefault());

    tbody.addEventListener("change", (ev) => {
      const cb = ev.target.closest("[data-select]");
      if (!cb) return;
      Store.alternarSelecao(cb.dataset.select, cb.checked);
      atualizarBarra();
    });

    selecionarTodas.addEventListener("change", () => {
      Store.definirSelecao(selecionarTodas.checked ? visiveis.map((n) => n.id) : []);
      pintar();
    });

    raiz.querySelector('[data-action="bulk-baixar"]').addEventListener("click", () => {
      const ids = Store.selecionadas();
      const n = Store.baixarArquivos(ids, "pdf/xml");
      Store.toast(n
        ? `${n} arquivo(s) fictício(s) — o protótipo não gera PDF nem XML.`
        : "Nenhuma nota selecionada tem número para baixar.", n ? "info" : "aviso");
      pintar();
    });

    raiz.querySelector('[data-action="bulk-enviar"]').addEventListener("click", () => {
      const ids = Store.selecionadas();
      const n = Store.enviarPorEmail(ids);
      Store.toast(n
        ? `${n} nota(s) marcada(s) como enviada(s). Nenhum e-mail sai deste protótipo.`
        : "Só nota emitida pode ser enviada.", n ? "sucesso" : "aviso");
      pintar();
    });

    raiz.querySelector('[data-action="bulk-cancelar"]').addEventListener("click", () => {
      const ids = Store.selecionadas();
      const canceláveis = ids.filter((id) => {
        const n = Store.notaPorId(id);
        return n && n.status === "emitida";
      });
      Modal.abrir({
        titulo: `Cancelar ${canceláveis.length} nota(s)?`,
        corpoHtml: `
          <p>${canceláveis.length} de ${ids.length} selecionada(s) estão emitidas e podem ser canceladas.
          As demais ficam como estão.</p>
          <label>Motivo do cancelamento
            <input name="motivo" placeholder="Ex.: serviço não executado">
          </label>
          <p class="hint">Cancelamento é definitivo — no protótipo ele só muda o estado da lista.</p>`,
        acoes: [
          { rotulo: "Voltar", aoClicar: () => Modal.fechar() },
          {
            rotulo: "Cancelar notas", perigo: true,
            aoClicar: (corpo) => {
              const motivo = corpo.querySelector('[name="motivo"]').value.trim();
              let ok = 0;
              canceláveis.forEach((id) => { if (Store.cancelarNota(id, motivo).ok) ok += 1; });
              Modal.fechar();
              Store.limparSelecao();
              Store.toast(`${ok} nota(s) cancelada(s).`, ok ? "sucesso" : "aviso");
              pintar();
            },
          },
        ],
      });
    });

    return { no: frag, aoMontar: () => { pintar(); refrescarNotas = pintar; } };
  }

  // ===========================================================================
  // TELA: nova nota / editar rascunho / corrigir rejeitada
  // ===========================================================================
  function telaNotaForm(params) {
    const frag = tpl("tpl-nota-form");
    const raiz = frag.querySelector("[data-page]");
    const form = raiz.querySelector('[data-form="nota"]');
    const el = form.elements;
    const referencia = Fmt.refDeHoje();

    const notaBase = params.id ? Store.notaPorId(params.id) : null;
    // Só rascunho e rejeitada voltam para o formulário. Nota emitida é fato
    // consumado: para mudar, cancela-se e emite-se outra.
    const editavel = notaBase && (notaBase.status === "rascunho" || notaBase.status === "rejeitada");
    const prefill = notaBase && editavel ? notaBase : prefillPendente;
    prefillPendente = null;

    // --- Áreas que o HTML do dono não previa; acrescentadas, nada renomeado.
    const aviso = criar("div");
    form.insertBefore(aviso, form.querySelector("fieldset"));
    const estado = criar("p", "estado-emissao");
    estado.setAttribute("aria-live", "polite");
    estado.hidden = true;
    form.querySelector(".form-actions").before(estado);

    const titulo = raiz.querySelector("[data-title]");
    if (notaBase && editavel) {
      titulo.textContent = notaBase.status === "rejeitada" ? "Corrigir e reemitir" : "Editar rascunho";
    }

    // ---------- leitura do formulário ----------
    const ler = () => ({
      id: notaBase && editavel ? notaBase.id : null,
      clienteId: el.clienteId.value || null,
      servicoId: el.servicoId.value || null,
      valor: Fmt.paraNumero(el.valor.value),
      descricao: el.descricao.value,
      observacoes: el.observacoes.value,
      enviarEmail: el.enviarEmail.checked,
      referencia,
    });

    // ---------- resumo do cliente (e-mail + retenções, sem digitar nada) ----------
    const resumoCliente = raiz.querySelector("[data-cliente-resumo]");
    function pintarResumoCliente(cliente) {
      if (!cliente) { resumoCliente.textContent = "Escolha o cliente: e-mail e retenções vêm do cadastro."; return; }
      const retencoes = RETENCOES.filter(([k]) => Number(cliente.retencoes[k]) > 0)
        .map(([k, r]) => `${r} ${Fmt.pct(cliente.retencoes[k])}`).join(" · ");
      resumoCliente.textContent =
        `${Fmt.cnpj(cliente.cnpj)} · ${cliente.email || "sem e-mail no cadastro"} · ` +
        (retencoes ? `retenções: ${retencoes}` : "sem retenções no cadastro");
    }

    // ---------- impostos + preview ----------
    const dlImpostos = raiz.querySelector('[data-list="impostos"]');
    const liquidoEl = raiz.querySelector("[data-liquido]");
    const prev = (nome) => raiz.querySelector(`[data-preview="${nome}"]`);

    function pintar() {
      const d = ler();
      const cliente = Store.clientePorId(d.clienteId);
      const servico = Store.servicoPorId(d.servicoId);
      const imp = Store.calcularPrevia(d);
      const descricao = Fmt.aplicarVariaveis(d.descricao || (servico ? servico.descricao : ""), referencia);

      // --- lista de impostos do formulário
      const linhas = [];
      if (servico) {
        linhas.push(`<dt>ISS <span class="origem-id">${Fmt.esc(Fmt.pct(servico.aliquotaIss))} · não sai do líquido</span></dt>
                     <dd>${Fmt.esc(Fmt.dinheiro(imp ? imp.iss : null))}</dd>`);
      } else {
        linhas.push(`<dt>ISS</dt><dd>${Fmt.esc(Fmt.dinheiro(null))}</dd>`);
      }
      if (cliente) {
        const comRetencao = RETENCOES.filter(([k]) => Number(cliente.retencoes[k]) > 0);
        if (comRetencao.length) {
          comRetencao.forEach(([k, r]) => {
            linhas.push(`<dt>${Fmt.esc(r)} <span class="origem-id">${Fmt.esc(Fmt.pct(cliente.retencoes[k]))}</span></dt>
                         <dd>${Fmt.esc(Fmt.dinheiro(imp ? imp[k] : null))}</dd>`);
          });
          linhas.push(`<dt class="linha-total">Total retido</dt>
                       <dd class="linha-total destaque">${Fmt.esc(Fmt.dinheiro(imp ? imp.retido : null))}</dd>`);
        } else {
          // O cadastro AFIRMA que não há retenção — isso não é ausência de dado.
          linhas.push(`<dt>Retenções</dt><dd>nenhuma no cadastro</dd>`);
        }
      } else {
        linhas.push(`<dt>Retenções</dt><dd>escolha o cliente</dd>`);
      }
      dlImpostos.innerHTML = linhas.join("");
      liquidoEl.textContent = Fmt.dinheiro(imp ? imp.liquido : null);

      // --- pré-visualização
      const empresa = Store.state.empresa;
      prev("emitente").innerHTML =
        `<strong>${Fmt.esc(empresa.razaoSocial)}</strong>
         <span class="origem-id">${Fmt.esc(Fmt.cnpj(empresa.cnpj))} · IM ${Fmt.esc(empresa.im)}</span>`;

      // ⚠ Número só nasce na emissão — o preview não inventa um.
      prev("numero").innerHTML =
        `Nº —<span class="origem-id">${Fmt.esc(Fmt.referencia(referencia))}</span>`;

      prev("tomador").innerHTML = cliente
        ? `<strong>${Fmt.esc(cliente.razaoSocial)}</strong>
           <div class="origem-id">${Fmt.esc(cliente.cnpj ? Fmt.cnpj(cliente.cnpj) : "CNPJ não informado")}</div>
           ${enderecoLinha(cliente)}
           <div class="origem-id">${Fmt.esc(cliente.email || "sem e-mail no cadastro")}</div>`
        : `<span class="vazio">Nenhum cliente escolhido.</span>`;

      prev("servico").innerHTML = servico || descricao
        ? `<div>${Fmt.esc(descricao) || '<span class="vazio">Sem descrição.</span>'}</div>
           ${servico ? `<div class="origem-id">Código municipal ${Fmt.esc(servico.codigoMunicipal)} · ISS ${Fmt.esc(Fmt.pct(servico.aliquotaIss))}</div>` : ""}`
        : `<span class="vazio">Nenhum serviço escolhido.</span>`;

      const tr = [];
      tr.push(`<tr><td>Valor do serviço</td><td>${Fmt.esc(Fmt.dinheiro(d.valor))}</td></tr>`);
      if (servico) {
        tr.push(`<tr class="linha-info"><td>ISS ${Fmt.esc(Fmt.pct(servico.aliquotaIss))} (não retido)</td>
                 <td>${Fmt.esc(Fmt.dinheiro(imp ? imp.iss : null))}</td></tr>`);
      }
      if (cliente) {
        RETENCOES.filter(([k]) => Number(cliente.retencoes[k]) > 0).forEach(([k, r]) => {
          tr.push(`<tr><td>${Fmt.esc(r)} ${Fmt.esc(Fmt.pct(cliente.retencoes[k]))}</td>
                   <td>${Fmt.esc(imp ? Fmt.dinheiro(-imp[k]) : Fmt.dinheiro(null))}</td></tr>`);
        });
      }
      tr.push(`<tr class="linha-total"><td>Líquido</td>
               <td>${Fmt.esc(Fmt.dinheiro(imp ? imp.liquido : null))}</td></tr>`);
      prev("valores").innerHTML = tr.join("");

      prev("observacoes").textContent = d.observacoes || "";
    }

    // Qualquer tecla, marcação ou colagem repinta. Sem recarregar nada.
    form.addEventListener("input", pintar);
    form.addEventListener("change", pintar);

    // ---------- autocomplete: cliente ----------
    const acCliente = ligarAutocomplete({
      nome: "cliente",
      input: el.clienteBusca,
      hidden: el.clienteId,
      lista: raiz.querySelector('[data-autocomplete-list="cliente"]'),
      buscar: (termo) => {
        const t = String(termo || "").trim().toLowerCase();
        const d = Fmt.soDigitos(t);
        return Store.state.clientes.filter((c) =>
          !t || c.razaoSocial.toLowerCase().includes(t) || (d && Fmt.soDigitos(c.cnpj).includes(d))
        ).slice(0, 8);
      },
      rotulo: (c) => c.razaoSocial,
      sublinha: (c) => `${Fmt.cnpj(c.cnpj)} · ${c.email || "sem e-mail"}`,
      rotuloNovo: (t) => (t.trim() ? `Criar cliente "${t.trim()}"` : "Criar novo cliente"),
      aoLimpar: () => { pintarResumoCliente(null); pintar(); },
      aoEscolher: (c) => {
        el.clienteBusca.value = c.razaoSocial;
        el.clienteId.value = c.id;
        pintarResumoCliente(c);
        pintar();
        // Menos interações até emitir: o próximo campo já abre a lista.
        el.servicoBusca.focus();
      },
      aoCriar: (texto) => abrirModalCliente(texto, (c) => {
        el.clienteBusca.value = c.razaoSocial;
        el.clienteId.value = c.id;
        pintarResumoCliente(c);
        pintar();
        el.servicoBusca.focus();
      }),
    });

    // ---------- autocomplete: serviço ----------
    let descricaoAutomatica = "";
    ligarAutocomplete({
      nome: "servico",
      input: el.servicoBusca,
      hidden: el.servicoId,
      lista: raiz.querySelector('[data-autocomplete-list="servico"]'),
      buscar: (termo) => {
        const t = String(termo || "").trim().toLowerCase();
        return Store.state.servicos.filter((s) =>
          !t || s.descricao.toLowerCase().includes(t) || s.codigoMunicipal.includes(t)
        ).slice(0, 8);
      },
      rotulo: (s) => s.descricao,
      sublinha: (s) => `Código ${s.codigoMunicipal} · ISS ${Fmt.pct(s.aliquotaIss)} · ${Fmt.dinheiro(s.valorPadrao)}`,
      rotuloNovo: (t) => (t.trim() ? `Criar serviço "${t.trim()}"` : "Criar novo serviço"),
      aoLimpar: pintar,
      aoEscolher: (s) => { aplicarServico(s); pintar(); },
      aoCriar: (texto) => abrirModalServico(texto, (s) => { aplicarServico(s); pintar(); }),
    });

    function aplicarServico(s) {
      el.servicoBusca.value = s.descricao;
      el.servicoId.value = s.id;
      // Preenche o que estiver vazio (ou o que este mesmo automatismo escreveu).
      // Texto digitado pelo contador nunca é sobrescrito.
      if (!el.descricao.value.trim() || el.descricao.value === descricaoAutomatica) {
        descricaoAutomatica = `${s.descricao} — {mes/ano}`;
        el.descricao.value = descricaoAutomatica;
      }
      if (!el.valor.value.trim() && s.valorPadrao != null) {
        el.valor.value = s.valorPadrao.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }

    ligarMascaraDinheiro(el.valor);

    // ---------- prefill ----------
    if (prefill) {
      const c = Store.clientePorId(prefill.clienteId);
      const s = Store.servicoPorId(prefill.servicoId);
      if (c) { el.clienteBusca.value = c.razaoSocial; el.clienteId.value = c.id; }
      if (s) { el.servicoBusca.value = s.descricao; el.servicoId.value = s.id; }
      if (prefill.valor != null) {
        el.valor.value = prefill.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      el.descricao.value = prefill.descricao || "";
      el.observacoes.value = prefill.observacoes || "";
      el.enviarEmail.checked = prefill.enviarEmail !== false;
      pintarResumoCliente(c);
    } else {
      pintarResumoCliente(null);
    }

    // ---------- rejeição herdada (veio do detalhe da nota) ----------
    if (notaBase && notaBase.status === "rejeitada" && notaBase.motivoRejeicao) {
      mostrarRejeicao(notaBase.motivoRejeicao);
    }

    function campoDoErro(campo) {
      if (!campo) return null;
      const mapa = { clienteId: "clienteBusca", servicoId: "servicoBusca", valor: "valor" };
      return el[mapa[campo] || campo] || null;
    }

    function mostrarRejeicao(erro) {
      aviso.innerHTML = `
        <div class="alerta alerta-erro" role="alert">
          <strong>Rejeitada pela prefeitura</strong>
          <p>${Fmt.esc(erro.mensagem)}</p>
          <p><strong>O que fazer:</strong> ${Fmt.esc(erro.acao)}</p>
          <div class="acoes">
            <button type="button" class="btn" data-acao="corrigir">
              ${erro.campo ? "Ir para o campo" : "Tentar novamente"}
            </button>
          </div>
          <details><summary>Detalhe técnico</summary><p>Código ${Fmt.esc(erro.codigo)}</p></details>
        </div>`;
      aviso.querySelector('[data-acao="corrigir"]').addEventListener("click", () => {
        const campo = campoDoErro(erro.campo);
        if (campo) {
          campo.classList.add("campo-erro");
          campo.scrollIntoView({ block: "center" });
          campo.focus();
        } else {
          // E500 e afins não têm campo: o que fazer é reenviar.
          form.querySelector('[data-action="emitir"]').focus();
        }
      });
    }

    function mostrarProblema(problema) {
      aviso.innerHTML = `
        <div class="alerta alerta-aviso" role="alert">
          <strong>Falta preencher</strong>
          <p>${Fmt.esc(problema.mensagem)}</p>
        </div>`;
      const campo = campoDoErro(problema.campo);
      if (campo) { campo.classList.add("campo-erro"); campo.focus(); }
    }

    function validar(d) {
      if (!d.clienteId) return { campo: "clienteId", mensagem: "Escolha o cliente — toda nota precisa de um tomador." };
      if (!d.servicoId) return { campo: "servicoId", mensagem: "Escolha o serviço — ele define o código municipal e o ISS." };
      if (d.valor == null) return { campo: "valor", mensagem: "Informe o valor do serviço." };
      if (d.valor <= 0) return { campo: "valor", mensagem: "O valor precisa ser maior que zero." };
      return null;
    }

    // ---------- ações ----------
    form.querySelector('[data-action="salvar-rascunho"]').addEventListener("click", () => {
      const d = ler();
      if (!d.clienteId) { mostrarProblema({ campo: "clienteId", mensagem: "Mesmo rascunho precisa saber para quem é." }); return; }
      const nota = Store.salvarRascunho(d);
      location.hash = `#/notas/${nota.id}`;
    });

    // TODO(Fase 2): modelo de nota é cadastro reaproveitável, não existe em data.js.
    form.querySelector('[data-action="salvar-modelo"]').addEventListener("click", () => {
      Store.toast("Modelos chegam na Fase 2 — nada foi salvo.", "aviso");
    });

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      form.querySelectorAll(".campo-erro").forEach((c) => c.classList.remove("campo-erro"));
      const d = ler();
      const problema = validar(d);
      if (problema) { mostrarProblema(problema); return; }

      aviso.innerHTML = "";
      const botoes = form.querySelectorAll("button");
      botoes.forEach((b) => { b.disabled = true; });
      estado.hidden = false;
      estado.textContent = "Enviando para a prefeitura… (simulado, nada sai desta máquina)";

      const nota = d.id ? Store.atualizarNota(d.id, d) : Store.criarNota(d);
      Store.emitirNota(nota).then((n) => {
        botoes.forEach((b) => { b.disabled = false; });
        estado.hidden = true;
        if (n.status === "emitida") {
          location.hash = `#/notas/${n.id}/sucesso`;
        } else {
          mostrarRejeicao(n.motivoRejeicao);
          Store.toast(`Nota rejeitada — ${n.motivoRejeicao.codigo}.`, "erro");
          aviso.scrollIntoView({ block: "nearest" });
        }
      });
    });

    return {
      no: frag,
      aoMontar: () => {
        pintar();
        // Foco no primeiro campo: a lista abre junto e a emissão fica a 3 cliques.
        el.clienteBusca.focus();
        acCliente.abrir();
      },
    };
  }

  // ---------- modais de cadastro rápido ----------
  function abrirModalCliente(texto, aoSalvar) {
    Modal.abrir({
      titulo: "Novo cliente",
      corpoHtml: `
        <label>Razão social <input name="razaoSocial" value="${Fmt.esc(texto.trim())}" required></label>
        <label>CNPJ <input name="cnpj" inputmode="numeric" placeholder="00.000.000/0000-00"></label>
        <label>E-mail para envio <input name="email" type="email"></label>
        <fieldset>
          <legend>Retenções padrão (%)</legend>
          <div class="grid-retencoes">
            ${RETENCOES.map(([k, r]) =>
              `<label>${r} <input name="${k}" type="number" step="0.01" min="0" value="0"></label>`).join("")}
          </div>
          <small class="hint">Zero aqui é afirmação: "este tomador não retém".</small>
        </fieldset>`,
      acoes: [
        { rotulo: "Cancelar", aoClicar: () => Modal.fechar() },
        {
          rotulo: "Criar cliente", primaria: true,
          aoClicar: (corpo) => {
            const v = (n) => corpo.querySelector(`[name="${n}"]`).value;
            if (!v("razaoSocial").trim()) {
              Store.toast("Razão social é obrigatória.", "erro");
              corpo.querySelector('[name="razaoSocial"]').focus();
              return;
            }
            const cliente = Store.criarCliente({
              razaoSocial: v("razaoSocial"), cnpj: v("cnpj"), email: v("email"),
              irrf: v("irrf"), pis: v("pis"), cofins: v("cofins"), csll: v("csll"), inss: v("inss"),
            });
            Modal.fechar();
            Store.toast(`Cliente ${cliente.razaoSocial} criado.`, "sucesso");
            aoSalvar(cliente);
          },
        },
      ],
    });
    const campo = document.querySelector('#modal-root [name="cnpj"]');
    if (campo) ligarMascaraCnpj(campo);
  }

  function abrirModalServico(texto, aoSalvar) {
    Modal.abrir({
      titulo: "Novo serviço",
      corpoHtml: `
        <label>Descrição <input name="descricao" value="${Fmt.esc(texto.trim())}" required></label>
        <label>Código municipal <input name="codigoMunicipal" inputmode="numeric"></label>
        <label>Alíquota de ISS (%) <input name="aliquotaIss" type="number" step="0.01" min="0" value="5"></label>
        <label>Valor padrão <input name="valorPadrao" inputmode="decimal" placeholder="opcional"></label>
        <p class="hint">Valor padrão em branco fica em branco — o formulário não inventa um número.</p>`,
      acoes: [
        { rotulo: "Cancelar", aoClicar: () => Modal.fechar() },
        {
          rotulo: "Criar serviço", primaria: true,
          aoClicar: (corpo) => {
            const v = (n) => corpo.querySelector(`[name="${n}"]`).value;
            if (!v("descricao").trim()) {
              Store.toast("Descrição é obrigatória.", "erro");
              corpo.querySelector('[name="descricao"]').focus();
              return;
            }
            const servico = Store.criarServico({
              descricao: v("descricao"), codigoMunicipal: v("codigoMunicipal"),
              aliquotaIss: v("aliquotaIss"), valorPadrao: v("valorPadrao"),
            });
            Modal.fechar();
            Store.toast(`Serviço ${servico.descricao} criado.`, "sucesso");
            aoSalvar(servico);
          },
        },
      ],
    });
  }

  // ===========================================================================
  // TELA: sucesso
  // ===========================================================================
  function telaSucesso(id) {
    const nota = Store.notaPorId(id);
    if (!nota) return telaNaoEncontrada("Nota não encontrada.");
    // Esta tela AFIRMA "emitida" no título. Alcançada por link velho ou URL colada
    // sobre uma nota cancelada/rascunho, a afirmação seria falsa — mostra-se o
    // detalhe, que diz o estado real.
    if (nota.status !== "emitida") {
      history.replaceState(null, "", `#/notas/${nota.id}`);
      return telaDetalhe(nota.id);
    }
    const frag = tpl("tpl-nota-sucesso");
    const raiz = frag.querySelector("[data-page]");
    const cliente = Store.clientePorId(nota.clienteId);

    raiz.querySelector("[data-numero]").textContent = nota.numero || "—";
    raiz.querySelector("[data-resumo]").textContent =
      `${cliente ? cliente.razaoSocial : "—"} · ${Fmt.dinheiro(nota.valor)} · ` +
      `líquido ${Fmt.dinheiro(nota.liquido)} · emitida em ${Fmt.data(nota.emitidaEm)}` +
      (nota.emailEnviadoEm
        ? ` · e-mail enviado para ${cliente ? cliente.email : "o cliente"}`
        : " · e-mail ainda não enviado");

    raiz.querySelector('[data-action="baixar-pdf"]').addEventListener("click", () => {
      Store.baixarArquivos([nota.id], "pdf");
      Store.toast("PDF fictício — este protótipo não gera arquivo.");
    });
    raiz.querySelector('[data-action="baixar-xml"]').addEventListener("click", () => {
      Store.baixarArquivos([nota.id], "xml");
      Store.toast("XML fictício — este protótipo não gera arquivo.");
    });
    raiz.querySelector('[data-action="enviar-email"]').addEventListener("click", () => {
      Store.enviarPorEmail([nota.id]);
      Store.toast(`Marcada como enviada para ${cliente ? cliente.email : "o cliente"}. Nenhum e-mail saiu daqui.`, "sucesso");
    });
    raiz.querySelector('[data-action="duplicar"]').addEventListener("click", () => {
      prefillPendente = {
        clienteId: nota.clienteId, servicoId: nota.servicoId, valor: nota.valor,
        descricao: nota.descricao, observacoes: nota.observacoes, enviarEmail: nota.enviarEmail,
      };
      location.hash = "#/notas/nova";
    });

    const acoes = raiz.querySelector(".actions");
    const verDetalhe = criar("a", "btn", "Ver detalhe");
    verDetalhe.href = `#/notas/${nota.id}`;
    acoes.insertBefore(verDetalhe, acoes.lastElementChild);

    return { no: frag };
  }

  // ===========================================================================
  // TELA: detalhe da nota
  // ===========================================================================
  function telaDetalhe(id) {
    const nota = Store.notaPorId(id);
    if (!nota) return telaNaoEncontrada("Nota não encontrada.");
    const frag = tpl("tpl-nota-detalhe");
    const raiz = frag.querySelector("[data-page]");
    const cliente = Store.clientePorId(nota.clienteId);
    const servico = Store.servicoPorId(nota.servicoId);
    const imp = nota.impostos;

    // ⚠ Rascunho não tem número — a tela mostra o estado, não um número falso.
    raiz.querySelector("[data-numero]").textContent = nota.numero || "sem número (rascunho)";
    raiz.querySelector("[data-chip]").replaceWith(chipEl(nota.status));

    raiz.querySelector('[data-list="dados"]').innerHTML = `
      <dt>Cliente</dt><dd>${Fmt.esc(cliente ? cliente.razaoSocial : "—")}</dd>
      <dt>CNPJ</dt><dd>${Fmt.esc(cliente ? Fmt.cnpj(cliente.cnpj) : "—")}</dd>
      <dt>Serviço</dt><dd>${Fmt.esc(servico ? `${servico.descricao} (${servico.codigoMunicipal})` : "—")}</dd>
      <dt>Descrição</dt><dd>${Fmt.esc(nota.descricao)}</dd>
      <dt>Referência</dt><dd>${Fmt.esc(Fmt.referencia(nota.referencia))}</dd>
      <dt>Origem</dt><dd>${Fmt.esc(origemTexto(nota))}</dd>
      <dt>Emitida em</dt><dd>${Fmt.esc(nota.emitidaEm ? Fmt.data(nota.emitidaEm) : "—")}</dd>
      ${nota.canceladaEm ? `<dt>Cancelada em</dt><dd>${Fmt.esc(Fmt.data(nota.canceladaEm))}</dd>` : ""}
      <dt>E-mail</dt><dd>${nota.emailEnviadoEm
        ? `enviado em ${Fmt.esc(Fmt.data(nota.emailEnviadoEm))}`
        : "não enviado"}</dd>`;

    const valores = [`<dt>Valor do serviço</dt><dd>${Fmt.esc(Fmt.dinheiro(nota.valor))}</dd>`];
    if (servico) {
      valores.push(`<dt>ISS <span class="origem-id">${Fmt.esc(Fmt.pct(servico.aliquotaIss))} · não retido</span></dt>
                    <dd>${Fmt.esc(Fmt.dinheiro(imp ? imp.iss : null))}</dd>`);
    }
    if (cliente) {
      RETENCOES.filter(([k]) => Number(cliente.retencoes[k]) > 0).forEach(([k, r]) => {
        valores.push(`<dt>${Fmt.esc(r)} <span class="origem-id">${Fmt.esc(Fmt.pct(cliente.retencoes[k]))}</span></dt>
                      <dd>${Fmt.esc(Fmt.dinheiro(imp ? imp[k] : null))}</dd>`);
      });
      valores.push(`<dt class="linha-total">Total retido</dt>
                    <dd class="linha-total">${Fmt.esc(Fmt.dinheiro(imp ? imp.retido : null))}</dd>`);
    }
    valores.push(`<dt class="linha-total">Líquido</dt>
                  <dd class="linha-total destaque">${Fmt.esc(Fmt.dinheiro(nota.liquido))}</dd>`);
    raiz.querySelector('[data-list="valores"]').innerHTML = valores.join("");

    // --- rejeição: sempre diz o que fazer e leva ao campo certo
    if (nota.status === "rejeitada" && nota.motivoRejeicao) {
      const erro = nota.motivoRejeicao;
      const bloco = raiz.querySelector("[data-rejeicao]");
      bloco.innerHTML = `
        <div class="alerta alerta-erro" role="alert">
          <strong>Rejeitada pela prefeitura</strong>
          <p>${Fmt.esc(erro.mensagem)}</p>
          <p><strong>O que fazer:</strong> ${Fmt.esc(erro.acao)}</p>
          <div class="acoes"><button type="button" class="btn" data-acao="corrigir">
            ${erro.campo ? "Corrigir e reemitir" : "Tentar emitir de novo"}
          </button></div>
          <details><summary>Detalhe técnico</summary><p>Código ${Fmt.esc(erro.codigo)}</p></details>
        </div>`;
      bloco.querySelector('[data-acao="corrigir"]').addEventListener("click", () => {
        location.hash = `#/notas/${nota.id}/editar`;
      });
    }

    // --- histórico
    raiz.querySelector('[data-list="auditoria"]').innerHTML = (nota.auditoria || []).map((a) => `
      <li>
        <span class="quando">${Fmt.esc(Fmt.data(a.quando))} · ${Fmt.esc(a.quem)}</span>
        ${Fmt.esc(a.acao)}
      </li>`).join("");

    // --- ações conforme o estado
    const acoes = raiz.querySelector("[data-acoes]");
    const botao = (rotulo, classe, aoClicar) => {
      const b = criar("button", `btn${classe ? ` ${classe}` : ""}`, rotulo);
      b.type = "button";
      b.addEventListener("click", aoClicar);
      acoes.appendChild(b);
      return b;
    };

    if (nota.status === "rascunho") {
      botao("Continuar edição", "btn-primary", () => { location.hash = `#/notas/${nota.id}/editar`; });
    }
    if (nota.status === "emitida") {
      botao("PDF", null, () => { Store.baixarArquivos([nota.id], "pdf"); Store.toast("PDF fictício — este protótipo não gera arquivo."); });
      botao("XML", null, () => { Store.baixarArquivos([nota.id], "xml"); Store.toast("XML fictício — este protótipo não gera arquivo."); });
      botao("Enviar ao cliente", null, () => {
        Store.enviarPorEmail([nota.id]);
        Store.toast("Marcada como enviada. Nenhum e-mail saiu daqui.", "sucesso");
        render();
      });
      botao("Cancelar nota", "btn-danger", () => {
        Modal.abrir({
          titulo: `Cancelar a nota ${nota.numero}?`,
          corpoHtml: `<label>Motivo <input name="motivo" placeholder="Ex.: serviço não executado"></label>
                      <p class="hint">O cancelamento entra no histórico da nota.</p>`,
          acoes: [
            { rotulo: "Voltar", aoClicar: () => Modal.fechar() },
            {
              rotulo: "Cancelar nota", perigo: true,
              aoClicar: (corpo) => {
                const r = Store.cancelarNota(nota.id, corpo.querySelector('[name="motivo"]').value.trim());
                Modal.fechar();
                Store.toast(r.ok ? "Nota cancelada." : r.motivo, r.ok ? "sucesso" : "erro");
                render();
              },
            },
          ],
        });
      });
    }
    if (nota.status !== "rascunho") {
      botao("Emitir outra igual", null, () => {
        prefillPendente = {
          clienteId: nota.clienteId, servicoId: nota.servicoId, valor: nota.valor,
          descricao: nota.descricao, observacoes: nota.observacoes, enviarEmail: nota.enviarEmail,
        };
        location.hash = "#/notas/nova";
      });
    }
    if (nota.status === "processando") {
      const p = criar("p", "hint", "Aguardando retorno da prefeitura (simulado). Atualize a tela em instantes.");
      raiz.querySelector("[data-rejeicao]").appendChild(p);
    }

    return { no: frag };
  }

  // ===========================================================================
  // Telas ainda não construídas — só o título, e dizendo de que fase são.
  // ===========================================================================
  function telaPendente(titulo, fase) {
    const sec = criar("section", "page");
    sec.dataset.page = "pendente";
    sec.appendChild(criar("h1", null, titulo));
    // TODO: construir na fase indicada. Ver README, "Estado das fases".
    sec.appendChild(criar("p", "hint", `Tela da ${fase} — ainda não construída neste protótipo.`));
    return { no: sec };
  }

  function telaNaoEncontrada(mensagem) {
    const sec = criar("section", "page");
    sec.dataset.page = "nao-encontrada";
    sec.appendChild(criar("h1", null, "Não encontrado"));
    sec.appendChild(criar("p", "hint", mensagem || "Esse endereço não existe neste protótipo."));
    const a = criar("a", "btn", "Voltar para notas");
    a.href = "#/notas";
    sec.appendChild(a);
    return { no: sec };
  }

  // ===========================================================================
  // Roteador
  // ===========================================================================
  let prefillPendente = null;   // "emitir outra igual" atravessa a troca de rota
  let refrescarNotas = null;    // a busca global repinta a lista sem re-renderizar a tela

  const ROTAS = [
    { re: /^\/?$/,                       nav: "painel",       tela: () => telaPainel() },
    { re: /^\/notas$/,                   nav: "notas",        tela: () => telaNotas() },
    { re: /^\/notas\/nova$/,             nav: "notas",        tela: () => telaNotaForm({}) },
    { re: /^\/notas\/([^/]+)\/editar$/,  nav: "notas",        tela: (m) => telaNotaForm({ id: m[1] }) },
    { re: /^\/notas\/([^/]+)\/sucesso$/, nav: "notas",        tela: (m) => telaSucesso(m[1]) },
    { re: /^\/notas\/([^/]+)$/,          nav: "notas",        tela: (m) => telaDetalhe(m[1]) },
    { re: /^\/clientes$/,                nav: "clientes",     tela: () => telaPendente("Clientes", "Fase 2") },
    { re: /^\/servicos$/,                nav: "servicos",     tela: () => telaPendente("Serviços", "Fase 2") },
    { re: /^\/recorrencias$/,            nav: "recorrencias", tela: () => telaPendente("Recorrências", "Fase 3") },
    { re: /^\/lotes$/,                   nav: "lotes",        tela: () => telaPendente("Lotes", "Fase 4") },
    { re: /^\/config$/,                  nav: "config",       tela: () => telaPendente("Configurações", "Fase 5") },
  ];

  function caminhoAtual() {
    const h = location.hash.replace(/^#/, "");
    return h || "/";
  }

  function render() {
    const caminho = caminhoAtual();
    refrescarNotas = null;
    Modal.fechar();

    let resultado = null;
    let nav = null;
    for (const rota of ROTAS) {
      const m = caminho.match(rota.re);
      if (m) { resultado = rota.tela(m); nav = rota.nav; break; }
    }
    if (!resultado) resultado = telaNaoEncontrada();

    app.innerHTML = "";
    app.appendChild(resultado.no);

    // Toda tabela ganha um contêiner que rola: em 375px é o que impede a
    // página inteira de esticar para o lado.
    app.querySelectorAll("table.table").forEach((t) => {
      if (t.parentElement && t.parentElement.classList.contains("table-wrap")) return;
      const wrap = criar("div", "table-wrap");
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });

    document.querySelectorAll(".sidebar nav a").forEach((a) => {
      if (a.dataset.route === nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    if (resultado.aoMontar) resultado.aoMontar();
    // Se a tela não pediu foco para nenhum campo, o foco vai para o conteúdo —
    // sem isso quem navega por teclado continua no link anterior.
    if (document.activeElement === document.body) app.focus();
  }

  // ===========================================================================
  // Cascas globais
  // ===========================================================================
  function pintarBanner() {
    const banner = document.getElementById("banner-global");
    const dias = Store.diasParaVencerCertificado();
    if (dias == null || dias > 45) { banner.hidden = true; return; }
    const validade = Fmt.data(Store.state.empresa.certificadoValidade);
    banner.hidden = false;
    if (dias < 0) {
      banner.dataset.nivel = "perigo";
      banner.textContent = `Certificado A1 venceu em ${validade}. Sem ele não se emite nota.`;
    } else {
      banner.dataset.nivel = "aviso";
      banner.textContent = `Certificado A1 vence em ${validade} — faltam ${dias} dia(s).`;
    }
  }

  function ligarBuscaGlobal() {
    const campo = document.getElementById("busca-global");
    let timer = null;
    campo.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        Store.setFiltrosNotas({ busca: campo.value });
        if (caminhoAtual() === "/notas") { if (refrescarNotas) refrescarNotas(); }
        else location.hash = "#/notas";
      }, 200);
    });
  }

  function ligarAtalhos() {
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "n" && ev.key !== "N") return;
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      // ⚠ O atalho NÃO pode disparar enquanto se digita — "n" é uma letra antes
      // de ser um atalho.
      const alvo = document.activeElement;
      if (alvo && alvo.closest && alvo.closest("input, textarea, select, [contenteditable]")) return;
      if (Modal.estaAberto()) return;
      ev.preventDefault();
      location.hash = "#/notas/nova";
    });
  }

  function iniciar() {
    document.getElementById("empresa-nome").textContent = Store.state.empresa.razaoSocial;
    pintarBanner();
    ligarBuscaGlobal();
    ligarAtalhos();

    // Só o toast é global; cada tela decide quando se repinta (repintar tudo a
    // cada mudança mataria o foco no meio da digitação).
    Store.assinar((evento) => {
      if (evento && evento.tipo === "toast") mostrarToast(evento.toast);
    });

    // "Nova nota" existe na barra lateral e dentro das telas.
    document.addEventListener("click", (ev) => {
      const b = ev.target.closest('[data-action="nova-nota"]');
      if (b) { ev.preventDefault(); location.hash = "#/notas/nova"; }
      const imp = ev.target.closest('[data-action="importar-planilha"]');
      // TODO(Fase 4): tpl-lote-importar já existe; o fluxo ainda não.
      if (imp) { ev.preventDefault(); Store.toast("Importar planilha chega na Fase 4.", "aviso"); }
    });

    window.addEventListener("hashchange", render);
    render();
  }

  iniciar();
})();
