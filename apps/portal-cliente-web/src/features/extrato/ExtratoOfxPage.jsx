// ENVIAR O EXTRATO BANCÁRIO (OFX) — o cliente manda, e as saídas caem na fila do contador.
//
// ⚠⚠ NÃO EXISTE PREVIEW. O envio JÁ GRAVA: não há "conferir antes de enviar" a prometer, e a tela
// não pode sugerir que há. Quem torna o reenvio seguro é o dedupe por TRANSAÇÃO, no banco — por isso
// a frase que aparece ANTES do botão fala de reenviar, não de conferir.
//
// ⚠ ESTA TELA NÃO CONTABILIZA NADA. Tudo nasce na fila do contador, e é ele quem decide a conta.
// Dizer isso é o que impede o cliente de achar que "importei, então já está lançado".
//
// ⚠ Regra de tela mora em `lib/relatorioDoExtrato.js`, com teste próprio. Aqui é só a LIGAÇÃO.

import { useCallback, useRef, useState } from "react";
import { AlertaErro, Vazio } from "../../components/ui";
import {
  TOM,
  contagemDeDescartadas,
  fraseQuandoNadaEntrou,
  frasePorArquivoRepetido,
  leituraDaConta,
  linhasDoRelatorio,
} from "./lib/relatorioDoExtrato";

const CLASSE_POR_TOM = {
  [TOM.OK]: "chip chip--ok",
  [TOM.NEUTRO]: "chip",
  [TOM.ATENCAO]: "chip chip--warning",
};

