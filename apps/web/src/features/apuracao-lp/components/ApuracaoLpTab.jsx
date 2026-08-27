// A ABA DE APURAÇÃO DO LUCRO PRESUMIDO.
//
// Pedido do dono (27/08/2026): *"vamos abrir a aba de apuração delas, lá quando calcularmos vai
// aparecer todo o cálculo da presunção de cada imposto e o valor final, junto de sua alíquota
// efetiva"*.
//
// ⚠⚠ NADA AQUI TRANSMITE, DECLARA, PAGA OU CHAMA O SERPRO. A rota é só leitura: ela lê as notas já
// capturadas e a DARF já capturada. Quem gasta chamada PAGA continua sendo o botão "Buscar tributos
// do Presumido", na aba Lançamentos, que não foi tocado.
//
// ⚠ A CONTA é do backend e a LEITURA é de `lib/apuracaoLpTela.js` (46 testes). Este arquivo é
// ligação: ele não calcula nem decide cor por conta própria.

import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "../../../api/client";
import { Painel } from "../../../components/ui/Painel";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import {
  PERIODO, fraseDaAusencia,
  linhasDaMemoriaDeCalculo, leituraDaCargaEfetiva, linhasDaConferencia, resumoDaConferencia,
  avisoDaQuota, avisoDosServicos16, dinheiro, pct,
} from "../lib/apuracaoLpTela";

const api = createApiClient();

/**
 * ⚠⚠ OS TRÊS ESTADOS DA REGRA DOS R$ 120.000, e o do meio é o que não pode sumir.
 *
 * "Não perguntado" NÃO é "não" — os dois produzem 32% e são afirmações diferentes. Um seletor de
 * dois valores obrigaria o contador a responder algo que ele talvez não saiba, e a resposta ficaria
 * indistinguível de uma decisão tomada.
 */
const ESCOLHAS_16 = [
  { valor: null, rotulo: "Não avaliado" },
  { valor: true, rotulo: "Sim, enquadra" },
  { valor: false, rotulo: "Não enquadra" },
];

const TOM_DA_CELULA = {
  ok: "var(--state-ok)",
  atencao: "var(--state-warn)",
  neutro: "var(--text-muted)",
};

