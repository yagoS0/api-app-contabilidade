// Calendário fiscal — visão do dashboard, ao lado de Cards e Ano.
//
// A referência de interação é o Google Calendar, e o que isso significa em decisões concretas:
//
//  • Cabeçalho fixo: ‹ › + "Hoje" + o período escrito, e o seletor Mês / Semana / Dia à direita.
//  • O mês SEMPRE ocupa 6 linhas, mesmo quando cabe em 5. Sem isso a grade muda de altura ao
//    navegar e a página "pula" — é o detalhe que mais faz um calendário caseiro parecer caseiro.
//  • Dias das semanas vizinhas aparecem apagados, não em branco: a semana não fica truncada.
//  • Evento é um chip compacto. Passando de 3 no dia, o excedente vira "+N" — dia com 8 guias não
//    pode esticar a linha inteira.
//  • Clique em dia vazio abre criação; clique no evento abre o detalhe. Dois gestos, dois destinos.
//
// ── ARRASTE: só MARCO se move ──
// Guia não é arrastável, e isso é regra, não limitação. O vencimento de um DAS é definido em lei —
// mover na tela não muda o prazo e daria a impressão de que mudou. Só o marco (a data que o
// contador criou) pode ser arrastado para outro dia.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const COR = {
  fundo: "#21222C", fundoFora: "#1B1C24", borda: "#44475A", texto: "#F8F8F2", suave: "#A7B0C0",
  guia: "#FFB347", guiaPaga: "#6272A4", marco: "#BD93F9", hoje: "#8BE9FD",
  obrigacao: "#50FA7B", obrigacaoFeita: "#6272A4", vencida: "#FF5555",
  alta: "#FF5555", media: "#BD93F9", baixa: "#6272A4",
};

