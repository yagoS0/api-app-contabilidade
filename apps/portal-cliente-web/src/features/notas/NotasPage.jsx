import { useEffect, useState } from "react";
import { api } from "../../api";
import { AlertaErro, CardNumero, Carregando, Chip, Vazio } from "../../components/ui";
import { useCarregamento } from "../../lib/hooks";
import {
  TRACO,
  brl,
  competenciaPadrao,
  competenciasRecentes,
  fmtCompetencia,
  fmtDateBr,
  fmtDoc,
  inteiro,
  somaOuTraco,
  texto,
} from "../../lib/format";

const OPCOES_COMPETENCIA = competenciasRecentes(12);
const LIMITE = 25;

// PortalInvoice.status: EMITIDA | CANCELADA | SUBSTITUIDA | REJEITADA | PENDENTE
// (apps/api/prisma/schema.prisma). O `data-status` do chip é o vocabulário do
// protótipo, então o de-para é explícito em vez de um toLowerCase() torcendo
// para bater.
const CHIP_POR_STATUS = {
  EMITIDA: { status: "emitida", rotulo: "Emitida" },
  CANCELADA: { status: "cancelada", rotulo: "Cancelada" },
  SUBSTITUIDA: { status: "substituida", rotulo: "Substituída" },
  REJEITADA: { status: "rejeitada", rotulo: "Rejeitada" },
  PENDENTE: { status: "processando", rotulo: "Pendente" },
};

function chipDaNota(status) {
  const chave = String(status || "").toUpperCase();
  return CHIP_POR_STATUS[chave] || { status: null, rotulo: texto(status) };
}

/**
 * Notas EMITIDAS pela empresa (direcao=emitidas, como no app mobile).
 *
 * ⚠ O `summary` é do FILTRO INTEIRO, não da página — é o backend que soma
 * (`prisma.aggregate`). Por isso ele vive fora da tabela: somar a coluna da
 * página daria outro número, menor, e ninguém saberia qual dos dois é o do mês.
 */
export function NotasPage({ empresa }) {
  const companyId = empresa.companyId;
  // ⚠ Abre no mês CORRENTE — decisão do dono, 18/08/2026 (ver `competenciaPadrao` em
  // `lib/format.js`). Antes abria em "Todas". ⚠ Isto ESTREITA o que a tela mostra ao abrir: quem
  // emitiu no mês passado não vê a nota de cara. Por isso o estado vazio abaixo NOMEIA a
  // competência e aponta para "Todas" — some da tela, mas não some sem dizer para onde foi.
  const [competencia, setCompetencia] = useState(competenciaPadrao);
  const [pagina, setPagina] = useState(1);

  // Trocar de empresa ou de competência recomeça na página 1: manter a página 4
  // de uma lista que agora tem 2 páginas mostra uma tela vazia que parece um bug.
  useEffect(() => {
    setPagina(1);
  }, [companyId, competencia]);

  const query = useCarregamento(
    () => api.getInvoices(companyId, { competencia: competencia || undefined, page: pagina, limit: LIMITE }),
    [companyId, competencia, pagina]
  );

  const resposta = query.dados;
  const notas = resposta?.data || [];
  const total = resposta?.total ?? 0;
  const limite = resposta?.limit ?? LIMITE;
  const totalPaginas = Math.max(1, Math.ceil(total / limite));
  const paginaAtual = resposta?.page ?? pagina;

  return (
    <>
      <div className="page-header">
        <h1>Notas emitidas</h1>
      </div>

      <div className="card">
        <div className="filters">
          <label htmlFor="competencia-notas">
            Competência
            <select
              id="competencia-notas"
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

      <div className="grid-2">
        <CardNumero
          rotulo={competencia ? `Notas em ${fmtCompetencia(competencia)}` : "Notas no período"}
          valor={resposta ? inteiro(resposta.summary?.totalInvoices) : TRACO}
          apoio="Total encontrado com o filtro atual"
        />
        <CardNumero
          rotulo="Valor total"
          valor={resposta ? somaOuTraco(resposta.summary?.totalAmount) : TRACO}
          apoio={
            resposta
              ? `Nesta página: ${somaOuTraco(resposta.summary?.pageAmount)}`
              : "Total encontrado com o filtro atual"
          }
          destaque
        />
      </div>

      <AlertaErro
        erro={query.erro}
        padrao="Não foi possível carregar as notas."
        aoTentarNovamente={query.recarregar}
      />

      {query.carregando ? (
        <Carregando>Carregando notas…</Carregando>
      ) : query.erro ? null : notas.length === 0 ? (
        <Vazio>
          {competencia
            ? `Nenhuma nota emitida em ${fmtCompetencia(competencia)}. Troque a competência acima — ou escolha "Todas" para ver o histórico inteiro.`
            : "Nenhuma nota emitida encontrada."}
        </Vazio>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Número</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Emissão</th>
                  <th scope="col">Competência</th>
                  <th scope="col">Tomador</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="num">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {notas.map((nota) => {
                  const chip = chipDaNota(nota.status);
                  return (
                    <tr key={nota.invoiceId}>
                      <td>{texto(nota.numero)}</td>
                      <td>{texto(nota.type)}</td>
                      <td>{fmtDateBr(nota.issueDate)}</td>
                      <td>{fmtCompetencia(nota.competencia)}</td>
                      <td>
                        <span className="truncar" title={texto(nota.tomador?.nome)}>
                          {texto(nota.tomador?.nome)}
                        </span>
                        <span className="muted" style={{ fontSize: ".78rem" }}>
                          {nota.tomador?.cnpjCpf ? fmtDoc(nota.tomador.cnpjCpf) : TRACO}
                        </span>
                      </td>
                      <td>
                        <Chip status={chip.status}>{chip.rotulo}</Chip>
                      </td>
                      <td className="num">{brl(nota.total)}</td>
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
              Página {inteiro(paginaAtual)} de {inteiro(totalPaginas)} · {inteiro(total)} nota(s)
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
