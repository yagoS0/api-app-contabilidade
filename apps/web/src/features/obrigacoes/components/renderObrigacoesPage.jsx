// Controle de Obrigações — o que o ESCRITÓRIO precisa entregar, em toda a carteira.
//
// Duas coisas que a tela precisa deixar óbvias sem legenda:
//
//  1. Obrigação NÃO é guia. Guia é o que o cliente paga; obrigação é o serviço que o contador faz.
//     Por isso esta tela não fala em valor, em pagamento nem em empresa devedora — fala em prazo.
//  2. Obrigação que se conclui SOZINHA não mostra botão de concluir. Mostrar um botão que o
//     backend recusa seria pior que não mostrar nada; no lugar dele vai a frase do que o sistema
//     observa. É a mesma ideia do calendário: agenda alimentada à mão envelhece.
//
// Visão do escritório por padrão, com filtro de empresa opcional — a pergunta é "o que eu preciso
// entregar", não "o que falta nesta empresa".

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../../components/layout/AppShell";
import { Button } from "../../../components/ui/Button";
import { BackButton } from "../../../components/ui/BackButton";
import { lerFalhaDeCarga, SEM_RESPOSTA } from "../../../lib/falhaDeCarga";
import { calcularPreviaVencimentos } from "../lib/previaVencimentos";
import { RegrasObrigacao } from "./renderRegrasObrigacao";

