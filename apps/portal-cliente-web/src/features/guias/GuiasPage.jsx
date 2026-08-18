import { useEffect, useState } from "react";
import { api } from "../../api";
import { AlertaErro, Carregando, Chip, Vazio } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import { mensagemDeErro } from "../../lib/mensagens";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  fmtDateBr,
  inteiro,
  texto,
} from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);
const LIMITE = 25;

// Guide.paymentStatus: OPEN | PAID | OVERDUE (apps/api/prisma/schema.prisma).
// ⚠ Verde é CONCLUÍDO: só a guia PAGA leva verde. "Em aberto" é pendência
// (âmbar) e "vencida" é problema (vermelho) — se tudo fosse vermelho, nada se
// destacaria justamente na linha que precisa ser vista.
const CHIP_POR_PAGAMENTO = {
  PAID: { status: "emitida", rotulo: "Paga" },
  OVERDUE: { status: "rejeitada", rotulo: "Vencida" },
  OPEN: { status: "rascunho", rotulo: "Em aberto" },
};

function chipDaGuia(paymentStatus) {
  const chave = String(paymentStatus || "").toUpperCase();
  return CHIP_POR_PAGAMENTO[chave] || { status: null, rotulo: texto(paymentStatus) };
}

function rotuloDaGuia(guia) {
  // `parcelamentoLabel` existe para que uma parcela não apareça como "DAS" solto.
  if (guia.parcelamentoLabel) return guia.parcelamentoLabel;
  return texto(guia.tipo);
}