export function ExtratoOfxPage({ empresa, api, aoVoltar }) {
  // ⚠⚠ É `companyId`, NÃO `id` — defeito real, achado NO NAVEGADOR em 26/08/2026.
  //
  // O objeto de empresa deste portal vem de `GET /client/companies` e a chave é `companyId`; as
  // cinco telas irmãs (`NotasPage`, `GuiasPage`, `EmitirNotaPage`, `LotePlanilhaPage`,
  // `SituacaoFiscalPage`) todas abrem com esta mesma linha. Com `empresa.id` a chamada saiu com
  // `undefined` e o mock respondeu **"Selecione uma empresa antes de continuar."**
  //
  // ⚠ O TESTE DE LIGAÇÃO NÃO PEGOU porque a fixture trazia `id` E `companyId`. Fixture mais generosa
  // que o dado real esconde exatamente esta classe de defeito — hoje ela traz só `companyId`.
  const companyId = empresa?.companyId;
  const [arquivo, setArquivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [relatorio, setRelatorio] = useState(null);
  const campoRef = useRef(null);

  const enviar = useCallback(async () => {
    if (!arquivo || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.importarExtratoOfx(companyId, arquivo);
      setRelatorio(r);
      // ⚠ O arquivo sai do campo depois do sucesso: deixá-lo ali convida ao segundo clique, e o
      // segundo clique é o caso que o dedupe cobre — mas o cliente não sabe disso.
      setArquivo(null);
      if (campoRef.current) campoRef.current.value = "";
    } catch (e) {
      // ⚠ A recusa do servidor chega com o TEXTO dela. `arquivo_grande_demais` diz o conserto
      // (dividir o período), e é ele que a pessoa precisa ler.
      setErro(e);
    } finally {
      setEnviando(false);
    }
  }, [api, arquivo, companyId, enviando]);

  const linhas = linhasDoRelatorio(relatorio);
  const nadaEntrou = fraseQuandoNadaEntrou(relatorio);
  const repetido = frasePorArquivoRepetido(relatorio);
  const conta = relatorio ? leituraDaConta(relatorio) : null;
  const descartes = relatorio ? contagemDeDescartadas(relatorio) : null;

  return (
    <div className="stack-gap">
      <div className="page-header">
        <h1>Enviar extrato bancário</h1>
        <button type="button" className="btn" onClick={aoVoltar}>Voltar</button>
      </div>

      <section className="card stack-gap">
        <p className="meta">
          Baixe o extrato do seu banco no formato <strong>OFX</strong> e envie aqui. As{" "}
          <strong>saídas</strong> viram despesas na fila do seu contador — ele confere e lança.
        </p>
        {/* ⚠ As duas frases que a tela NÃO pode omitir: o que ela não faz, e o que o envio faz. */}
        <p className="meta">
          As <strong>entradas</strong> ficam de fora: elas não são despesa. E nada aqui é lançado
          automaticamente — quem decide a conta contábil é o contador.
        </p>

        <label className="stack-gap">
          <span>Arquivo do extrato (.ofx)</span>
          <input
            ref={campoRef}
            type="file"
            accept=".ofx,.OFX,text/plain,application/x-ofx"
            disabled={enviando}
            onChange={(e) => {
              setArquivo(e.target.files?.[0] || null);
              // ⚠ Escolher outro arquivo limpa o erro anterior: manter a recusa do arquivo velho ao
              // lado do arquivo novo faria a pessoa ler uma sobre o outro.
              setErro(null);
            }}
          />
        </label>

        {/* ⚠⚠ A frase vem ANTES do botão, e fala de REENVIO — não de conferência. Não há preview:
            o envio grava. Prometer "conferir antes" seria descrever um passo que não existe. */}
        <p className="meta">
          O envio é imediato — não há uma etapa de conferência antes. Enviar o mesmo período duas
          vezes é seguro: as saídas que já entraram não entram de novo.
        </p>

        <div>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!arquivo || enviando}
            // ⚠ Botão desabilitado nunca é mudo.
            title={!arquivo ? "Escolha o arquivo do extrato." : undefined}
            onClick={enviar}
          >
            {enviando ? "Enviando…" : "Enviar extrato"}
          </button>
        </div>

        {erro ? (
          <AlertaErro erro={erro} padrao="Não foi possível enviar o extrato." />
        ) : null}
      </section>

      {relatorio ? (
        <section className="card stack-gap" data-extrato="relatorio">
          <div className="card-header">
            <h2>O que entrou</h2>
            <span className="meta">{conta.rotulo}</span>
          </div>

          {/* ⚠⚠ A frase que só o hash permite: sem ela, "arquivo repetido" e "período já importado"
              dão exatamente a mesma resposta ("0 novas"). */}
          {repetido ? <p className="meta meta--bloco">{repetido}</p> : null}

          {/* ⚠ "0 novas" nunca fica sozinho — os motivos de zero são diferentes. */}
          {nadaEntrou ? <p className="meta meta--bloco">{nadaEntrou}</p> : null}

          <ul className="stack-gap" style={{ listStyle: "none", padding: 0 }}>
            {linhas.map((l) => (
              <li key={l.chave} data-linha={l.chave}>
                <span className={CLASSE_POR_TOM[l.tom] || "chip"}>
                  {/* ⚠⚠ "PELO MENOS N" quando o total não veio — nunca um número com cara de final. */}
                  {l.aproximado ? `pelo menos ${l.valor}` : l.valor}
                </span>{" "}
                {l.rotulo}
                {l.nota ? <div className="meta">{l.nota}</div> : null}
              </li>
            ))}
          </ul>

          {conta.aviso ? <p className="meta meta--bloco">{conta.aviso}</p> : null}

          {/* ⚠ O que não deu para ler sai NOMEADO, com o motivo — silêncio aqui viraria "entrou
              tudo". A lista é a AMOSTRA; o número acima é o total. */}
          {descartes?.total > 0 && Array.isArray(relatorio.descartadas) && relatorio.descartadas.length ? (
            <div className="stack-gap">
              <h3>Linhas que não deu para ler</h3>
              {relatorio.descartadasTruncadas ? (
                <p className="meta">
                  Mostrando as {relatorio.descartadas.length} primeiras de {descartes.total}.
                </p>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Motivo</th><th>Data</th><th className="num">Valor</th></tr>
                  </thead>
                  <tbody>
                    {relatorio.descartadas.map((d, i) => (
                      <tr key={`${d.fitId || "sem-id"}-${i}`}>
                        <td>{d.motivo || "—"}</td>
                        <td>{d.dtPosted || "—"}</td>
                        <td className="num">{d.trnAmt || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <p className="meta">
            As saídas novas estão na fila do seu contador. Nada foi lançado ainda.
          </p>
        </section>
      ) : (
        <Vazio>Nenhum extrato enviado nesta sessão.</Vazio>
      )}
    </div>
  );
}