const COR = {
  fundo: "#21222C", borda: "#44475A", texto: "#F8F8F2", suave: "#A7B0C0",
  pendente: "#8BE9FD", vencida: "#FF5757", concluida: "#50FA7B", alerta: "#FFB347",
  automatica: "#BD93F9",
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const ROTULO_PERIODICIDADE = { MENSAL: "Mensal", TRIMESTRAL: "Trimestral", ANUAL: "Anual" };
const ROTULO_AJUSTE = {
  ANTECIPAR: "Antecipa para o dia útil anterior",
  POSTERGAR: "Adia para o próximo dia útil",
  MANTER: "Mantém a data, mesmo sem ser dia útil",
};

const fmtData = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

function Selo({ cor, children, title }) {
  return (
    <span
      title={title}
      style={{
        fontSize: "0.7rem", fontWeight: 700, padding: "1px 8px", borderRadius: 999,
        border: `1px solid ${cor}`, color: cor, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * ⚠ O CARTÃO SABE DIZER QUE NÃO SABE.
 *
 * Ele mostrava `resumo.pendentes` de um objeto que nascia `{0, 0, 0}` quando a carga falhava: a
 * tela afirmava "0 pendentes · 0 vencendo · 0 vencidas" em corpo de 1.5rem sobre um servidor que
 * não respondeu. O contador lê os três números, conclui que está tudo em dia e fecha a página.
 *
 * Com `indisponivel`, o "—" ocupa exatamente o mesmo espaço do número (mesmo tamanho, mesma
 * altura de cartão — a recusa não pode encolher, senão o olho pula para os cartões que "têm"
 * número) e a legenda vermelha diz que houve falha de carga.
 */
function CartaoResumo({ rotulo, valor, cor, indisponivel, legenda, motivo }) {
  return (
    <div
      title={indisponivel ? motivo : undefined}
      style={{ flex: "1 1 140px", minWidth: 140, background: COR.fundo, border: `1px solid ${indisponivel ? COR.borda : cor}`, borderRadius: 8, padding: "10px 12px" }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: indisponivel ? COR.suave : cor, lineHeight: 1.1 }}>
        {indisponivel ? SEM_RESPOSTA : valor}
      </div>
      <div style={{ fontSize: "0.75rem", color: COR.suave }}>{rotulo}</div>
      {indisponivel && legenda && (
        // Vermelho só quando é FALHA — "carregando" não é bloqueio, e gastar a cor nele a esvazia.
        <div style={{ fontSize: "0.72rem", color: legenda.falhou ? COR.vencida : COR.suave, marginTop: 2 }}>
          {legenda.texto}
        </div>
      )}
    </div>
  );
}

const campo = {
  background: "#1F2029", border: `1px solid ${COR.borda}`, borderRadius: 6,
  color: COR.texto, padding: "7px 10px", fontSize: "0.85rem", width: "100%", boxSizing: "border-box",
  colorScheme: "dark",
};
const rotuloTexto = { display: "block", fontSize: "0.75rem", color: COR.suave, marginBottom: 3 };

/**
 * Campo com o input DENTRO do label. Antes o label era irmão do input, e aí clicar no rótulo não
 * focava o campo nem associava os dois para leitor de tela. O resto do formulário do projeto
 * (renderCompanyForm) já envolve — isto só acompanha.
 */
function Campo({ label, children, largura }) {
  return (
    <label style={largura ? { gridColumn: largura } : undefined}>
      <span style={rotuloTexto}>{label}</span>
      {children}
    </label>
  );
}

/** Um passo só: sem catálogo, não há o que escolher antes de configurar. */
function ModalObrigacao({ empresas, opcoes, inicial, onFechar, onSalvar, salvando, erro }) {
  const editando = Boolean(inicial?.obrigacaoId);
  const [form, setForm] = useState(() => ({
    companyId: inicial?.companyId || empresas[0]?.companyId || "",
    nome: inicial?.nome || "",
    categoria: inicial?.categoria || "",
    periodicidade: inicial?.periodicidade || "MENSAL",
    diaVencimento: inicial?.diaVencimento || 20,
    mesReferencia: inicial?.mesReferencia || 1,
    defasagemMeses: inicial?.defasagemMeses ?? 1,
    antecedenciaLembreteDias: inicial?.antecedenciaLembreteDias ?? 5,
    ajusteDiaUtil: inicial?.ajusteDiaUtil || "ANTECIPAR",
    verificador: inicial?.verificador || "",
    // Só existe no cadastro NOVO, e só quando o vencimento deste mês já passou — ver a caixa lá
    // embaixo. Não é campo da obrigação: não é salvo, não é editável depois.
    incluirVencidoDoMes: false,
  }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Preview em tempo real: o contador confere a regra vendo as datas, não lendo a configuração.
  //
  // ⚠ DATA QUE JÁ PASSOU NÃO É "PRÓXIMO VENCIMENTO". A prévia partia do mês corrente e anunciava o
  // vencimento deste mês mesmo depois de vencido — e o backend o criava, deixando a obrigação
  // VENCIDA em vermelho no instante em que foi cadastrada. O passado sai da lista e vira uma
  // ESCOLHA declarada (a caixa abaixo), porque só o contador sabe se aquela entrega de fato
  // atrasou naquela empresa.
  const previa = useMemo(
    () => calcularPreviaVencimentos(form, new Date()),
    [form.periodicidade, form.mesReferencia, form.diaVencimento, form.ajusteDiaUtil],
  );

  // Marcar "já venceu" numa obrigação que passa a existir agora só faz sentido no cadastro novo.
  const podeMarcarVencido = !editando && Boolean(previa.jaVencida);

  return (
    <div
      role="dialog" aria-modal="true" aria-label={editando ? "Editar obrigação" : "Nova obrigação"}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16, overflowY: "auto" }}
    >
      <form
        // A caixa só vale enquanto a data passada existe: mudar o dia depois de marcá-la não pode
        // deixar a escolha "pegada" num vencimento que não é mais retroativo.
        onSubmit={(e) => {
          e.preventDefault();
          onSalvar({ ...form, incluirVencidoDoMes: podeMarcarVencido && form.incluirVencidoDoMes });
        }}
        style={{ width: "100%", maxWidth: 560, background: "#282A36", border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, color: COR.texto }}
      >
        <h3 style={{ margin: "0 0 14px", fontSize: "1.05rem" }}>
          {editando ? "Editar obrigação" : "Nova obrigação"}
        </h3>

        {erro && (
          <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757", marginBottom: 12, fontSize: "0.8rem" }}>
            {erro}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Campo label="Nome" largura="1 / -1">
            <input
              autoFocus required value={form.nome} onChange={(e) => set("nome", e.target.value)}
              placeholder="Ex.: Transmitir apuração do Simples" style={campo}
            />
          </Campo>

          {!editando && (
            <Campo label="Empresa">
              <select value={form.companyId} onChange={(e) => set("companyId", e.target.value)} style={campo}>
                {empresas.map((e) => <option key={e.companyId} value={e.companyId}>{e.razao}</option>)}
              </select>
            </Campo>
          )}

          <Campo label="Categoria">
            <input
              value={form.categoria} onChange={(e) => set("categoria", e.target.value)}
              placeholder="fiscal, trabalhista…" list="categorias-obrigacao" style={campo}
            />
          </Campo>

          <Campo label="Periodicidade">
            <select value={form.periodicidade} onChange={(e) => set("periodicidade", e.target.value)} style={campo}>
              {(opcoes?.periodicidades || []).map((p) => (
                <option key={p} value={p}>{ROTULO_PERIODICIDADE[p] || p}</option>
              ))}
            </select>
          </Campo>

          <Campo label="Dia do vencimento">
            <input
              type="number" min="1" max="31" value={form.diaVencimento}
              onChange={(e) => set("diaVencimento", e.target.value)} style={campo}
            />
          </Campo>

          {form.periodicidade !== "MENSAL" && (
            <Campo label={form.periodicidade === "ANUAL" ? "Mês" : "Primeiro mês do ciclo"}>
              <select value={form.mesReferencia} onChange={(e) => set("mesReferencia", e.target.value)} style={campo}>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </Campo>
          )}

          <Campo label="Se cair em fim de semana ou feriado" largura="1 / -1">
            <select value={form.ajusteDiaUtil} onChange={(e) => set("ajusteDiaUtil", e.target.value)} style={campo}>
              {(opcoes?.ajustesDiaUtil || []).map((a) => (
                <option key={a} value={a}>{ROTULO_AJUSTE[a] || a}</option>
              ))}
            </select>
          </Campo>

          <Campo label="Refere-se à competência de">
            <select value={form.defasagemMeses} onChange={(e) => set("defasagemMeses", e.target.value)} style={campo}>
              <option value={0}>Mesmo mês do vencimento</option>
              <option value={1}>1 mês antes</option>
              <option value={2}>2 meses antes</option>
              <option value={3}>3 meses antes</option>
              <option value={5}>5 meses antes</option>
              <option value={12}>12 meses antes</option>
            </select>
          </Campo>

          <Campo label="Avisar com antecedência de">
            <input
              type="number" min="0" max="90" value={form.antecedenciaLembreteDias}
              onChange={(e) => set("antecedenciaLembreteDias", e.target.value)} style={campo}
            />
          </Campo>

          <Campo label="Concluir sozinha" largura="1 / -1">
            <select value={form.verificador} onChange={(e) => set("verificador", e.target.value)} style={campo}>
              <option value="">Eu marco quando concluir</option>
              {(opcoes?.verificadores || []).map((v) => (
                <option key={v.chave} value={v.chave}>{v.rotulo}</option>
              ))}
            </select>
          </Campo>
        </div>

        <div style={{ marginTop: 12, padding: "8px 10px", background: COR.fundo, borderRadius: 6, border: `1px solid ${COR.borda}`, fontSize: "0.78rem", color: COR.suave }}>
          Próximos vencimentos: <strong style={{ color: COR.texto }}>{previa.proximas.map(fmtData).join(" · ") || "—"}</strong>
          {previa.jaVencida && (
            <div style={{ marginTop: 6, color: COR.alerta }}>
              O vencimento deste mês ({fmtData(previa.jaVencida)}) já passou.
              {podeMarcarVencido ? (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 4, color: COR.texto }}>
                  <input
                    type="checkbox"
                    checked={form.incluirVencidoDoMes}
                    onChange={(e) => set("incluirVencidoDoMes", e.target.checked)}
                  />
                  <span>
                    Registrar {fmtData(previa.jaVencida)} como pendência em atraso — marque só se esta
                    entrega realmente não foi feita.
                  </span>
                </label>
              ) : (
                <> Ele não vira pendência: a obrigação começa no próximo.</>
              )}
            </div>
          )}
          {/* ⚠ O rótulo do campo fala em feriado; esta conta, que roda no navegador, só conhece
              sábado e domingo. Os feriados vivem na tabela `Feriado` do servidor (semeada por
              `apps/api/scripts/semear-feriados.mjs`), e os municipais dependem do município da
              empresa — quem os aplica é o servidor, ao gerar os vencimentos. Inventar um calendário
              aqui seria pior que declarar o alcance da estimativa. */}
          <div style={{ marginTop: 4, fontSize: "0.72rem" }}>
            estimativa: considera só fim de semana. Os feriados cadastrados entram quando o servidor
            gera os vencimentos.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={salvando}>
            {salvando ? "Salvando…" : editando ? "Salvar" : "Criar obrigação"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ObrigacoesPage({ api, empresas = [], onBack }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);       // falha de AÇÃO (concluir, excluir)
  const [falha, setFalha] = useState(null);     // falha de CARGA — some com a lista, não com a ação
  const [aviso, setAviso] = useState(null);
  const [companyId, setCompanyId] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("");
  const [modal, setModal] = useState(null); // { inicial }
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState(null);
  const [verRegras, setVerRegras] = useState(false);

  const carregar = useCallback(async () => {
    if (!api) return;
    setCarregando(true);
    setErro(null);
    setFalha(null);
    try {
      const out = await api.listObrigacoes({ companyId: companyId || undefined });
      if (out?.ok === false) {
        setFalha(lerFalhaDeCarga(out, { assunto: "as obrigações" }));
        setDados(null);
      } else setDados(out);
    } catch (err) {
      setFalha(lerFalhaDeCarga(err, { assunto: "as obrigações" }));
      setDados(null);
    } finally { setCarregando(false); }
  }, [api, companyId]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const obrigacoes = useMemo(() => {
    const lista = dados?.obrigacoes || [];
    const termo = busca.trim().toLowerCase();
    return lista.filter((o) => {
      if (termo && !`${o.nome} ${o.categoria || ""} ${o.empresa || ""}`.toLowerCase().includes(termo)) return false;
      if (filtroSituacao) {
        const proxima = o.ocorrencias?.find((oc) => oc.situacao !== "CONCLUIDA");
        const temVencida = o.ocorrencias?.some((oc) => oc.situacao === "VENCIDA");
        if (filtroSituacao === "VENCIDA" && !temVencida) return false;
        if (filtroSituacao === "PENDENTE" && (!proxima || temVencida)) return false;
      }
      return true;
    });
  }, [dados, busca, filtroSituacao]);

  const categorias = useMemo(
    () => [...new Set((dados?.obrigacoes || []).map((o) => o.categoria).filter(Boolean))],
    [dados],
  );

  async function salvar(form) {
    setSalvando(true);
    setErroModal(null);
    try {
      const corpo = {
        nome: form.nome,
        categoria: form.categoria || null,
        periodicidade: form.periodicidade,
        diaVencimento: Number(form.diaVencimento),
        mesReferencia: form.periodicidade === "MENSAL" ? null : Number(form.mesReferencia),
        defasagemMeses: Number(form.defasagemMeses),
        antecedenciaLembreteDias: Number(form.antecedenciaLembreteDias),
        ajusteDiaUtil: form.ajusteDiaUtil,
        verificador: form.verificador || null,
      };
      const out = modal?.inicial?.obrigacaoId
        ? await api.updateObrigacao(modal.inicial.obrigacaoId, corpo)
        // ⚠ Só no CADASTRO. `incluirVencidoDoMes` é a declaração de que o vencimento já passado
        // desta empresa é atraso de verdade; editar depois não pode fabricar pendência retroativa.
        : await api.createObrigacao(form.companyId, { ...corpo, incluirVencidoDoMes: form.incluirVencidoDoMes === true });
      if (out?.ok === false) { setErroModal(out.message || "Não foi possível salvar."); return; }
      setModal(null);
      // Diz o que aconteceu de fato, não um "salvo" liso: o número é a prova de que entrou no
      // calendário.
      setAviso(
        out.ocorrenciasCriadas
          ? `Obrigação salva — ${out.ocorrenciasCriadas} vencimento(s) no calendário.`
          : "Obrigação salva.",
      );
      await carregar();
    } catch (err) {
      setErroModal(err?.message || "Não foi possível salvar.");
    } finally { setSalvando(false); }
  }

  async function concluir(ocorrenciaId) {
    try {
      const out = await api.concluirOcorrencia(ocorrenciaId);
      if (out?.ok === false) { setErro(out.message || "Não foi possível concluir."); return; }
      await carregar();
    } catch (err) { setErro(err?.message || "Não foi possível concluir."); }
  }

  async function excluir(o) {
    if (!window.confirm(`Excluir "${o.nome}"? Os vencimentos já concluídos também são apagados.`)) return;
    try {
      const out = await api.deleteObrigacao(o.obrigacaoId);
      if (out?.ok === false) { setErro(out.message || "Não foi possível excluir."); return; }
      setAviso(`"${o.nome}" removida.`);
      await carregar();
    } catch (err) { setErro(err?.message || "Não foi possível excluir."); }
  }

  // ⚠ SEM `dados` NÃO HÁ RESUMO — e o default `{0,0,0}` que morava aqui era a mentira inteira.
  const resumo = dados?.resumo || null;
  const resumoIndisponivel = !resumo;
  const motivoDoResumo = falha
    ? `${falha.titulo}. ${falha.motivo}`
    : carregando
      ? "Os números estão sendo carregados."
      : "Os números ainda não chegaram do servidor.";
  const legendaDoResumo = falha
    ? { falhou: true, texto: falha.semAcesso ? "sem acesso" : "não carregou" }
    : { falhou: false, texto: carregando ? "carregando…" : "sem resposta" };

  // Ao voltar das regras, recarrega: propagar cria e remove obrigações nas empresas, e a lista
  // atrás estaria desatualizada.
  if (verRegras) {
    return (
      <AppShell>
        <RegrasObrigacao
          api={api}
          empresas={empresas}
          onVoltar={() => { setVerRegras(false); carregar(); }}
        />
      </AppShell>
    );
  }

  // Página inteira (Configurações ▾ → Obrigações do escritório), não mais um bloco embutido no
  // dashboard — daí o AppShell aqui dentro, como nas outras páginas de topo.
  return (
    <AppShell>
    <section aria-label="Obrigações">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {onBack && <BackButton onClick={onBack} />}
        <h1 style={{ margin: 0, color: COR.texto, fontSize: "1.25rem" }}>Obrigações</h1>
        <span style={{ color: COR.suave, fontSize: "0.78rem" }}>
          o que o escritório precisa entregar
        </span>
        {carregando && <span style={{ color: COR.suave, fontSize: "0.75rem" }}>carregando…</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={() => setVerRegras(true)}>Regras do escritório</Button>
          <Button variant="primary" onClick={() => { setErroModal(null); setModal({ inicial: null }); }}>
            + Nova obrigação
          </Button>
        </div>
      </div>

      {erro && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", color: "#FF4757", marginBottom: 12, fontSize: "0.82rem" }}>
          {erro}
        </div>
      )}
      {aviso && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(80,250,123,0.10)", border: `1px solid ${COR.concluida}`, color: COR.concluida, marginBottom: 12, fontSize: "0.82rem" }}>
          {aviso}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <CartaoResumo
          rotulo="Pendentes" valor={resumo?.pendentes} cor={COR.pendente}
          indisponivel={resumoIndisponivel} legenda={legendaDoResumo} motivo={motivoDoResumo}
        />
        <CartaoResumo
          rotulo="Vencendo em 7 dias" valor={resumo?.vencendoEm7Dias} cor={COR.alerta}
          indisponivel={resumoIndisponivel} legenda={legendaDoResumo} motivo={motivoDoResumo}
        />
        <CartaoResumo
          rotulo="Vencidas" valor={resumo?.vencidas} cor={COR.vencida}
          indisponivel={resumoIndisponivel} legenda={legendaDoResumo} motivo={motivoDoResumo}
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input
          type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, categoria ou empresa"
          style={{ ...campo, width: "auto", minWidth: 260, flex: "1 1 260px" }}
        />
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} style={{ ...campo, width: "auto" }}>
          <option value="">Todas as empresas</option>
          {empresas.map((e) => <option key={e.companyId} value={e.companyId}>{e.razao}</option>)}
        </select>
        <select value={filtroSituacao} onChange={(e) => setFiltroSituacao(e.target.value)} style={{ ...campo, width: "auto" }}>
          <option value="">Toda situação</option>
          <option value="PENDENTE">Só pendentes</option>
          <option value="VENCIDA">Só vencidas</option>
        </select>
      </div>

      <datalist id="categorias-obrigacao">
        {categorias.map((c) => <option key={c} value={c} />)}
      </datalist>

      {/* ⚠ TRÊS ESTADOS, TRÊS PAINÉIS. Antes eram um: carga falhada saía como "Nenhuma obrigação
          cadastrada." — a tela afirmando sobre a carteira inteira uma coisa que ela não sabe. */}
      {!carregando && falha && (
        <div
          role="alert"
          style={{ padding: "24px 16px", textAlign: "center", background: COR.fundo, border: `2px solid ${falha.semAcesso ? COR.borda : COR.vencida}`, borderRadius: 8 }}
        >
          <div style={{ color: falha.semAcesso ? COR.texto : COR.vencida, fontWeight: 700, fontSize: "1rem", marginBottom: 4 }}>
            {falha.titulo}
          </div>
          <div style={{ color: COR.texto, fontSize: "0.8rem", marginBottom: 4 }}>{falha.motivo}</div>
          <div style={{ color: COR.suave, fontSize: "0.78rem", marginBottom: 10 }}>
            Isto não quer dizer que não há obrigações — quer dizer que esta tela não conseguiu vê-las.
          </div>
          <Button variant="secondary" onClick={carregar}>Tentar de novo</Button>
        </div>
      )}

      {!carregando && !falha && !obrigacoes.length && (
        <div style={{ padding: "28px 16px", textAlign: "center", background: COR.fundo, border: `1px dashed ${COR.borda}`, borderRadius: 8 }}>
          <div style={{ color: COR.texto, fontWeight: 600, marginBottom: 4 }}>
            {dados?.obrigacoes?.length ? "Nada com esses filtros." : "Nenhuma obrigação cadastrada."}
          </div>
          <div style={{ color: COR.suave, fontSize: "0.8rem" }}>
            {dados?.obrigacoes?.length
              ? "Limpe a busca ou troque a empresa."
              : "Cadastre a primeira e ela aparece no calendário."}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {obrigacoes.map((o) => {
          const proxima = o.ocorrencias?.find((oc) => oc.situacao !== "CONCLUIDA") || null;
          const situacao = proxima?.situacao || "CONCLUIDA";
          const corSituacao =
            situacao === "VENCIDA" ? COR.vencida : situacao === "CONCLUIDA" ? COR.concluida : COR.pendente;
          return (
            <article
              key={o.obrigacaoId}
              style={{ background: COR.fundo, border: `1px solid ${COR.borda}`, borderRadius: 8, padding: "10px 12px" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: o.cor || corSituacao, flex: "0 0 auto" }} />
                <strong style={{ color: COR.texto, fontSize: "0.92rem" }}>{o.nome}</strong>
                <Selo cor={COR.suave}>{ROTULO_PERIODICIDADE[o.periodicidade] || o.periodicidade}</Selo>
                {o.categoria && <Selo cor={COR.suave}>{o.categoria}</Selo>}
                {!companyId && o.empresa && (
                  <span style={{ color: COR.suave, fontSize: "0.78rem" }}>· {o.empresa}</span>
                )}
                {o.conclusaoAutomatica && (
                  <Selo cor={COR.automatica} title="O sistema conclui sozinho ao observar o serviço feito">
                    automática
                  </Selo>
                )}

                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Selo
                    cor={corSituacao}
                    title={
                      situacao === "VENCIDA" ? `Venceu em ${fmtData(proxima.dataVencimento)} e não foi concluída`
                        : situacao === "CONCLUIDA" ? "Nenhum vencimento pendente"
                        : `Vence em ${fmtData(proxima.dataVencimento)}`
                    }
                  >
                    {situacao === "VENCIDA" ? `Vencida · ${fmtData(proxima.dataVencimento)}`
                      : situacao === "CONCLUIDA" ? "Em dia"
                      : `Vence ${fmtData(proxima.dataVencimento)}`}
                  </Selo>
                  {/* Sem botão quando a conclusão é automática: oferecer um clique que o backend
                      recusa é pior que não oferecer nada. */}
                  {proxima && !o.conclusaoAutomatica && (
                    <Button variant="secondary" onClick={() => concluir(proxima.ocorrenciaId)}>✓ Concluir</Button>
                  )}
                  <Button variant="secondary" onClick={() => { setErroModal(null); setModal({ inicial: o }); }}>Editar</Button>
                  <Button variant="secondary" onClick={() => excluir(o)}>Excluir</Button>
                </div>
              </div>

              <div style={{ marginTop: 4, fontSize: "0.75rem", color: COR.suave }}>
                {proxima?.competenciaRef && <>competência {proxima.competenciaRef} · </>}
                {o.conclusaoAutomatica
                  ? "conclui sozinha quando o serviço for observado pelo sistema"
                  : `você marca quando concluir · avisa ${o.antecedenciaLembreteDias} dia(s) antes`}
              </div>
            </article>
          );
        })}
      </div>

      {modal && (
        <ModalObrigacao
          empresas={empresas}
          opcoes={dados?.opcoes}
          inicial={modal.inicial}
          salvando={salvando}
          erro={erroModal}
          onFechar={() => setModal(null)}
          onSalvar={salvar}
        />
      )}
    </section>
    </AppShell>
  );
}