function baixarArquivo({ contentBase64, fileName, mimeType }) {
  const binario = window.atob(contentBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "guia.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sem o revoke o blob fica retido até a aba fechar.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Guias liberadas ao cliente.
 *
 * ⚠ A rota `/client/companies/:id/guides` já responde com `apenasLiberadas:
 * true` — o cliente só vê o que o contador liberou, e o download refaz a mesma
 * checagem (`liberadaCliente: true` no `where`). Esta tela NÃO tem, e não deve
 * ganhar, nenhum controle que contorne isso.
 *
 * Contrato lido em `toGuideResponse`
 * (apps/api/src/application/guides/GuideService.js) — o app mobile não consome
 * esta rota, então ela foi conferida na origem, não copiada de lá.
 */
export function GuiasPage({ empresa }) {
  const companyId = empresa.companyId;
  // ⚠ Abre no mês CORRENTE — decisão do dono, 18/08/2026 (ver `competenciaPadrao` em
  // `lib/format.js`). Antes abria em "Todas".
  //
  // ⚠ AQUI O ESTREITAMENTO MORDE MAIS QUE NAS NOTAS, e é por isso que o estado vazio é o que é: a
  // guia da competência 07 costuma ser LIBERADA em agosto, então a competência corrente
  // frequentemente não tem guia nenhuma. "Nenhuma guia" sem dizer de qual mês, numa tela em que o
  // cliente vem procurar o que pagar, é indistinguível de "o contador não liberou nada".
  const [competencia, setCompetencia] = useState(competenciaPadrao);
  const [pagina, setPagina] = useState(1);
  const [baixandoId, setBaixandoId] = useState(null);
  const [erroDownload, setErroDownload] = useState(null);

  useEffect(() => {
    setPagina(1);
  }, [companyId, competencia]);

  const query = useCarregamento(
    () => api.getGuides(companyId, { competencia: competencia || undefined, page: pagina, limit: LIMITE }),
    [companyId, competencia, pagina]
  );

  const resposta = query.dados;
  const guias = resposta?.data || [];
  const total = resposta?.total ?? 0;
  const limite = resposta?.limit ?? LIMITE;
  const totalPaginas = Math.max(1, Math.ceil(total / limite));
  const paginaAtual = resposta?.page ?? pagina;

  async function baixar(guia) {
    if (baixandoId) return;
    setBaixandoId(guia.guideId);
    setErroDownload(null);
    try {
      const arquivo = await api.downloadGuide(companyId, guia.guideId);
      if (!arquivo?.contentBase64) {
        setErroDownload("O arquivo desta guia ainda não está disponível.");
        return;
      }
      baixarArquivo(arquivo);
    } catch (err) {
      setErroDownload(mensagemDeErro(err, "Não foi possível baixar a guia."));
    } finally {
      setBaixandoId(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Guias</h1>
      </div>

      <div className="alerta alerta-info">
        <p>Aparecem aqui apenas as guias que o seu contador liberou.</p>
      </div>

      <div className="card">
        <div className="filters">
          <label htmlFor="competencia-guias">
            Competência
            <select
              id="competencia-guias"
              value={competencia}
              onChange={(e) => setCompetencia(e.target.value)}
            >
              <option value="">Todas</option>
              {OPCOES_COMPETENCIA.map((c) => (
                <option key={c} value={c}>
                  {fmtCompetencia(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {erroDownload ? (
        <div className="alerta alerta-erro" role="alert">
          <p>{erroDownload}</p>
        </div>
      ) : null}

      <AlertaErro
        erro={query.erro}
        padrao="Não foi possível carregar as guias."
        aoTentarNovamente={query.recarregar}
      />

      {query.carregando ? (
        <Carregando>Carregando guias…</Carregando>
      ) : query.erro ? null : guias.length === 0 ? (
        <Vazio>
          {competencia
            ? `Nenhuma guia liberada em ${fmtCompetencia(competencia)}. A guia de um mês costuma ser liberada no mês seguinte — troque a competência acima, ou escolha "Todas".`
            : "Nenhuma guia liberada para esta empresa até agora."}
        </Vazio>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Guia</th>
                  <th scope="col">Competência</th>
                  <th scope="col">Vencimento</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                  <th scope="col">Arquivo</th>
                </tr>
              </thead>
              <tbody>
                {guias.map((guia) => {
                  const chip = chipDaGuia(guia.paymentStatus);
                  return (
                    <tr key={guia.guideId}>
                      <td>
                        <span className="truncar" title={rotuloDaGuia(guia)}>
                          {rotuloDaGuia(guia)}
                        </span>
                        {guia.numeroParcela != null ? (
                          <span className="muted" style={{ fontSize: ".78rem" }}>
                            Parcela {inteiro(guia.numeroParcela)}
                            {guia.quantidadeParcelas != null
                              ? ` de ${inteiro(guia.quantidadeParcelas)}`
                              : ""}
                          </span>
                        ) : null}
                      </td>
                      <td>{fmtCompetencia(guia.competencia)}</td>
                      <td>{fmtDateBr(guia.vencimento)}</td>
                      <td>
                        <Chip status={chip.status}>{chip.rotulo}</Chip>
                        {guia.paymentConfirmedAt ? (
                          <span className="muted" style={{ fontSize: ".78rem", display: "block" }}>
                            em {fmtDateBr(guia.paymentConfirmedAt)}
                          </span>
                        ) : null}
                      </td>
                      <td className="num">
                        {/* `valor` é nullable no schema: guia sem valor lido do PDF sai como
                            traço, nunca como R$ 0,00 — zero aqui seria afirmar que não se deve nada. */}
                        {guia.valor == null ? TRACO : brl(guia.valor)}
                        {guia.valorRecalculado != null && guia.valorRecalculado !== guia.valor ? (
                          <span className="muted" style={{ fontSize: ".78rem", display: "block" }}>
                            recalculado {brl(guia.valorRecalculado)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn"
                          disabled={baixandoId === guia.guideId}
                          onClick={() => baixar(guia)}
                        >
                          {baixandoId === guia.guideId ? "Baixando…" : "Baixar PDF"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="paginacao">
            <button
              type="button"
              className="btn"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              Anterior
            </button>
            <span className="info">
              Página {inteiro(paginaAtual)} de {inteiro(totalPaginas)} · {inteiro(total)} guia(s)
            </span>
            <button
              type="button"
              className="btn"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </>
  );
}
