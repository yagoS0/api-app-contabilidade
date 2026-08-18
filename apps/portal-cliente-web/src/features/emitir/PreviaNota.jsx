import { TRACO, brl, fmtCnpj, fmtCompetencia, fmtDoc, pct, texto } from "../../lib/format";

/**
 * PRÉ-VISUALIZAÇÃO AO VIVO da nota — o vocabulário `.nfse-preview` do protótipo
 * (`prototipos/emissor-notas/`), que é a referência visual deste lado do portal.
 *
 * ⚠ ELA MOSTRA O QUE VAI SER DECLARADO, e por isso não completa nada. Campo em branco sai como
 * traço, nunca como `R$ 0,00` nem como texto de exemplo: zero é uma AFIRMAÇÃO (nesta tela,
 * afirmação fiscal), e ausência é ausência. É a mesma regra de `lib/format.js`.
 *
 * ⚠ TODO DADO AQUI É TEXTO EM JSX — o React escapa por construção. Nenhum `dangerouslySetInnerHTML`
 * mora nesta tela, e o que o usuário digita (nome do tomador, descrição) é exibido como texto.
 */
export function PreviaNota({ empresa, valores }) {
  const {
    tomadorNome,
    tomadorDoc,
    tomadorEmail,
    endereco,
    descricao,
    valorServicos,
    competencia,
    issRetido,
    aliquota,
    issRetidoValor,
    liquido,
    codigoServicoNacional,
  } = valores;

  const linhaEndereco = [
    endereco.xLgr && endereco.nro ? `${endereco.xLgr}, ${endereco.nro}` : endereco.xLgr,
    endereco.xCpl,
    endereco.xBairro,
    endereco.CEP ? `CEP ${endereco.CEP}` : null,
    endereco.cMun ? `IBGE ${endereco.cMun}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="nfse-preview">
      <header>
        <div>
          <strong>{texto(empresa.razao)}</strong>
          <div className="muted">{fmtCnpj(empresa.cnpj)}</div>
        </div>
        <div data-numero>
          Nº {TRACO}
          {/* ⚠ O número NÃO é escolhido aqui e não pode ser adivinhado: ele é reservado pelo
              servidor, numa transação, no instante da emissão. Mostrar um número provável seria
              inventar o dado mais sensível da nota. */}
          <div className="muted" style={{ fontSize: ".76rem" }}>
            gerado na emissão
          </div>
        </div>
      </header>

      <section>
        <h3>Tomador</h3>
        <div>{tomadorNome ? texto(tomadorNome) : <span className="vazio">A quem a nota é destinada</span>}</div>
        <div className="muted">{tomadorDoc ? fmtDoc(tomadorDoc) : TRACO}</div>
        {tomadorEmail ? <div className="muted">{texto(tomadorEmail)}</div> : null}
        <div className="muted">{linhaEndereco || TRACO}</div>
      </section>

      <section>
        <h3>Serviço</h3>
        <div style={{ whiteSpace: "pre-wrap" }}>
          {descricao ? texto(descricao) : <span className="vazio">O que foi prestado</span>}
        </div>
        <div className="muted">
          Competência {competencia ? fmtCompetencia(competencia) : TRACO}
        </div>
        <div className="muted">
          Código de serviço {codigoServicoNacional ? texto(codigoServicoNacional) : TRACO}
        </div>
      </section>

      <section>
        <h3>Valores</h3>
        <table>
          <tbody>
            <tr>
              <td>Valor dos serviços</td>
              <td>{valorServicos === null ? TRACO : brl(valorServicos)}</td>
            </tr>
            <tr className="linha-info">
              <td>ISSQN retido pelo tomador</td>
              <td>{issRetido ? "Sim" : "Não"}</td>
            </tr>
            {issRetido ? (
              <tr className="linha-info">
                <td>Alíquota do ISS</td>
                <td>{aliquota === null ? TRACO : pct(aliquota)}</td>
              </tr>
            ) : null}
            {issRetido ? (
              <tr>
                <td>ISS retido</td>
                {/* ⚠ Conta feita NESTA TELA sobre o que a pessoa digitou (valor × alíquota) —
                    não é um número que a nota traga. Sem valor ou sem alíquota, traço: um
                    "R$ 0,00" aqui afirmaria que nada será retido. */}
                <td>{issRetidoValor === null ? TRACO : `- ${brl(issRetidoValor)}`}</td>
              </tr>
            ) : null}
            <tr className="linha-total">
              <td>{issRetido ? "A receber do tomador" : "Valor da nota"}</td>
              <td>{liquido === null ? TRACO : brl(liquido)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
