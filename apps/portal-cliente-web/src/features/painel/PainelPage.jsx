import { api } from "../../api";
import { AlertaErro, CardNumero, Carregando } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { MOTIVO, aliquotaDoPainel } from "./lib/aliquotaDoPainel";
import { BlocoDeDemonstracao } from "./BlocoDeDemonstracao";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  inteiro,
  pct,
  somaOuTraco,
} from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);

function fraseDaAliquota(l, competencia) {
  const mes = fmtCompetencia(l.competencia || competencia);
  const inss = l.comFolha && l.impostoSobreFolha > 0 ? " · INSS incluído" : "";
  const incompletas = l.naoClassificadas > 0
    ? ` · ${inteiro(l.naoClassificadas)} lançamento(s) sem conta contábil ficaram de fora`
    : "";
  return `Alíquota lançada em ${mes}: ${pct(l.valor)}${inss}${incompletas}`;
}

function textoDaAliquota(l, competencia) {
  const mes = fmtCompetencia(competencia);
  if (l.motivo === MOTIVO.SEM_DADOS) return `Sem dados para ${mes}`;
  if (l.motivo === MOTIVO.SEM_RECEITA_LANCADA) return `A receita de ${mes} ainda não foi lançada na contabilidade`;
  if (l.motivo === MOTIVO.SEM_IMPOSTO_LANCADO) return `Os impostos de ${mes} ainda não foram provisionados`;
  if (l.motivo === MOTIVO.SEM_LANCAMENTO) return `Não há lançamentos contábeis em ${mes}`;
  if (l.motivo === MOTIVO.BLOCO_AUSENTE) return "Não foi possível calcular pela contabilidade";

  const comInss = l.comFolha && l.impostoSobreFolha > 0
    ? ` (INSS de ${somaOuTraco(l.impostoSobreFolha)} incluído)`
    : "";
  const base = `Impostos ${somaOuTraco(l.impostos)}${comInss} sobre receita de ${somaOuTraco(l.base)}`;
  return l.naoClassificadas > 0
    ? `${base} · ${inteiro(l.naoClassificadas)} lançamento(s) sem conta contábil ficaram de fora`
    : base;
}

export function PainelPage({ empresa, competencia: competenciaDaCasca, aoTrocarCompetencia, aoNavegar, aoEnviarExtrato, somenteLeitura = false }) {

  const competencia = competenciaDaCasca || competenciaPadrao();
  const setCompetencia = aoTrocarCompetencia || (() => {});
  const companyId = empresa.companyId;

  const notasQuery = useCarregamento(
    () => api.getInvoices(companyId, { competencia, page: 1, limit: 1 }),
    [companyId, competencia]
  );
  const aliquotaQuery = useCarregamento(
    () => api.getAliquotas(companyId, { from: competencia, to: competencia }),
    [companyId, competencia]
  );

  // Os cards usam a competência escolhida; o bloco mantém sua própria leitura do fluxo.
  const resumo = notasQuery.dados?.summary || null;
  const aliquota = aliquotaQuery.dados?.find((linha) => linha.competencia === competencia) || null;
  const leituraAliquota = aliquotaDoPainel({ empresa, linha: aliquota });
  const impostoBruto = leituraAliquota.comFolha
    ? aliquota?.deLancamentos?.impostosComFolha
    : aliquota?.deLancamentos?.impostos;
  const impostoDisponivel = leituraAliquota.valor != null
    && impostoBruto != null && impostoBruto !== "" && Number.isFinite(Number(impostoBruto));
  const impostos = impostoDisponivel ? leituraAliquota.impostos : null;
  const receita = resumo?.totalAmount;
  const receitaDisponivel = receita != null && receita !== "" && Number.isFinite(Number(receita));
  const resultado = receitaDisponivel && impostoDisponivel
    ? (Math.round(Number(receita) * 100) - Math.round(impostos * 100)) / 100
    : null;
  const apoioImposto = impostoDisponivel
    ? fraseDaAliquota(leituraAliquota, competencia)
    : leituraAliquota.valor != null
      ? `O valor dos impostos de ${fmtCompetencia(competencia)} não está disponível`
      : textoDaAliquota(leituraAliquota, competencia);
  const atualizarResumo = () => {
    notasQuery.recarregar();
    aliquotaQuery.recarregar();
  };

  const verTodasAsGuias = () => {
    aoTrocarCompetencia?.("");
    aoNavegar("guias");
  };

  const carregando = notasQuery.carregando || aliquotaQuery.carregando;
  const erro = notasQuery.erro || aliquotaQuery.erro;

  return (
    <>
      <div className="page-header">
        <h1>Início</h1>
        <div className="page-actions">
          <label htmlFor="competencia-home" className="sr-only">
            Competência
          </label>
          <select
            id="competencia-home"
            disabled={!aoTrocarCompetencia}
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className="select-auto"
          >
            {OPCOES_COMPETENCIA.map((c) => (
              <option key={c} value={c}>
                {fmtCompetencia(c)}
              </option>
            ))}
          </select>

          {aoEnviarExtrato ? (
            <button type="button" className="btn" onClick={aoEnviarExtrato}>
              Enviar extrato
            </button>
          ) : null}
        </div>
      </div>

      <AlertaErro
        erro={erro}
        padrao="Não foi possível carregar o resumo do mês."
        aoTentarNovamente={atualizarResumo}
      />

      {carregando ? (
        <Carregando>Carregando o resumo de {fmtCompetencia(competencia)}…</Carregando>
      ) : (
        <div className="grid-3">

          <CardNumero
            rotulo={`Receita · ${fmtCompetencia(competencia)}`}
            valor={receitaDisponivel ? brl(receita) : TRACO}
            apoio={
              resumo
                ? `${inteiro(resumo.totalInvoices)} nota(s) emitida(s)`
                : "Sem dados para esta competência"
            }
            destaque
          />

          <CardNumero
            rotulo={`Imposto líquido · ${fmtCompetencia(competencia)}`}
            valor={impostoDisponivel ? brl(impostos) : TRACO}
            apoio={apoioImposto}
          />
          <CardNumero
            rotulo={`Resultado · ${fmtCompetencia(competencia)}`}
            valor={resultado != null ? brl(resultado) : TRACO}
            apoio={resultado != null
              ? `Receita − impostos lançados na competência${leituraAliquota.naoClassificadas > 0 ? " · Resultado provisório: há lançamentos sem conta contábil" : ""}`
              : !receitaDisponivel
                ? "A receita desta competência não está disponível"
                : apoioImposto}
          />
        </div>
      )}

      <BlocoDeDemonstracao companyId={companyId} competencia={competencia} aoVerGuias={verTodasAsGuias} aoAtualizarFluxo={atualizarResumo} somenteLeitura={somenteLeitura} />
    </>
  );
}
