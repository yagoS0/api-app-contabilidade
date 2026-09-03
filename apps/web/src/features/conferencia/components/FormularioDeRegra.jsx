// O FORMULÁRIO DE UMA REGRA DO FORNECEDOR — extraído de `PainelDeRegras.jsx` em 02/09/2026.
//
// ⚠⚠ POR QUE ELE SAIU DO PAINEL: o dono pediu que a LINHA da fila ofereça «Criar regra»
// (*"cada linha deve mostrar as opções de lançar, criar regra"*). Um segundo formulário, dentro do
// modal da linha, seria a cópia que diverge na primeira correção — e aqui a divergência sairia como
// uma regra criada pela linha que o painel não sabe ler. Então há UM formulário, com duas portas:
// o painel («Nova regra», vazio) e a linha (pré-preenchido com o que ela tem).
//
// ⚠⚠ O PRÉ-PREENCHIMENTO NÃO INVENTA NADA. A linha manda o que TEM: CNPJ, descrição, as contas
// digitadas e o VALOR. A faixa nasce `valorMin = valorMax = valor` — e a frase diz que é o valor
// desta linha e que a faixa se alarga à mão. Chutar "±20%" pareceria prestativo e seria o sistema
// decidindo quais despesas futuras casam com a regra, que é decisão do contador.
//
// ⚠ `lancaSozinha` nasce DESMARCADO sempre, venha de onde vier a abertura — é a segunda chave do
// lançamento automático, e ligar por padrão ligaria a automação em toda regra criada pela linha.

import { useMemo, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Button } from "../../../components/ui/Button";
import {
  contasDeCreditoOferecidas,
  contasDeDebitoOferecidas,
  validarRegra,
} from "../lib/regraDoFornecedor";

const regrasApi = createApiClient();

export const CAMPOS_VAZIOS = Object.freeze({
  cnpjFornecedor: "",
  padraoDescricao: "",
  valorMin: "",
  valorMax: "",
  contaDestino: "",
  contaCredito: "",
  lancaSozinha: false,
  diaDoLancamento: "",
});

const campo = {
  background: "var(--surface-2, var(--surface))",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  padding: "6px 8px",
  width: "100%",
};

function mensagemDoErro(e) {
  return e?.body?.message || e?.message || "Não foi possível concluir.";
}

const brl = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
};

/**
 * ⚠ Os valores iniciais que a LINHA da fila oferece ao formulário — uma função só, para o painel e
 * o teste lerem a mesma tradução. Nada aqui é decidido: é o que a linha tem, copiado.
 *
 * @param {object} item a linha da fila (o declarado serializado)
 * @param {{contaDestino?: string|null, contaCredito?: string|null}} contas o que está digitado nela
 */
export function iniciaisDaLinha(item, { contaDestino = null, contaCredito = null } = {}) {
  const valor = item?.valorAjustado ?? item?.valor;
  const n = Number(valor);
  const valorTexto = Number.isFinite(n) && n > 0 ? String(n) : "";
  return {
    ...CAMPOS_VAZIOS,
    cnpjFornecedor: String(item?.cnpjFornecedor || "").replace(/\D+/g, ""),
    // ⚠ A descrição ORIGINAL, não a normalizada: o contador lê e apara; a normalização é do motor.
    padraoDescricao: item?.cnpjFornecedor ? "" : String(item?.descricaoOriginal || ""),
    valorMin: valorTexto,
    valorMax: valorTexto,
    contaDestino: contaDestino || "",
    contaCredito: contaCredito || "",
  };
}

/**
 * @param {string}   companyId
 * @param {Array}    contas          o plano já carregado pela tela (uma busca só — ver a aba)
 * @param {object}   [iniciais]      valores de partida (a linha manda os dela)
 * @param {string}   [notaDaFaixa]   ⚠ quando a faixa veio de UMA linha, a frase que diz isso
 * @param {Function} aoSalvar        chamado com a regra criada
 * @param {Function} [aoCancelar]    quando existe, o botão «Cancelar» aparece
 */
export function FormularioDeRegra({
  companyId,
  contas = [],
  iniciais = null,
  notaDaFaixa = null,
  aoSalvar,
  aoCancelar = null,
}) {
  const [campos, setCampos] = useState(() => ({ ...CAMPOS_VAZIOS, ...(iniciais || {}), lancaSozinha: false }));
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const debitos = useMemo(() => contasDeDebitoOferecidas(contas), [contas]);
  const creditos = useMemo(() => contasDeCreditoOferecidas(contas), [contas]);
  const veredito = useMemo(() => validarRegra(campos, contas), [campos, contas]);

  async function criar() {
    setEnviando(true);
    setAviso(null);
    try {
      const r = await regrasApi.postConferenciaRegra(companyId, {
        cnpjFornecedor: campos.cnpjFornecedor || null,
        padraoDescricao: campos.padraoDescricao || null,
        valorMin: Number(campos.valorMin),
        valorMax: Number(campos.valorMax),
        contaDestino: campos.contaDestino,
        contaCredito: campos.contaCredito || null,
        // ⚠ `=== true` EXATO, nunca `Boolean(...)` — a string "false" de um formulário é verdadeira.
        lancaSozinha: campos.lancaSozinha === true,
        diaDoLancamento: campos.lancaSozinha === true ? Number(campos.diaDoLancamento) : null,
      });
      setCampos({ ...CAMPOS_VAZIOS });
      aoSalvar?.(r?.regra ?? r ?? null);
    } catch (e) {
      // ⚠ A recusa do SERVIDOR aparece com a frase dele. A tela não a reescreve: ela pode recusar
      // por algo que o espelho não sabe (conta ambígua, plano da empresa).
      setAviso(mensagemDoErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }} data-testid="formulario-de-regra">
      {aviso ? (
        <div role="alert" style={{ color: "var(--state-danger)" }}>{aviso}</div>
      ) : null}

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

      {/* ⚠⚠ A FAIXA VEIO DE UMA LINHA, E A TELA DIZ ISSO. `min = max = valor` não é uma faixa: é o
          valor de uma despesa. Sem esta frase o contador salvaria uma regra que só casa com o
          centavo exato — e acharia que a regra "não funciona" na nota seguinte. */}
      {notaDaFaixa ? (
        <div style={{ fontSize: 13, color: "var(--state-warn)" }}>{notaDaFaixa}</div>
      ) : null}

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

      <div style={{ display: "flex", gap: 8 }}>
        <Button size="sm" disabled={!veredito.pode || enviando} onClick={criar}>
          {enviando ? "Salvando…" : "Criar regra"}
        </Button>
        {aoCancelar ? (
          <Button size="sm" variant="secondary" disabled={enviando} onClick={aoCancelar}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export { brl };
