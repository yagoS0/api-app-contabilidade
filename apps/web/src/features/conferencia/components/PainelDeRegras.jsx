// AS REGRAS DO FORNECEDOR — a porta que faltava, e a chave que liga o lançamento automático.
//
// > Dono (29/08/2026): *"a Lente tem todo mês um pagamento a Alessandro Nigro, CNPJ, que vai se
// > tornar uma recorrência no fluxo deles. O contador deve poder colocar o código de débito e
// > crédito nessa despesa, e todo mês que essa nota aparecer ela já é lançada em despesa."*
//
// ⚠⚠ **ESTA É A TELA MAIS PERIGOSA DA CONFERÊNCIA**, e por isso ela diz em voz alta o que faz: uma
// regra marcada aqui passa a criar lançamento contábil **sem ninguém clicar**. É a razão de a
// frase de cada regra descrever o COMPORTAMENTO dela, e não só o estado.
//
// ⚠ A REGRA NÃO MORA AQUI. Quem valida é `lib/regraDoFornecedor.js` (espelho declarado do servidor),
// e quem decide de verdade é `application/declarados/RegraService.js` — um `curl` bate lá.

import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";
import {
  comportamentoDaRegra,
  contasDeCreditoOferecidas,
  contasDeDebitoOferecidas,
  COMPORTAMENTO,
  fraseDaRegra,
  validarRegra,
} from "../lib/regraDoFornecedor";

const regrasApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
};

const campo = {
  background: "var(--surface-2, var(--surface))",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  padding: "6px 8px",
  width: "100%",
};

const brl = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
};

const cnpjBr = (v) => {
  const d = String(v ?? "").replace(/\D+/g, "");
  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : (v || "—");
};

/** ⚠ A cor segue o vocabulário da casa: âmbar é "atenção", nunca "erro". Lançar sozinha é atenção. */
const TOKEN_DO_COMPORTAMENTO = {
  [COMPORTAMENTO.LANCA_SOZINHA]: "var(--state-warn)",
  [COMPORTAMENTO.SO_SUGERE]: "var(--text-muted)",
  [COMPORTAMENTO.NAO_PODE_LANCAR]: "var(--text-muted)",
  [COMPORTAMENTO.DESLIGADA]: "var(--text-muted)",
};

const CAMPOS_VAZIOS = {
  cnpjFornecedor: "",
  padraoDescricao: "",
  valorMin: "",
  valorMax: "",
  contaDestino: "",
  contaCredito: "",
  lancaSozinha: false,
  diaDoLancamento: "",
};

function mensagemDoErro(e) {
  return e?.body?.message || e?.message || "Não foi possível concluir.";
}

