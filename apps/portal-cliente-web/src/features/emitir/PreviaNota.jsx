import { TRACO, brl, fmtCnpj, fmtDateBr, fmtDoc, pct, texto } from "../../lib/format";

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
    issRetidoNoFormulario,
    issRetido,
    aliquota,
    issRetidoValor,
    liquido,
    pTotTribSN,
    // ⚠ Quem decide é `lib/impostosDaNota.js`, e a prévia só LÊ — a mesma resposta que o formulário
    // usou para renderizar e que `montarPayload` usou para montar o corpo.
    pTotTribSNNoFormulario,
    cargaAproximada,
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
        {/* ⚠ É a `dCompet` — a data que a NOTA declara como competência, e que a pessoa escolhe.
            A data e a hora da EMISSÃO (`dhEmi`) são as do instante da transmissão e o servidor as
            crava; por isso não aparecem aqui como se fossem escolhíveis. */}
        <div className="muted">
          Data da competência {competencia ? fmtDateBr(competencia) : TRACO}
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
            {/* ⚠ NO SIMPLES O ISS NÃO É UMA LINHA DESTA NOTA — ele está dentro do DAS, e a tela de
                emissão nem oferece o campo (decisão do dono, 18/08/2026). Escrever "ISSQN retido:
                Não" aqui daria a entender que houve uma escolha de retenção; o que houve é que a
                pergunta não se aplica. */}
            {issRetidoNoFormulario ? (
              <tr className="linha-info">
                <td>ISSQN retido pelo tomador</td>
                <td>{issRetido ? "Sim" : "Não"}</td>
              </tr>
            ) : null}
            {issRetidoNoFormulario && issRetido ? (
              <tr className="linha-info">
                <td>Alíquota do ISS</td>
                <td>{aliquota === null ? TRACO : pct(aliquota)}</td>
              </tr>
            ) : null}
            {/* ⚠ VAI IMPRESSO PARA O TOMADOR (Lei 12.741/2012), então precisa estar à vista antes
                de emitir. ⚠ Em branco é TRAÇO, nunca 0,00% — zero é uma afirmação sobre a carga
                tributária.

                ⚠⚠ **E SÓ NO SIMPLES — CONSERTO DE 20/08/2026, o mesmo do formulário.** Esta linha
                era renderizada sem condição de regime nenhuma: a empresa do Lucro Presumido lia
                "Tributos do Simples nesta nota: —" no espelho da própria nota. O traço não salva —
                a LINHA já afirma que esta nota declara tributos do Simples, e ela não declara
                (`NfseService` só escreve `<pTotTribSN>` sob `isSimples`). O não optante tem as três
                linhas da carga aproximada logo abaixo; o regime indefinido não tem nenhuma, porque
                ninguém sabe qual grupo a nota leva. */}
            {pTotTribSNNoFormulario ? (
              <tr className="linha-info">
                <td>Tributos do Simples nesta nota</td>
                <td>{pTotTribSN === null || pTotTribSN === undefined ? TRACO : pct(pTotTribSN)}</td>
              </tr>
            ) : null}
            {/* ⚠ A CARGA TRIBUTÁRIA APROXIMADA DA EMPRESA NÃO OPTANTE (Lei 12.741/2012) — dono,
                19/08/2026. Ela VAI IMPRESSA ao tomador, e até aqui o cliente do Presumido não a via
                em lugar nenhum antes de emitir: descobria o número na nota pronta, ou descobria a
                falta pela recusa.
                ⚠ SÓ LEITURA, vinda do cadastro que o CONTADOR configura — nenhuma destas linhas tem
                campo correspondente no formulário, e nenhuma delas vai no payload da emissão.
                ⚠ A LISTA VEM PRONTA DE `lib/cargaTributaria.js`, e chega `null` quando a pergunta
                não se aplica (Simples, regime indefinido) ou quando o cadastro não foi recebido —
                nada é decidido aqui. ⚠ Em branco é TRAÇO, nunca 0,00%: zero é uma AFIRMAÇÃO sobre a
                carga tributária, e a que falta é exatamente a que o servidor recusa. */}
            {cargaAproximada
              ? cargaAproximada.map((item) => (
                  <tr className="linha-info" key={item.campo}>
                    <td>Tributos aproximados · {item.rotulo}</td>
                    <td>{item.valor === null || item.valor === undefined ? TRACO : pct(item.valor)}</td>
                  </tr>
                ))
              : null}
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
