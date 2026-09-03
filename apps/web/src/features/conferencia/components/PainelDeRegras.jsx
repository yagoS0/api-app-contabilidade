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

import { useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";
import {
  comportamentoDaRegra,
  COMPORTAMENTO,
  fraseDaRegra,
} from "../lib/regraDoFornecedor";
// ⚠⚠ O FORMULÁRIO SAIU DAQUI em 02/09/2026 — a linha da fila também cria regra («Criar regra»), e um
// segundo formulário lá seria a cópia que diverge. UM formulário, duas portas. Ver o cabeçalho dele.
import { FormularioDeRegra } from "./FormularioDeRegra";

const regrasApi = createApiClient();

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 16,
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

function mensagemDoErro(e) {
  return e?.body?.message || e?.message || "Não foi possível concluir.";
}

export function PainelDeRegras({ companyId, contas = [], podeEscrever = true }) {
  const [estado, setEstado] = useState({ carregando: true, regras: [], indisponivel: false, erro: null });
  const [abrindo, setAbrindo] = useState(false);
  // ⚠ `enviando` FICOU no painel para o «Parar/Lançar sozinha» da lista — o formulário (que saiu
  // para `FormularioDeRegra`) tem o dele. Dois atos, dois ocupados: um não pode travar o outro.
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);

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
        <div style={{ marginTop: 16 }}>
          <FormularioDeRegra
            companyId={companyId}
            contas={contas}
            aoSalvar={() => {
              setAbrindo(false);
              carregar();
            }}
          />
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