// Guia e obrigação precisam ser distinguíveis à primeira vista porque respondem a perguntas
// diferentes: "o cliente paga" × "eu entrego". Cores separadas, e não um tom do mesmo laranja.
const CATEGORIAS = [
  { chave: "guia", rotulo: "Guias (cliente paga)", cor: "#FFB347" },
  { chave: "obrigacao", rotulo: "Obrigações (eu entrego)", cor: "#50FA7B" },
  { chave: "marco", rotulo: "Marcos", cor: "#BD93F9" },
];

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const pad2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const fmtMoney = (v) => (v == null ? "" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** "2026-07" → "jul/2026". Devolve o cru se vier em outro formato, em vez de mostrar "undefined". */
function rotuloCompetencia(competencia) {
  const m = String(competencia || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return competencia || "";
  return `${MESES[Number(m[2]) - 1].slice(0, 3)}/${m[1]}`;
}

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Monta as 6 semanas da visão de mês, incluindo os dias vizinhos apagados. */
function semanasDoMes(competencia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
  const inicio = new Date(primeiro);
  inicio.setUTCDate(1 - primeiro.getUTCDay()); // recua até o domingo
  const semanas = [];
  const cursor = new Date(inicio);
  for (let s = 0; s < 6; s += 1) {
    const semana = [];
    for (let d = 0; d < 7; d += 1) {
      semana.push({ data: iso(cursor), dia: cursor.getUTCDate(), doMes: cursor.getUTCMonth() === mes - 1 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

/** Os 7 dias da semana que contém `dataBase` (YYYY-MM-DD). */
function diasDaSemana(dataBase) {
  const [y, m, d] = dataBase.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() - base.getUTCDay());
  return Array.from({ length: 7 }, (_, i) => {
    const c = new Date(base);
    c.setUTCDate(base.getUTCDate() + i);
    return { data: iso(c), dia: c.getUTCDate(), doMes: true };
  });
}

const ehObrigacao = (item) => item.tipo === "obrigacao" || item.tipo === "obrigacaoGrupo";

function corDoItem(item) {
  if (item.tipo === "marco") return COR[String(item.importancia || "MEDIA").toLowerCase()] || COR.marco;
  if (ehObrigacao(item)) return item.resolvido ? COR.obrigacaoFeita : COR.obrigacao;
  return item.resolvido ? COR.guiaPaga : COR.guia;
}

/** Vencida ganha marca vermelha independente da cor da categoria — atraso vence a categoria. */
function estaVencida(item) {
  return ehObrigacao(item) && item.situacao === "VENCIDA";
}

function simboloDoItem(item) {
  if (item.tipo === "marco") return "◆";
  if (ehObrigacao(item)) return "▸";
  return "•";
}

function rotuloDoItem(item) {
  if (item.tipo === "marco") return item.titulo;
  if (item.tipo === "obrigacaoGrupo") {
    // Conta as EM ABERTO, não o total: "EFD-Contribuições · 38" num dia em que as 38 já foram
    // feitas é mentira. Com tudo concluído o número some e sobra o nome, riscado.
    // O número conta EMPRESAS; com uma só ele não informa nada — e dentro da aba da empresa, onde
    // todo grupo tem tamanho 1, seria "· 1" em cada chip da grade.
    const abertas = item.pendentes + item.vencidas;
    return abertas > 0 && item.total > 1 ? `${item.titulo} · ${abertas}` : item.titulo;
  }
  return `${item.titulo}${item.empresa ? ` · ${item.empresa}` : ""}`;
}

function Chip({ item, onAbrir, arrastavel }) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={arrastavel}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => { e.stopPropagation(); onAbrir(item); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onAbrir(item); } }}
      title={
        item.tipo === "obrigacaoGrupo"
          ? `${item.titulo} — ${item.total} empresa(s): ${item.pendentes} a entregar, ${item.vencidas} vencida(s), ${item.concluidas} concluída(s). Clique para ver e concluir por empresa.`
          : `${rotuloDoItem(item)}${item.valor != null ? ` · ${fmtMoney(item.valor)}` : ""}${
            item.tipo === "obrigacao"
              ? item.resolvido ? " · concluída" : estaVencida(item) ? " · VENCIDA" : " · a entregar"
              : item.resolvido ? " · pago" : ""
          }${arrastavel ? " · arraste para mudar o dia" : ""}`
      }
      style={{
        display: "flex", alignItems: "center", gap: 4, padding: "1px 5px", borderRadius: 4,
        background: `${corDoItem(item)}22`, borderLeft: `2px solid ${corDoItem(item)}`,
        // Atraso fala mais alto que categoria: a borda vermelha aparece por cima da cor do tipo.
        ...(estaVencida(item) ? { boxShadow: `inset 0 0 0 1px ${COR.vencida}` } : null),
        color: COR.texto, fontSize: "0.68rem", lineHeight: 1.5, cursor: arrastavel ? "grab" : "pointer",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        textDecoration: item.resolvido ? "line-through" : "none",
        marginBottom: 2,
      }}
    >
      {simboloDoItem(item)} {rotuloDoItem(item)}
    </div>
  );
}

function Celula({ dia, itens, ehHoje, altura, onCriar, onAbrir, onMover, compacta, feriado }) {
  const [sobre, setSobre] = useState(false);
  const MAX = compacta ? 8 : 3;
  const visiveis = itens.slice(0, MAX);
  const excedente = itens.length - visiveis.length;

  return (
    <div
      onClick={() => onCriar(dia.data)}
      onDragOver={(e) => { e.preventDefault(); if (!sobre) setSobre(true); }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onMover(id, dia.data);
      }}
      title={feriado ? `${feriado} — feriado. Clique para marcar uma data` : "Clique para marcar uma data"}
      style={{
        minHeight: altura, padding: 4, cursor: "pointer", overflow: "hidden",
        // Feriado tinge o FUNDO do dia. Não vira chip: um feriado não se clica nem se conclui, e
        // ocuparia a linha de um evento de verdade. Ele explica por que a obrigação foi antecipada.
        background: sobre ? "rgba(189,147,249,0.14)"
          : feriado ? "rgba(255,121,198,0.10)"
          : dia.doMes ? COR.fundo : COR.fundoFora,
        borderTop: `1px solid ${COR.borda}`,
        borderLeft: `1px solid ${COR.borda}`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <span
          style={{
            fontSize: "0.7rem", fontWeight: ehHoje ? 700 : 500,
            color: ehHoje ? "#1A1B26" : dia.doMes ? COR.suave : "#4a4d63",
            background: ehHoje ? COR.hoje : "transparent",
            borderRadius: 999, minWidth: 18, height: 18, display: "inline-flex",
            alignItems: "center", justifyContent: "center", padding: "0 5px",
          }}
        >
          {dia.dia}
        </span>
        {feriado && !compacta && (
          <span
            style={{
              fontSize: "0.6rem", color: "#FF79C6", whiteSpace: "nowrap", overflow: "hidden",
              textOverflow: "ellipsis", maxWidth: "70%", textAlign: "right",
            }}
          >
            {feriado}
          </span>
        )}
      </div>
      {visiveis.map((it, i) => (
        <Chip key={`${it.tipo}-${it.id || i}`} item={it} onAbrir={onAbrir} arrastavel={it.tipo === "marco"} />
      ))}
      {excedente > 0 && (
        <div style={{ fontSize: "0.66rem", color: COR.suave, paddingLeft: 5 }}>+{excedente}</div>
      )}
    </div>
  );
}

/**
 * Tela estreita = celular. Só decide o DEFAULT; o contador troca de visão à vontade depois.
 *
 * Largura 0 significa "ainda não sei" (container escondido, iframe sem layout), não "estreita" —
 * e a media query casa com 0. Sem esta guarda, a tela abre em modo celular numa janela grande e
 * fica assim, porque `visao` e `sidebarAberta` são valores INICIAIS e não se recalculam.
 */
function ehTelaEstreita() {
  if (typeof window === "undefined") return false;
  const largura = window.innerWidth || 0;
  if (largura <= 0) return false;
  return largura <= 760;
}

/**
 * @param {string} [companyIdFixo] Trava o calendário numa empresa (aba dentro da empresa). Some o
 *   seletor — não há o que escolher — e os atalhos de teclado são desligados: eles são globais
 *   (`window`), e dentro da empresa apertar "d" trocaria a visão de qualquer lugar da tela.
 */
export function CalendarioGrid({ api, empresas = [], onOpenCompany, companyIdFixo = null }) {
  // No celular a grade de mês vira 42 células de 40px onde nada é legível. A AGENDA — lista
  // cronológica por dia — é a única visão que funciona nessa largura, então é o default lá.
  const [visao, setVisao] = useState(() => (ehTelaEstreita() ? "agenda" : "mes"));
  const [referencia, setReferencia] = useState(hojeISO); // dia âncora da navegação
  const [companyId, setCompanyId] = useState(companyIdFixo || "");
  const [categorias, setCategorias] = useState(() => new Set(CATEGORIAS.map((c) => c.chave)));
  const [sidebarAberta, setSidebarAberta] = useState(() => !ehTelaEstreita());
  const [estreita, setEstreita] = useState(ehTelaEstreita);
  const [porDia, setPorDia] = useState({});
  const [feriadosPorDia, setFeriadosPorDia] = useState({});
  const [pendencias, setPendencias] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [criando, setCriando] = useState(null);   // { data }
  const [detalhe, setDetalhe] = useState(null);   // item clicado
  const [salvando, setSalvando] = useState(false);
  const tituloRef = useRef(null);

  // Trocar de empresa sem desmontar o componente (mudar o id na URL com a aba já aberta) deixaria
  // o filtro na empresa anterior — o cabeçalho diria uma coisa e a grade mostraria outra.
  useEffect(() => {
    if (companyIdFixo) setCompanyId(companyIdFixo);
  }, [companyIdFixo]);

  const competencia = referencia.slice(0, 7);

  const carregar = useCallback(async () => {
    if (!api) return;
    setCarregando(true);
    setErro(null);
    try {
      // A semana pode atravessar dois meses, então a visão semanal busca os dois. Uma requisição
      // por mês envolvido é mais simples do que um endpoint por intervalo — e o mês é a unidade
      // que o backend já entende.
      const meses = new Set([competencia]);
      if (visao === "semana") for (const d of diasDaSemana(referencia)) meses.add(d.data.slice(0, 7));
      const respostas = await Promise.all([...meses].map((m) => api.getCalendario(m, companyId || undefined)));
      const mapa = {};
      const feriados = {};
      // A semana que cruza dois meses traz duas listas de pendência, e a mesma empresa costuma
      // aparecer nas duas (apuração de junho E de julho em aberto). São pendências DIFERENTES, mas
      // a chave impede que uma resposta repetida vire linha duplicada.
      const vistas = new Map();
      for (const out of respostas) {
        if (out?.ok === false) { setErro(out?.message || "Não foi possível carregar."); continue; }
        for (const d of out?.dias || []) {
          mapa[d.data] = [...(mapa[d.data] || []), ...(d.itens || [])];
          if (d.feriado) feriados[d.data] = d.feriado;
        }
        for (const p of out?.pendenciasDoMes || []) {
          vistas.set(`${p.tipo}|${p.companyId}|${p.competencia}`, p);
        }
      }
      setPorDia(mapa);
      setFeriadosPorDia(feriados);
      setPendencias([...vistas.values()]);
    } catch (err) {
      setErro(err?.message || "Não foi possível carregar o calendário.");
    } finally {
      setCarregando(false);
    }
  }, [api, competencia, referencia, visao, companyId]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { if (criando) tituloRef.current?.focus(); }, [criando]);

  // A largura precisa ser REATIVA, não lida uma vez: girar o celular ou arrastar a janela muda o
  // layout, e um valor congelado deixaria a sidebar de 190px espremendo uma tela de 375.
  //
  // Escuta o `resize` além do `change` da media query: nem todo caminho de redimensionamento
  // dispara o `change` (o painel de preview do navegador é um deles), e sem o resize a tela fica
  // presa no layout estreito depois de voltar ao tamanho normal — grade escondida, sidebar
  // ocupando tudo. Reler a media query é barato; depender de um evento só, não.
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 760px)");
    const reavaliar = () => setEstreita(ehTelaEstreita());
    mq?.addEventListener?.("change", reavaliar);
    window.addEventListener("resize", reavaliar);
    reavaliar();
    return () => {
      mq?.removeEventListener?.("change", reavaliar);
      window.removeEventListener("resize", reavaliar);
    };
  }, []);

  // Atalhos do Google Calendar. Ignora quando o foco está num campo — senão digitar "dia" numa
  // descrição trocaria a visão três vezes.
  useEffect(() => {
    // Dentro de uma empresa o calendário é UM bloco da página, não a página inteira — um atalho
    // global ali roubaria a tecla de qualquer outro lugar da tela.
    if (companyIdFixo) return undefined;
    function aoTeclar(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const alvo = e.target;
      const digitando =
        alvo?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo?.tagName || "");
      if (digitando) return;
      const tecla = String(e.key || "").toLowerCase();
      if (tecla === "m") setVisao("mes");
      else if (tecla === "s") setVisao("semana");
      else if (tecla === "d") setVisao("dia");
      else if (tecla === "a") setVisao("agenda");
      else if (tecla === "t") setReferencia(hojeISO());
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  // ESC fecha o que estiver aberto — reflexo esperado em qualquer calendário.
  useEffect(() => {
    function aoTeclar(e) {
      if (e.key !== "Escape") return;
      if (detalhe) setDetalhe(null);
      else if (criando) setCriando(null);
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [criando, detalhe]);

  function navegar(passo) {
    const [y, m, d] = referencia.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d));
    if (visao === "mes") base.setUTCMonth(base.getUTCMonth() + passo);
    else if (visao === "semana") base.setUTCDate(base.getUTCDate() + 7 * passo);
    else base.setUTCDate(base.getUTCDate() + passo);
    setReferencia(iso(base));
  }

  const periodo = useMemo(() => {
    const [y, m, d] = referencia.split("-").map(Number);
    if (visao === "mes") return `${MESES[m - 1]} de ${y}`;
    if (visao === "dia") return `${d} de ${MESES[m - 1]} de ${y}`;
    const semana = diasDaSemana(referencia);
    const ini = semana[0]; const fim = semana[6];
    const mesIni = MESES[Number(ini.data.slice(5, 7)) - 1].slice(0, 3);
    const mesFim = MESES[Number(fim.data.slice(5, 7)) - 1].slice(0, 3);
    return `${ini.dia} ${mesIni} – ${fim.dia} ${mesFim} de ${fim.data.slice(0, 4)}`;
  }, [referencia, visao]);

  const linhas = useMemo(() => {
    if (visao === "mes") return semanasDoMes(competencia);
    if (visao === "semana") return [diasDaSemana(referencia)];
    const [y, m, d] = referencia.split("-").map(Number);
    return [[{ data: referencia, dia: d, doMes: true, _y: y, _m: m }]];
  }, [visao, competencia, referencia]);

  const hoje = hojeISO();
  const alturaCelula = visao === "mes" ? 96 : visao === "semana" ? 260 : 420;

  // Filtro por categoria age na EXIBIÇÃO, não na busca: desmarcar "guias" não deve disparar outra
  // requisição, e remarcar tem que ser instantâneo.
  const porDiaVisivel = useMemo(() => {
    if (categorias.size === CATEGORIAS.length) return porDia;
    const saida = {};
    for (const [data, itens] of Object.entries(porDia)) {
      const filtrados = itens.filter((i) => categorias.has(i.tipo));
      if (filtrados.length) saida[data] = filtrados;
    }
    return saida;
  }, [porDia, categorias]);

  /**
   * Agrupa as OBRIGAÇÕES do dia por `grupoChave`. Guia e marco passam intactos.
   *
   * Uma regra do escritório aplicada a 38 empresas gerava 38 chips no mesmo dia. Guia continua uma
   * por empresa porque o valor e o vencimento são de cada uma — agrupar esconderia justamente o
   * que o contador procura ali.
   *
   * ⚠ Deriva de `porDiaVisivel`, NÃO de `porDia`: o filtro de categoria casa por `i.tipo`, e o
   * item agrupado tem tipo "obrigacaoGrupo". Agrupar antes de filtrar mataria o checkbox
   * "Obrigações" em silêncio.
   */
  const porDiaAgrupado = useMemo(() => {
    const saida = {};
    for (const [data, itens] of Object.entries(porDiaVisivel)) {
      const grupos = new Map();
      const outros = [];
      for (const it of itens) {
        if (it.tipo !== "obrigacao") { outros.push(it); continue; }
        const chave = it.grupoChave || `id:${it.id}`;
        if (!grupos.has(chave)) {
          grupos.set(chave, {
            tipo: "obrigacaoGrupo", grupoChave: chave, id: `grupo-${chave}-${data}`,
            titulo: it.titulo, categoria: it.categoria, cor: it.cor, data,
            total: 0, pendentes: 0, vencidas: 0, concluidas: 0, ocorrencias: [],
          });
        }
        const g = grupos.get(chave);
        g.total += 1;
        if (it.situacao === "VENCIDA") g.vencidas += 1;
        else if (it.situacao === "CONCLUIDA") g.concluidas += 1;
        else g.pendentes += 1;
        g.ocorrencias.push(it);
      }
      for (const g of grupos.values()) {
        // "Resolvido" só quando NADA está em aberto — é o que risca o chip.
        g.resolvido = g.pendentes === 0 && g.vencidas === 0;
        g.situacao = g.vencidas > 0 ? "VENCIDA" : g.resolvido ? "CONCLUIDA" : "PENDENTE";
      }
      saida[data] = [...outros, ...grupos.values()];
    }
    return saida;
  }, [porDiaVisivel]);

  // Guarda a CHAVE, não o objeto. Guardando o objeto, depois de concluir uma empresa o painel
  // seguiria mostrando a lista de antes da conclusão até alguém re-clicar no chip.
  const [grupoSelecionado, setGrupoSelecionado] = useState(null); // { grupoChave, data }
  const grupoAberto = useMemo(() => {
    if (!grupoSelecionado) return null;
    const doDia = porDiaAgrupado[grupoSelecionado.data] || [];
    return doDia.find((i) => i.tipo === "obrigacaoGrupo" && i.grupoChave === grupoSelecionado.grupoChave) || null;
  }, [grupoSelecionado, porDiaAgrupado]);

  /**
   * A lista de empresas do painel esquerdo. Ela existe SEMPRE — é a carteira ao lado do calendário,
   * não um painel que aparece quando se clica em algo. Clicar numa obrigação apenas a ESTREITA
   * para as empresas que têm aquela obrigação naquele dia.
   *
   * Sem grupo aberto: toda a carteira, com quantas obrigações cada uma tem em aberto no mês visível
   * — o número é o que transforma a lista em ordem de trabalho em vez de um índice.
   * Com grupo aberto: só as empresas daquele grupo, cada uma com a situação e o ✓ para concluir.
   */
  const obrigacoesPorEmpresa = useMemo(() => {
    const mapa = new Map();
    for (const itens of Object.values(porDiaVisivel)) {
      for (const it of itens) {
        if (it.tipo !== "obrigacao" || !it.companyId) continue;
        const atual = mapa.get(it.companyId) || { abertas: 0, vencidas: 0, total: 0 };
        atual.total += 1;
        if (it.situacao === "VENCIDA") { atual.vencidas += 1; atual.abertas += 1; }
        else if (it.situacao !== "CONCLUIDA") atual.abertas += 1;
        mapa.set(it.companyId, atual);
      }
    }
    return mapa;
  }, [porDiaVisivel]);

  // A ocorrência traz só a razão; o CNPJ vem da carteira. Sem este de-para, a lista filtrada
  // perderia o CNPJ que a lista completa mostra — a mesma empresa apareceria de dois jeitos.
  const cnpjPorEmpresa = useMemo(
    () => new Map(empresas.map((e) => [e.companyId, e.cnpj])),
    [empresas],
  );

  const linhasDoPainel = useMemo(() => {
    if (grupoAberto) {
      return grupoAberto.ocorrencias.map((oc) => ({
        chave: oc.id,
        companyId: oc.companyId,
        nome: oc.empresa || "—",
        cnpj: cnpjPorEmpresa.get(oc.companyId) || null,
        competencia: oc.competencia,
        situacao: oc.situacao,
        resolvido: oc.resolvido,
        conclusaoAutomatica: oc.conclusaoAutomatica,
        ocorrencia: oc,
      }));
    }
    return empresas.map((e) => {
      const cont = obrigacoesPorEmpresa.get(e.companyId) || { abertas: 0, vencidas: 0, total: 0 };
      return {
        chave: e.companyId,
        companyId: e.companyId,
        nome: e.razao,
        cnpj: e.cnpj || null,
        abertas: cont.abertas,
        vencidas: cont.vencidas,
        semObrigacao: cont.total === 0,
      };
    });
  }, [grupoAberto, empresas, obrigacoesPorEmpresa, cnpjPorEmpresa]);

  // Agenda: lista cronológica do período, só com dia que tem algo. Dia vazio numa lista é ruído —
  // ao contrário da grade, onde o vazio é a própria informação ("nada vence aqui").
  const diasDaAgenda = useMemo(() => {
    if (visao !== "agenda") return [];
    const [ano, mes] = competencia.split("-").map(Number);
    const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const saida = [];
    for (let d = 1; d <= total; d += 1) {
      const data = `${ano}-${pad2(mes)}-${pad2(d)}`;
      const itens = porDiaAgrupado[data] || [];
      if (itens.length) saida.push({ data, dia: d, itens });
    }
    return saida;
  }, [visao, competencia, porDiaAgrupado]);

  function alternarCategoria(chave) {
    setCategorias((atual) => {
      const nova = new Set(atual);
      if (nova.has(chave)) nova.delete(chave); else nova.add(chave);
      return nova;
    });
  }

  async function concluirOcorrencia(item, { fecharDetalhe = true } = {}) {
    try {
      const out = await api.concluirOcorrencia(item.id);
      if (out?.ok === false) { setErro(out.message || "Não foi possível concluir."); return; }
      if (fecharDetalhe) setDetalhe(null);
      await carregar();
    } catch (err) { setErro(err?.message || "Não foi possível concluir."); }
  }

  /** Chip de grupo abre o painel lateral; guia e marco seguem no modal de detalhe de sempre. */
  function abrirItem(item) {
    setCriando(null);
    if (item.tipo === "obrigacaoGrupo") {
      setDetalhe(null);
      setSidebarAberta(true);
      setGrupoSelecionado({ grupoChave: item.grupoChave, data: item.data });
      return;
    }
    setDetalhe(item);
  }

  // Só rotula a competência quando há mais de uma na tela. No mês (o caso normal) o rótulo seria
  // ruído: todas as pendências são daquele mês, e isso o cabeçalho já diz.
  const variasCompetencias = useMemo(
    () => new Set(pendencias.map((p) => p.competencia)).size > 1,
    [pendencias],
  );

  async function salvarMarco(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const titulo = String(form.get("titulo") || "").trim();
    if (!titulo) return;
    setSalvando(true);
    try {
      await api.createMarcoFiscal({
        titulo,
        data: criando.data,
        descricao: String(form.get("descricao") || "").trim() || undefined,
        importancia: String(form.get("importancia") || "MEDIA"),
        companyId: companyId || undefined,
      });
      setCriando(null);
      await carregar();
    } catch (err) {
      setErro(err?.message || "Não foi possível salvar.");
    } finally { setSalvando(false); }
  }

  async function moverMarco(marcoId, novaData) {
    // Só marcos chegam aqui (o Chip só é arrastável quando tipo === "marco"), mas a guarda evita
    // que uma mudança futura no Chip vire um PATCH em algo que não deveria mover.
    const item = Object.values(porDia).flat().find((i) => i.id === marcoId);
    if (!item || item.tipo !== "marco") return;
    try {
      await api.updateMarcoFiscal(marcoId, { data: novaData });
      await carregar();
    } catch (err) {
      setErro(err?.message || "Não foi possível mover o marco.");
    }
  }

  async function excluirMarco(marcoId) {
    try {
      await api.deleteMarcoFiscal(marcoId);
      setDetalhe(null);
      await carregar();
    } catch (err) {
      setErro(err?.message || "Não foi possível excluir.");
    }
  }

  const btn = (ativo) => ({
    padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: "0.8rem", fontWeight: 600,
    border: `1px solid ${ativo ? "#BD93F9" : COR.borda}`,
    background: ativo ? "rgba(189,147,249,0.16)" : "transparent",
    color: ativo ? COR.texto : COR.suave,
  });

  return (
    <section aria-label="Calendário fiscal">
      {/* Cabeçalho: navegação à esquerda, granularidade à direita — como no Google Calendar. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button
          type="button" onClick={() => setSidebarAberta((v) => !v)} style={btn(false)}
          title={sidebarAberta ? "Esconder painel" : "Mostrar painel"} aria-expanded={sidebarAberta}
        >
          ☰
        </button>
        <button type="button" onClick={() => navegar(-1)} style={btn(false)} title="Anterior">‹</button>
        <button type="button" onClick={() => navegar(1)} style={btn(false)} title="Próximo">›</button>
        <button type="button" onClick={() => setReferencia(hojeISO())} style={btn(false)} title="Hoje (T)">Hoje</button>
        <strong style={{ color: COR.texto, fontSize: "1rem", textTransform: "capitalize", marginLeft: 4 }}>
          {periodo}
        </strong>
        {carregando && <span style={{ color: COR.suave, fontSize: "0.75rem" }}>carregando…</span>}

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* Travado numa empresa não tem o que escolher — o seletor sairia mentindo que dá. */}
          {!companyIdFixo && (
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              style={{ ...btn(false), color: COR.texto, background: COR.fundo }}
            >
              <option value="">Todas as empresas</option>
              {empresas.map((e) => <option key={e.companyId} value={e.companyId}>{e.razao}</option>)}
            </select>
          )}
          {[["mes", "Mês", "M"], ["semana", "Semana", "S"], ["dia", "Dia", "D"], ["agenda", "Agenda", "A"]].map(([k, label, tecla]) => (
            <button key={k} type="button" onClick={() => setVisao(k)} style={btn(visao === k)} title={companyIdFixo ? label : `${label} (${tecla})`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Legenda/filtro EM CIMA, em linha — não na lateral. Ao lado do calendário fica só a lista
          de empresas; a legenda é sobre o que a GRADE mostra, e ali embaixo da lista competia por
          altura com ela. Continua agindo na exibição, não na busca. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${COR.borda}` }}>
        {CATEGORIAS.map((c) => (
          <label
            key={c.chave}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: categorias.has(c.chave) ? COR.texto : COR.suave, cursor: "pointer", userSelect: "none" }}
          >
            <input
              type="checkbox"
              checked={categorias.has(c.chave)}
              onChange={() => alternarCategoria(c.chave)}
              style={{ accentColor: c.cor }}
            />
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c.cor, flex: "0 0 auto" }} />
            {c.rotulo}
          </label>
        ))}
      </div>

      {erro && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757", marginBottom: 10, fontSize: "0.82rem" }}>
          {erro}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      {sidebarAberta && (
        <aside
          aria-label="Painel do calendário"
          // Em tela estreita ela vira DRAWER: ocupa a largura toda e a grade fica escondida
          // enquanto está aberta. 190px fixos ao lado de uma tela de 375 espremiam as duas coisas
          // e nenhuma ficava usável.
          style={
            estreita
              ? { flex: "1 1 100%", display: "flex", flexDirection: "column", gap: 14, paddingBottom: 12, borderBottom: `1px solid ${COR.borda}` }
              : { flex: "0 0 288px", maxWidth: 288, display: "flex", flexDirection: "column", gap: 14 }
          }
        >
          {/* A CARTEIRA, ao lado do calendário — e SÓ ela: a legenda subiu para o topo. Ela não
              aparece e some conforme o clique: está sempre ali, com todas as empresas. Clicar numa
              obrigação do calendário apenas a ESTREITA para quem tem aquela obrigação — e o ✕
              devolve a lista inteira. Dentro da aba de uma empresa não há o que listar. */}
          {!companyIdFixo && (
            <div style={{ border: `1px solid ${grupoAberto ? COR.obrigacao : COR.borda}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COR.borda}`, background: "#20222E" }}>
                {grupoAberto ? (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ color: COR.texto, fontSize: "0.9rem", lineHeight: 1.25 }}>{grupoAberto.titulo}</strong>
                      <button
                        type="button" onClick={() => setGrupoSelecionado(null)} title="Ver todas as empresas"
                        style={{ marginLeft: "auto", background: "none", border: "none", color: COR.suave, cursor: "pointer", fontSize: "1rem", padding: 0 }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ fontSize: "0.74rem", color: COR.suave, marginTop: 3 }}>
                      {grupoAberto.data.split("-").reverse().join("/")} · {grupoAberto.pendentes + grupoAberto.vencidas} em aberto de {grupoAberto.total}
                    </div>
                  </>
                ) : (
                  <>
                    <strong style={{ color: COR.texto, fontSize: "0.9rem" }}>Empresas</strong>
                    <span style={{ color: COR.suave, fontSize: "0.8rem", marginLeft: 6 }}>{linhasDoPainel.length}</span>
                  </>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", maxHeight: 560, overflowY: "auto" }}>
                {!linhasDoPainel.length && (
                  <span style={{ fontSize: "0.8rem", color: COR.suave, padding: "12px" }}>Nenhuma empresa.</span>
                )}
                {linhasDoPainel.map((linha, idx) => (
                  <div
                    key={linha.chave}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "9px 12px",
                      borderTop: idx === 0 ? "none" : `1px solid ${COR.borda}`,
                    }}
                  >
                    <span
                      title={
                        grupoAberto
                          ? (linha.situacao === "VENCIDA" ? "Vencida" : linha.resolvido ? "Concluída" : "A entregar")
                          : linha.vencidas > 0 ? `${linha.vencidas} vencida(s)` : linha.abertas > 0 ? `${linha.abertas} a entregar` : "nada em aberto no mês"
                      }
                      style={{
                        width: 8, height: 8, borderRadius: 999, flex: "0 0 auto",
                        background: grupoAberto
                          ? (linha.situacao === "VENCIDA" ? COR.vencida : linha.resolvido ? COR.obrigacaoFeita : COR.obrigacao)
                          : linha.vencidas > 0 ? COR.vencida : linha.abertas > 0 ? COR.obrigacao : COR.borda,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => onOpenCompany?.(linha.companyId, linha.competencia)}
                      title={linha.nome}
                      style={{
                        flex: "1 1 auto", minWidth: 0, textAlign: "left", background: "none", border: "none",
                        cursor: onOpenCompany ? "pointer" : "default", padding: 0, font: "inherit",
                      }}
                    >
                      <span style={{
                        display: "block", fontSize: "0.86rem", fontWeight: 600, lineHeight: 1.25,
                        color: linha.resolvido ? COR.suave : COR.texto,
                        textDecoration: linha.resolvido ? "line-through" : "none",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {linha.nome}
                      </span>
                      {/* CNPJ embaixo do nome: é como o contador confere que é a empresa certa —
                          razões sociais se parecem, CNPJ não. */}
                      {linha.cnpj && (
                        <span style={{ display: "block", fontSize: "0.72rem", color: COR.suave, lineHeight: 1.3, marginTop: 1 }}>
                          {linha.cnpj}
                        </span>
                      )}
                    </button>
                    {/* Fora do grupo o número é quantas obrigações a empresa tem em aberto no mês
                        visível — some no zero, senão a coluna vira uma fileira de "0". */}
                    {!grupoAberto && linha.abertas > 0 && (
                      <span
                        title={`${linha.abertas} obrigação(ões) em aberto no mês`}
                        style={{
                          flex: "0 0 auto", fontSize: "0.74rem", fontWeight: 700, borderRadius: 999,
                          padding: "1px 7px", color: linha.vencidas > 0 ? COR.vencida : COR.obrigacao,
                          border: `1px solid ${linha.vencidas > 0 ? COR.vencida : COR.obrigacao}`,
                        }}
                      >
                        {linha.abertas}
                      </span>
                    )}
                    {/* Sem botão na automática: o backend recusa o clique, e oferecer é pior que
                        não oferecer. Concluída também não mostra — não há o que fazer. */}
                    {grupoAberto && !linha.resolvido && !linha.conclusaoAutomatica && (
                      <button
                        type="button"
                        onClick={() => concluirOcorrencia(linha.ocorrencia, { fecharDetalhe: false })}
                        title="Marcar como concluída"
                        style={{ background: "none", border: "none", color: "#69FF47", cursor: "pointer", fontSize: "1rem", padding: "0 2px", flex: "0 0 auto" }}
                      >
                        ✓
                      </button>
                    )}
                    {grupoAberto && linha.conclusaoAutomatica && !linha.resolvido && (
                      <span title="Conclui sozinha quando o sistema observar o serviço feito" style={{ color: COR.marco, fontSize: "0.72rem", flex: "0 0 auto" }}>auto</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {/* Drawer aberto no celular esconde a grade: são duas coisas disputando 375px.
          ⚠ `flex-basis: 0`, não `auto`: com `auto` a base é o tamanho do CONTEÚDO, e a grade de 7
          colunas pede ~1185px. Somada aos 232px do painel isso estoura a linha, o `flex-wrap`
          entra e o painel vai parar EM CIMA da grade em vez de ao lado dela. */}
      <div style={{ flex: "1 1 0", minWidth: 0, display: estreita && sidebarAberta ? "none" : "block" }}>
      {visao === "agenda" ? (
        <div style={{ border: `1px solid ${COR.borda}`, borderRadius: 8, overflow: "hidden" }}>
          {!diasDaAgenda.length && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: COR.suave, fontSize: "0.85rem" }}>
              Nada neste período.
            </div>
          )}
          {diasDaAgenda.map((d) => (
            <div key={d.data} style={{ display: "flex", gap: 12, padding: "8px 10px", borderBottom: `1px solid ${COR.borda}`, background: d.data === hoje ? "rgba(139,233,253,0.06)" : COR.fundo }}>
              <div style={{ flex: "0 0 62px", textAlign: "center" }}>
                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: d.data === hoje ? COR.hoje : COR.texto, lineHeight: 1.1 }}>
                  {d.dia}
                </div>
                <div style={{ fontSize: "0.66rem", color: COR.suave, textTransform: "uppercase" }}>
                  {DIAS_SEMANA[new Date(`${d.data}T00:00:00Z`).getUTCDay()]}
                </div>
                {feriadosPorDia[d.data] && (
                  <div style={{ fontSize: "0.58rem", color: "#FF79C6", lineHeight: 1.2, marginTop: 2 }}>
                    {feriadosPorDia[d.data]}
                  </div>
                )}
              </div>
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                {d.itens.map((it, i) => (
                  <Chip key={`${it.tipo}-${it.id || i}`} item={it} onAbrir={abrirItem} arrastavel={false} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div style={{ border: `1px solid ${COR.borda}`, borderRadius: 8, overflow: "hidden", borderRight: "none", borderBottom: "none" }}>
        {visao !== "dia" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", background: COR.fundoFora }}>
            {DIAS_SEMANA.map((d) => (
              <div key={d} style={{ padding: "6px 4px", textAlign: "center", color: COR.suave, fontSize: "0.68rem", textTransform: "uppercase", borderLeft: `1px solid ${COR.borda}` }}>
                {d}
              </div>
            ))}
          </div>
        )}
        {linhas.map((semana, si) => (
          <div key={si} style={{ display: "grid", gridTemplateColumns: `repeat(${semana.length},minmax(0,1fr))` }}>
            {semana.map((dia) => (
              <Celula
                key={dia.data}
                dia={dia}
                itens={porDiaAgrupado[dia.data] || []}
                ehHoje={dia.data === hoje}
                altura={alturaCelula}
                compacta={visao !== "mes"}
                feriado={feriadosPorDia[dia.data] || null}
                onCriar={(data) => { setDetalhe(null); setCriando({ data }); }}
                onAbrir={abrirItem}
                onMover={moverMarco}
              />
            ))}
          </div>
        ))}
      </div>
      )}
      </div>
      </div>

      {/* Apuração e fechamento são estado do MÊS, não têm dia. Ficam fora da grade de propósito:
          pendurá-los num dia inventaria um prazo que não existe. */}
      {pendencias.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: COR.texto, fontSize: "0.85rem", fontWeight: 700, marginBottom: 6 }}>
            {variasCompetencias ? "Pendências do período" : "Pendências do mês"}
            <span style={{ color: COR.suave, fontWeight: 400 }}> — sem data de vencimento</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {pendencias.map((p) => (
              <button
                key={`${p.tipo}|${p.companyId}|${p.competencia}`}
                type="button"
                onClick={() => onOpenCompany?.(p.companyId, p.competencia)}
                style={{
                  padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: "0.76rem",
                  background: COR.fundo, border: `1px solid ${COR.borda}`, color: COR.texto, textAlign: "left",
                }}
              >
                <span style={{ color: COR.guia }}>{p.titulo}</span>
                <span style={{ color: COR.suave }}> · {p.empresa}</span>
                {/* Com dois meses na tela, "Apuração não transmitida · Farrell" aparece duas vezes e
                    nada distingue uma da outra — só a competência diz de qual mês é cada uma. */}
                {variasCompetencias && (
                  <span style={{ color: COR.marco }}> · {rotuloCompetencia(p.competencia)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Criação: campo único em foco + "mais opções" logo abaixo, no espírito do quick-add. */}
      {criando && (
        <div
          role="dialog" aria-modal="true" aria-label="Marcar uma data"
          onClick={(e) => { if (e.target === e.currentTarget) setCriando(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
        >
          <form onSubmit={salvarMarco} style={{ width: "100%", maxWidth: 420, background: "#282A36", border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 18, color: COR.texto }}>
            <input
              ref={tituloRef} name="titulo" required placeholder="Adicionar título"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 10, background: "transparent", border: "none", borderBottom: `2px solid #BD93F9`, color: COR.texto, padding: "6px 2px", fontSize: "1.05rem", outline: "none" }}
            />
            <div style={{ fontSize: "0.8rem", color: COR.suave, marginBottom: 12 }}>
              {criando.data.split("-").reverse().join("/")}
              {companyId ? " · só para a empresa filtrada" : " · todas as empresas"}
            </div>
            <input name="descricao" placeholder="Descrição (opcional)"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 8, background: "#1F2029", border: `1px solid ${COR.borda}`, borderRadius: 6, color: COR.texto, padding: "7px 10px", fontSize: "0.85rem" }} />
            <select name="importancia" defaultValue="MEDIA"
              style={{ width: "100%", boxSizing: "border-box", marginBottom: 14, background: "#1F2029", border: `1px solid ${COR.borda}`, borderRadius: 6, color: COR.texto, padding: "7px 10px", fontSize: "0.85rem" }}>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Média</option>
              <option value="BAIXA">Baixa</option>
            </select>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setCriando(null)} style={btn(false)}>Cancelar</button>
              <button type="submit" disabled={salvando} style={{ ...btn(true), borderColor: "#69FF47", color: "#69FF47" }}>
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Detalhe do evento. Guia leva à empresa; marco pode ser excluído. */}
      {detalhe && (
        <div
          role="dialog" aria-modal="true" aria-label="Detalhe"
          onClick={(e) => { if (e.target === e.currentTarget) setDetalhe(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}
        >
          <div style={{ width: "100%", maxWidth: 400, background: "#282A36", border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 18, color: COR.texto }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: corDoItem(detalhe) }} />
              <strong style={{ fontSize: "1rem" }}>{detalhe.titulo}</strong>
            </div>
            {detalhe.descricao && <p style={{ margin: "0 0 8px", fontSize: "0.85rem", color: COR.suave }}>{detalhe.descricao}</p>}
            {detalhe.empresa && <div style={{ fontSize: "0.82rem", marginBottom: 4 }}>{detalhe.empresa}</div>}
            {detalhe.tipo === "guia" && (
              <div style={{ fontSize: "0.82rem", color: COR.suave, marginBottom: 4 }}>
                Competência {detalhe.competencia} · {fmtMoney(detalhe.valor)}
                {detalhe.resolvido ? " · pago" : ""}
              </div>
            )}
            {detalhe.tipo === "obrigacao" && (
              <div style={{ fontSize: "0.82rem", color: COR.suave, marginBottom: 4 }}>
                {detalhe.competencia && <>Competência {detalhe.competencia} · </>}
                {detalhe.resolvido
                  ? detalhe.fonteConclusao === "AUTOMATICA"
                    ? "concluída pelo sistema"
                    : "concluída"
                  : estaVencida(detalhe) ? "VENCIDA" : "a entregar"}
                {detalhe.conclusaoAutomatica && !detalhe.resolvido && (
                  <div style={{ marginTop: 4 }}>
                    Conclui sozinha quando o sistema observar o serviço feito — não precisa marcar.
                  </div>
                )}
              </div>
            )}
            {detalhe.tipo === "marco" && detalhe.doEscritorio && (
              <div style={{ fontSize: "0.78rem", color: COR.suave, marginBottom: 4 }}>Vale para todas as empresas</div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              {/* Só obrigação MANUAL e ainda aberta ganha o botão: na automática o backend recusaria
                  o clique, e oferecer é pior que não oferecer. */}
              {detalhe.tipo === "obrigacao" && !detalhe.resolvido && !detalhe.conclusaoAutomatica && (
                <button
                  type="button"
                  onClick={() => concluirOcorrencia(detalhe)}
                  style={{ ...btn(true), borderColor: "#69FF47", color: "#69FF47" }}
                >
                  ✓ Marcar como concluída
                </button>
              )}
              {detalhe.tipo === "obrigacao" && detalhe.companyId && onOpenCompany && (
                <button type="button" onClick={() => onOpenCompany(detalhe.companyId, detalhe.competencia)} style={btn(false)}>
                  Abrir empresa
                </button>
              )}
              {detalhe.tipo === "guia" && detalhe.companyId && onOpenCompany && (
                <button type="button" onClick={() => onOpenCompany(detalhe.companyId, detalhe.competencia)} style={btn(false)}>
                  Abrir empresa
                </button>
              )}
              {detalhe.tipo === "marco" && (
                <button
                  type="button"
                  onClick={() => { if (window.confirm(`Excluir "${detalhe.titulo}"?`)) excluirMarco(detalhe.id); }}
                  style={{ ...btn(false), borderColor: "#FF5555", color: "#FF5555" }}
                >
                  Excluir
                </button>
              )}
              <button type="button" onClick={() => setDetalhe(null)} style={btn(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