export function PainelDeRegras({ companyId, contas = [], podeEscrever = true }) {
  const [estado, setEstado] = useState({ carregando: true, regras: [], indisponivel: false, erro: null });
  const [abrindo, setAbrindo] = useState(false);
  const [campos, setCampos] = useState(CAMPOS_VAZIOS);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const debitos = useMemo(() => contasDeDebitoOferecidas(contas), [contas]);
  const creditos = useMemo(() => contasDeCreditoOferecidas(contas), [contas]);
  const veredito = useMemo(() => validarRegra(campos, contas), [campos, contas]);

  function carregar() {
    if (!companyId || typeof regrasApi.getConferenciaRegras !== "function") {
      setEstado({ carregando: false, regras: [], indisponivel: true, erro: null });
      return;
    }
    setEstado((e) => ({ ...e, carregando: true }));
    Promise.resolve(regrasApi.getConferenciaRegras(companyId))
      .then((r) => setEstado({
        carregando: false,
        regras: Array.isArray(r?.regras) ? r.regras : [],
        indisponivel: r?.indisponivel === true,
        erro: null,
      }))
      .catch((e) => setEstado({ carregando: false, regras: [], indisponivel: false, erro: e }));
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  async function criar() {
    setEnviando(true);
    setAviso(null);
    try {
      await regrasApi.postConferenciaRegra(companyId, {
        cnpjFornecedor: campos.cnpjFornecedor || null,
        padraoDescricao: campos.padraoDescricao || null,
        valorMin: Number(campos.valorMin),
        valorMax: Number(campos.valorMax),
        contaDestino: campos.contaDestino,
        contaCredito: campos.contaCredito || null,
        lancaSozinha: campos.lancaSozinha === true,
        diaDoLancamento: campos.lancaSozinha === true ? Number(campos.diaDoLancamento) : null,
      });
      setCampos(CAMPOS_VAZIOS);
      setAbrindo(false);
      carregar();
    } catch (e) {
      // ⚠ A recusa do SERVIDOR aparece com a frase dele. A tela não a reescreve: ela pode recusar
      // por algo que o espelho não sabe (conta ambígua, plano da empresa).
      setAviso(mensagemDoErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function alternarAutomatico(regra) {
    const ligando = regra.lancaSozinha !== true;
    let dia = regra.diaDoLancamento;
    if (ligando) {
      // ⚠⚠ O DIA É PERGUNTADO, nunca sugerido. Um padrão aqui seria o sistema escolhendo a data em
      // que a despesa entra no razão — a data não se arbitra.
      const resposta = window.prompt(
        "Em que dia do mês esta regra deve lançar? (1 a 31)\n\n"
        + "Atenção: a partir daí, toda nota deste fornecedor dentro da faixa vira lançamento "
        + "contábil sem ninguém clicar. A data é PRESUMIDA — o extrato do banco a corrige quando o "
        + "débito real chegar.",
        regra.diaDoLancamento ? String(regra.diaDoLancamento) : "",
      );
      if (resposta === null) return;
      dia = Number(resposta);
    }
    setEnviando(true);
    setAviso(null);
    try {
      await regrasApi.patchConferenciaRegraAutomatico(companyId, regra.id, {
        lancaSozinha: ligando,
        diaDoLancamento: ligando ? dia : null,
      });
      carregar();
    } catch (e) {
      setAviso(mensagemDoErro(e));
    } finally {
      setEnviando(false);
    }
  }

  // ⚠ O painel some sozinho quando não há regra nem porta — mesmo desenho dos outros desta tela.
  if (estado.carregando) return null;
  if (estado.indisponivel && !estado.regras.length) {
    return (
      <div style={{ ...card, color: "var(--text-muted)" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>Regras do fornecedor</h3>
        <p style={{ margin: "8px 0 0" }}>
          A tabela de regras ainda não existe neste banco — a migration não foi aplicada. Nenhuma
          regra pode ser lida nem escrita até isso ser feito.
        </p>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, flex: 1, fontSize: "1rem" }}>Regras do fornecedor</h3>
        {podeEscrever ? (
          <Button size="sm" variant="secondary" onClick={() => setAbrindo((v) => !v)}>
            {abrindo ? "Cancelar" : "Nova regra"}
          </Button>
        ) : null}
      </div>

      <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
        A regra diz em que conta a despesa deste fornecedor entra. Marcada para lançar sozinha, ela
        cria o lançamento sem ninguém clicar.
      </p>

      {aviso ? (
        <div role="alert" style={{ marginTop: 12, color: "var(--state-danger)" }}>{aviso}</div>
      ) : null}

      {abrindo ? (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>CNPJ do fornecedor</span>
              <input
                style={campo}
                value={campos.cnpjFornecedor}
                inputMode="numeric"
                placeholder="só dígitos"
                onChange={(e) => setCampos((c) => ({ ...c, cnpjFornecedor: e.target.value }))}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>ou padrão da descrição</span>
              <input
                style={campo}
                value={campos.padraoDescricao}
                onChange={(e) => setCampos((c) => ({ ...c, padraoDescricao: e.target.value }))}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Valor mínimo</span>
              <input
                style={campo}
                inputMode="decimal"
                value={campos.valorMin}
                onChange={(e) => setCampos((c) => ({ ...c, valorMin: e.target.value }))}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Valor máximo</span>
              <input
                style={campo}
                inputMode="decimal"
                value={campos.valorMax}
                onChange={(e) => setCampos((c) => ({ ...c, valorMax: e.target.value }))}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 13 }}>Débito (a despesa)</span>
              <select
                style={campo}
                value={campos.contaDestino}
                onChange={(e) => setCampos((c) => ({ ...c, contaDestino: e.target.value }))}
              >
                <option value="">Escolha…</option>
                {debitos.map((c) => (
                  <option key={c.codigoCompleto} value={c.codigoCompleto}>
                    {c.codigoCompleto} · {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              {/* ⚠⚠ SÓ DISPONIBILIDADE. O seletor não oferece o plano inteiro: o lançamento afirma
                  de ONDE o dinheiro saiu, e uma conta de despesa como crédito seria uma mentira. */}
              <span style={{ fontSize: 13 }}>Crédito (caixa ou banco)</span>
              <select
                style={campo}
                value={campos.contaCredito}
                onChange={(e) => setCampos((c) => ({ ...c, contaCredito: e.target.value }))}
              >
                {/* ⚠ Vazio CONTINUA VALENDO: é "não escolhi", e o caixa de hoje segue. */}
                <option value="">Manter o caixa padrão</option>
                {creditos.map((c) => (
                  <option key={c.codigoCompleto} value={c.codigoCompleto}>
                    {c.codigoCompleto} · {c.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={campos.lancaSozinha === true}
              onChange={(e) => setCampos((c) => ({ ...c, lancaSozinha: e.target.checked === true }))}
            />
            <span style={{ fontSize: 13 }}>
              <strong>Lançar sozinha</strong> — toda nota deste fornecedor dentro da faixa vira
              lançamento contábil sem ninguém clicar.
            </span>
          </label>

          {campos.lancaSozinha ? (
            <label style={{ display: "grid", gap: 4, maxWidth: 220 }}>
              <span style={{ fontSize: 13 }}>Dia do mês em que ela lança</span>
              <input
                style={campo}
                inputMode="numeric"
                value={campos.diaDoLancamento}
                onChange={(e) => setCampos((c) => ({ ...c, diaDoLancamento: e.target.value }))}
              />
              {/* ⚠⚠ O CUSTO DA DATA FIXA VAI ESCRITO NA TELA, não num comentário: o lançamento
                  AFIRMA que o dinheiro saiu naquele dia, e ninguém provou isso. */}
              <span style={{ fontSize: 12, color: "var(--state-warn)" }}>
                A data é presumida — ninguém provou que o dinheiro saiu nesse dia. Quando o débito
                do extrato chegar, ele corrige a data do lançamento que já existe.
              </span>
            </label>
          ) : null}

          {/* ⚠ O botão desabilitado DIZ O QUE FALTA. Sem o motivo, a pessoa preenche tudo de novo
              sem saber o que está errado. */}
          {!veredito.pode ? (
            <div style={{ color: "var(--state-warn)", fontSize: 13 }}>{veredito.frase}</div>
          ) : null}

          <div>
            <Button size="sm" disabled={!veredito.pode || enviando} onClick={criar}>
              {enviando ? "Salvando…" : "Criar regra"}
            </Button>
          </div>
        </div>
      ) : null}

      {estado.regras.length ? (
        <ul style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 10 }}>
          {estado.regras.map((r) => {
            const comportamento = comportamentoDaRegra(r);
            const podeAlternar = podeEscrever && comportamento !== COMPORTAMENTO.NAO_PODE_LANCAR
              && comportamento !== COMPORTAMENTO.DESLIGADA;
            return (
              <li
                key={r.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div>
                    <strong>{r.cnpjFornecedor ? cnpjBr(r.cnpjFornecedor) : r.padraoDescricao}</strong>
                    <span style={{ color: "var(--text-muted)" }}>
                      {" "}· {brl(r.valorMin)} a {brl(r.valorMax)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    D {r.contaDestino} / C {r.contaCredito || "caixa padrão"}
                    {typeof r.aplicacoes === "number" ? ` · ${r.aplicacoes} aplicações` : ""}
                  </div>
                  <div style={{ fontSize: 13, color: TOKEN_DO_COMPORTAMENTO[comportamento] }}>
                    {fraseDaRegra(r)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={r.lancaSozinha ? "secondary" : "primary"}
                  disabled={!podeAlternar || enviando}
                  title={podeAlternar ? undefined : fraseDaRegra(r)}
                  onClick={() => alternarAutomatico(r)}
                >
                  {r.lancaSozinha ? "Parar de lançar sozinha" : "Lançar sozinha"}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p style={{ margin: "16px 0 0", color: "var(--text-muted)" }}>
          Nenhuma regra nesta empresa. Cada despesa continua esperando o seu clique.
        </p>
      )}
    </div>
  );
}