export function ApuracaoLpTab({ companyId, competencia, razao }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [servicos16, setServicos16] = useState(null);

  const carregar = useCallback(async () => {
    if (!companyId || !competencia) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await api.getApuracaoLp(companyId, competencia, { servicos16 });
      setDados(r);
    } catch (e) {
      // ⚠ A recusa por regime (409) chega aqui com a mensagem do servidor, que já diz PARA ONDE IR.
      // Reescrevê-la aqui daria duas frases para a mesma recusa.
      setErro(e?.message || e?.reason || "Não foi possível calcular a apuração.");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [companyId, competencia, servicos16]);

  useEffect(() => { carregar(); }, [carregar]);

  if (erro) {
    return (
      <Aviso tom="erro" titulo="A apuração não pôde ser calculada" role="alert" acao={<Button onClick={carregar}>Tentar de novo</Button>}>
        {erro}
      </Aviso>
    );
  }

  if (!dados && carregando) {
    return <div style={{ padding: "var(--space-6)", color: "var(--text-muted)" }}>Calculando…</div>;
  }

  if (!dados) return null;

  const linhas = linhasDaMemoriaDeCalculo(dados);
  const carga = leituraDaCargaEfetiva(dados.cargaEfetiva);
  const tributosDeclarados = Object.keys(dados.debitosDaGuia || {});
  const conferencia = linhasDaConferencia(dados.reconciliacao, { temDeclaracao: tributosDeclarados.length > 0 });
  // ⚠ Os tributos que a DARF traz separam "ninguém buscou a declaração" de "buscou, e nada do que
  // veio entra nesta conferência" — ver `resumoDaConferencia`. Sem isto a tela se contradizia.
  const resumo = resumoDaConferencia(dados.reconciliacao, { tributosDeclarados });
  const quota = avisoDaQuota(dados.quotaDeTrimestreAnterior);
  const aviso16 = avisoDosServicos16(dados.servicos16);
  const totalApurado = dados.trimestre ? dados.trimestre.total : (dados.pis ?? 0) + (dados.cofins ?? 0);

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {/* ⚠ O regime desconhecido é dito ANTES de qualquer número — senão o cálculo se lê como
          apuração conferida de uma empresa cujo regime ninguém cadastrou. */}
      {dados.avisoDeRegime ? (
        <Aviso tom="atencao" titulo="O regime desta empresa não está cadastrado">
          {dados.avisoDeRegime}
        </Aviso>
      ) : null}

      <Painel titulo={`Apuração do Lucro Presumido — ${competencia}`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "flex-start" }}>
          <Numero rotulo="Receita de serviços (mês)" valor={dinheiro(dados.receita?.servicos)} />
          <Numero rotulo="Receita de mercadorias (mês)" valor={dinheiro(dados.receita?.mercadorias)} />
          <Numero
            rotulo={dados.trimestre ? "Total apurado no trimestre" : "Apurado neste mês"}
            valor={dinheiro(totalApurado)}
            destaque
          />
          <Numero rotulo={carga.rotulo} valor={carga.texto} destaque tom={carga.tom} />
        </div>

        {/* ⚠⚠ A RESSALVA VAI EM TEXTO, não em `title` nem só em cor: impressão em preto e branco e
            navegação por teclado tiram os dois, e 3,65% sem ela se lê como "o Presumido custa
            3,65%". */}
        {carga.ressalva ? (
          <Aviso
            tom={carga.tom === "atencao" ? "atencao" : "neutro"}
            titulo={carga.tituloDaRessalva}
            compacto
            style={{ marginTop: "var(--space-3)" }}
          >
            {carga.ressalva}
          </Aviso>
        ) : null}

        <div style={{ marginTop: "var(--space-3)", display: "flex", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={carregar} disabled={carregando}>
            {carregando ? "Calculando…" : "Recalcular"}
          </Button>
        </div>
      </Painel>

      {quota ? (
        <Aviso tom={quota.tom} titulo={quota.titulo}>
          {quota.texto}
          {quota.tributos.length ? (
            <div style={{ marginTop: 6 }}>
              {quota.tributos.map((t) => `${t.tributo} ${dinheiro(t.valor)}`).join(" · ")}
            </div>
          ) : null}
        </Aviso>
      ) : null}

      <Painel titulo="Memória de cálculo">
        <div style={{ overflowX: "auto" }}>
          <table className="tabela--densa" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Tributo</th>
                <th>Período</th>
                <th>Base de cálculo</th>
                <th className="tabela__num">Alíquota</th>
                <th className="tabela__num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave}>
                  <td>{l.tributo}</td>
                  <td style={{ color: "var(--text-faint)" }}>
                    {l.periodo === PERIODO.TRIMESTRE ? "trimestre" : "mês"}
                  </td>
                  <td>
                    {/* ⚠⚠ CÉLULA VAZIA É PROIBIDA. Sem valor, sai o MOTIVO — branco se lê como zero,
                        e zero aqui afirmaria que a empresa não deve o tributo. */}
                    {l.ausencia ? (
                      <span style={{ color: "var(--text-faint)" }}>{fraseDaAusencia(l.ausencia)}</span>
                    ) : (
                      <>
                        <strong>{dinheiro(l.base)}</strong>
                        {l.baseDescricao ? (
                          <div style={{ color: "var(--text-faint)", fontSize: "0.72rem" }}>{l.baseDescricao}</div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="tabela__num">{pct(l.aliquota)}</td>
                  <td className="tabela__num">{dinheiro(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Painel>

      {aviso16 ? (
        <Painel titulo="Presunção de IRPJ dos serviços — a regra dos R$ 120.000">
          <Aviso tom={aviso16.tom} titulo={`Presunção aplicada: ${pct(aviso16.presuncao)}`}>
            {aviso16.texto}
          </Aviso>

          {aviso16.excecoes.length ? (
            <ul style={{ margin: "var(--space-3) 0 0", paddingLeft: "1.1rem", color: "var(--text-muted)", fontSize: "0.78rem" }}>
              {aviso16.excecoes.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : null}

          <div style={{ marginTop: "var(--space-3)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Esta empresa se enquadra?</span>
            {ESCOLHAS_16.map((e) => (
              <label key={String(e.valor)} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: "0.78rem" }}>
                <input
                  type="radio"
                  name="servicos16"
                  checked={servicos16 === e.valor}
                  onChange={() => setServicos16(e.valor)}
                />
                {e.rotulo}
              </label>
            ))}
          </div>

          {/* ⚠⚠ O CUSTO É DITO NA TELA, não escondido num comentário: não existe coluna para esta
              resposta, então ela vale só enquanto a tela estiver aberta. Sem esta frase, o contador
              acharia que respondeu de uma vez. */}
          <Aviso tom="neutro" titulo="Esta resposta não fica salva" compacto style={{ marginTop: "var(--space-3)" }}>
            Ela vale só para este cálculo, nesta tela. Não há campo no cadastro para guardá-la ainda.
          </Aviso>
        </Painel>
      ) : null}

      <Painel titulo="Conferência com a declaração (DCTFWeb)">
        <Aviso tom={resumo.tom} titulo="O que a conferência diz" compacto>
          {resumo.frase}
        </Aviso>

        <div style={{ overflowX: "auto", marginTop: "var(--space-3)" }}>
          <table className="tabela--densa" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Tributo</th>
                <th className="tabela__num">Nosso cálculo</th>
                <th className="tabela__num">Declarado</th>
                <th className="tabela__num">Diferença</th>
                <th>Conferência</th>
              </tr>
            </thead>
            <tbody>
              {conferencia.map((c) => (
                <tr key={c.tributo}>
                  <td>{c.tributo}</td>
                  <td className="tabela__num">{dinheiro(c.calculado)}</td>
                  <td className="tabela__num">{dinheiro(c.declarado)}</td>
                  <td className="tabela__num">{dinheiro(c.diferenca)}</td>
                  {/* ⚠ O estado sai em TEXTO, e a cor é reforço. "sem declaração capturada" e
                      "confere" não podem depender de o leitor distinguir dois tons. */}
                  <td style={{ color: TOM_DA_CELULA[c.tom] || "var(--text-muted)" }}>{c.rotulo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Painel>

      <Painel titulo="O que NÃO é calculado nesta tela">
        <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--text-muted)", fontSize: "0.78rem", display: "grid", gap: 6 }}>
          {(dados.naoCalculado || []).map((t) => (
            <li key={t.chave}>
              <strong style={{ color: "var(--text)" }}>{t.rotulo}</strong> — {t.motivo}
            </li>
          ))}
        </ul>
      </Painel>

      {/* ⚠ As observações do motor (receita de mercadorias, confirmação rebaixada) não somem: elas
          são o que a conta tem a dizer sobre si mesma. */}
      {(dados.observacoes || []).length ? (
        <Aviso tom="atencao" titulo="Observações desta apuração">
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {dados.observacoes.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </Aviso>
      ) : null}

      <p style={{ color: "var(--text-faint)", fontSize: "0.72rem", margin: 0 }}>
        {/* ⚠ A frase existe porque o contador precisa saber que abrir esta aba não gasta chamada
            paga nem transmite nada — a aba irmã (Apuração do Simples) faz as duas coisas. */}
        Esta tela é só leitura: ela calcula a partir das notas e da DARF já capturadas. Não consulta
        o SERPRO, não transmite e não declara nada. {razao ? `Empresa: ${razao}.` : ""}
      </p>
    </div>
  );
}

function Numero({ rotulo, valor, destaque = false, tom = "neutro" }) {
  return (
    <div style={{ minWidth: 170 }}>
      <div style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}>{rotulo}</div>
      <div
        style={{
          fontSize: destaque ? "1.35rem" : "1rem",
          fontWeight: 600,
          color: tom === "atencao" ? "var(--state-warn)" : "var(--text)",
        }}
      >
        {valor}
      </div>
    </div>
  );
}

export default ApuracaoLpTab;
