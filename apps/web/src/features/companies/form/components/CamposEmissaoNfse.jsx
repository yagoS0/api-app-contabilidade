// CONFIGURAÇÃO DA EMISSÃO DE NFS-e — o que a empresa precisa ter para emitir nota de serviço.
//
// ⚠ O CÓDIGO NACIONAL DEIXOU DE SER DIGITADO (16/08/2026) e virou uma LISTA de escolhas.
// A razão do campo digitado estava escrita aqui e era literal: *"a lista de serviços da LC 116 não
// está neste repositório"*. Agora está — o Anexo B oficial do portal `gov.br/nfse` está versionado
// em `docs/lista-servico-nacional/` com hash. E o dono pediu **N códigos por empresa**, com a
// escolha na hora de emitir. Ver `SeletorServicosNacionais`.
//
// ⚠ O CÓDIGO MUNICIPAL CONTINUA DIGITADO, e o motivo é o mesmo de sempre, só que agora ele vale
// para um campo só: **não existe lista nacional de códigos municipais** — cada prefeitura publica a
// sua, e nenhuma delas está aqui. Inventá-la (ou deduzi-la do CNAE) é o que a regra 1 proíbe.
//
// ⚠ NADA VEM PRÉ-PREENCHIDO, nem a série. "1" parece inofensivo, mas a série entra no identificador
// de toda nota emitida: um valor que o sistema escolheu sozinho seria indistinguível de um valor
// que o contador conferiu. Campo vazio é a verdade sobre uma empresa não configurada — e a caixa
// âmbar abaixo diz o que essa ausência impede, em vez de deixar a descoberta para a recusa.

import { SeletorServicosNacionais } from "./SeletorServicosNacionais";
import { LiberacaoEmissaoCliente } from "./LiberacaoEmissaoCliente";
import { lerCodigosServicoNacional } from "../../../../lib/servicosNacionais/servicoNacional";
import {
  lerCodigoServicoMunicipal,
  lerRpsSerie,
  lerPercentualCarga,
  faltasDaCargaTributaria,
  digitosQueVaoParaDps,
  CAMPOS_CARGA_TRIBUTARIA,
  MOTIVO_CODIGO_SERVICO_MUNICIPAL,
  MOTIVO_RPS_SERIE,
  MOTIVO_CARGA_TRIBUTARIA,
  PORQUE_MUNICIPAL_DIGITADO,
  PORQUE_CARGA_DIGITADA,
  PORQUE_OS_TRES,
} from "../../../../lib/nfse/cadastroEmissaoNfse";

// Mesmo visual dos demais campos do formulário (`styles/tokens.css` + inline; sem Tailwind).
const CAIXA = {
  background: "#282A36", border: "1px solid #44475A", borderRadius: 5,
  color: "#F8F8F2", padding: "7px 9px", fontSize: "0.85rem", width: "100%",
  boxSizing: "border-box",
};

const AJUDA = { fontSize: 11, color: "#8A8FA3", lineHeight: 1.5 };

function Campo({ id, titulo, valor, onChange, leitura, ajuda, placeholder, extra }) {
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 4 }}>
      {titulo}
      <input
        id={id}
        value={valor}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        inputMode="numeric"
        style={{
          ...CAIXA,
          // Formato errado tem de ser visível no campo, não só na mensagem: quem digita olha o
          // campo. Ausência NÃO pinta de vermelho — vazio é legítimo (a empresa só não emite).
          borderColor: leitura.problema ? "var(--state-danger)" : "#44475A",
        }}
      />
      <span style={AJUDA}>{ajuda}</span>
      {extra}
      {leitura.problema && (
        <span style={{ fontSize: 11, color: "var(--state-danger)" }}>{leitura.problema}</span>
      )}
    </label>
  );
}

export function CamposEmissaoNfse({
  codigoServicoNacional,
  codigosServicoNacional,
  codigoServicoMunicipal,
  rpsSerie,
  // ⚠ CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012), decisão do dono de 18/08/2026. São campos do
  // formulário como os de cima — entram no `onChange` e são salvos pelo "Salvar alterações". Nada
  // aqui é ato fiscal com consequência imediata (diferente do portão `LiberacaoEmissaoCliente`),
  // é configuração da empresa.
  pTotTribFed = "",
  pTotTribEst = "",
  pTotTribMun = "",
  onChange,
  // ⚠ O QUE ENTRA ENTRE OS CAMPOS E O PORTÃO — hoje, o botão de salvar da ABA PRÓPRIA de emissão
  // (dono, 19/08/2026). Ele não pode ficar embaixo de tudo: depois do portão do cliente, um botão
  // "Salvar" pareceria salvar TAMBÉM a liberação — que não passa por salvar nenhum, grava no
  // clique da própria confirmação. Ausente (é o caso do cadastro de empresa NOVA), nada muda.
  acoesDosCampos = null,
  // ⚠ O PORTÃO DA EMISSÃO PELO CLIENTE não é campo do formulário — não entra no `onChange` nem é
  // salvo pelo "Salvar alterações". Vem do payload da empresa (`PortalClient`) e tem rota própria.
  emissaoCliente = null,
  razaoSocial = null,
  onSetEmissaoCliente = null,
  emissaoClienteSaving = false,
}) {
  const nacional = lerCodigosServicoNacional(codigosServicoNacional);
  const municipal = lerCodigoServicoMunicipal(codigoServicoMunicipal);
  const serie = lerRpsSerie(rpsSerie);

  const cargaValores = { pTotTribFed, pTotTribEst, pTotTribMun };
  const cargaFaltando = faltasDaCargaTributaria(cargaValores);
  // ⚠ TRÊS ESTADOS, não dois: nenhum preenchido (a empresa nem começou — e a optante do Simples
  // nunca precisa destes campos, então isto não é pendência para ela), ALGUNS preenchidos (o
  // caso perigoso: é exatamente aqui que a nota saía afirmando 0,00 nos outros) e os três prontos.
  const cargaParcial = cargaFaltando.length > 0 && cargaFaltando.length < CAMPOS_CARGA_TRIBUTARIA.length;

  const naDps = digitosQueVaoParaDps(codigoServicoMunicipal);
  // Só vale avisar quando o corte MUDA o valor — repetir "vai 001" para quem digitou "001" é ruído.
  const municipalSeraCortado = Boolean(naDps && naDps !== municipal.valor);

  const faltando = [
    !nacional.codigos.length && "o código nacional do serviço",
    !municipal.preenchido && "o código municipal do serviço",
    !serie.preenchido && "a série da DPS",
  ].filter(Boolean);

  // ⚠ MUDAR A LISTA MEXE NO CÓDIGO QUE A NOTA LEVA, e as três respostas são as MESMAS do backend
  // (`validateAndNormalizeCompanyProfile`) — a tela não pode prometer um desfecho diferente:
  //   • lista com UM código → é ele. Não há escolha a fazer, adotá-lo não é escolher por ninguém;
  //   • o marcado continua na lista → fica como está;
  //   • o marcado saiu da lista → LIMPA, e o seletor pede que se marque um. Eleger "o primeiro"
  //     seria o sistema decidindo qual serviço a empresa declara ao fisco.
  function trocarCodigos(novos) {
    onChange("codigosServicoNacional", novos);
    if (novos.length === 1) {
      onChange("codigoServicoNacional", novos[0]);
    } else if (!novos.includes(String(codigoServicoNacional || ""))) {
      onChange("codigoServicoNacional", "");
    }
  }

  return (
    <>
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Emissão de NFS-e</strong>
        <div style={{ ...AJUDA, marginTop: 4 }}>
          Configuração da nota de serviço que este sistema emite.
        </div>
      </div>

      {/* ⚠ VAI O VALOR CRU em `codigos`, não `nacional.codigos`. O seletor faz a própria leitura
          porque é ele que precisa dos `invalidos` — passar a lista já filtrada esconderia o código
          torto gravado, e o contador acharia que a empresa tem menos códigos do que tem. */}
      <SeletorServicosNacionais
        codigos={codigosServicoNacional}
        codigoDaNota={codigoServicoNacional}
        onChangeCodigos={trocarCodigos}
        onChangeCodigoDaNota={(v) => onChange("codigoServicoNacional", v)}
      />

      <Campo
        id="codigoServicoMunicipal"
        titulo="Código municipal do serviço"
        valor={codigoServicoMunicipal}
        onChange={(v) => onChange("codigoServicoMunicipal", v)}
        leitura={municipal}
        placeholder="001"
        ajuda={`${MOTIVO_CODIGO_SERVICO_MUNICIPAL} ${PORQUE_MUNICIPAL_DIGITADO}`}
        extra={municipalSeraCortado && (
          /* ⚠ O corte já existe no backend (`buildDpsXml` faz `.slice(-3)`) e é o que a fonte
             descreve ("cTribMun: código municipal (últimos 3 dígitos)"). Anunciá-lo é o que impede
             o "informei 10203 e a nota saiu com 203", descoberto só depois da emissão. */
          <span style={{ fontSize: 11, color: "var(--state-warn)" }}>
            ⚠ A nota leva os últimos 3 dígitos: <strong>{naDps}</strong>. É assim que o campo
            “cTribMun” é montado — confira se é esse o código do seu município.
          </span>
        )}
      />

      <Campo
        id="rpsSerie"
        /* ⚠ O RÓTULO MUDOU JUNTO COM O COMPORTAMENTO (16/08/2026): a série passou a ser LIDA da
           última nota emitida, inclusive das emitidas fora deste portal. Este campo deixou de ser
           "a série" e virou o PONTO DE PARTIDA — chamá-lo do que ele era faria o contador achar que
           mudar aqui muda a série de uma empresa que já emite. Ver `nfseNumeracao.js`. */
        titulo="Série da DPS (ponto de partida)"
        valor={rpsSerie}
        onChange={(v) => onChange("rpsSerie", v)}
        leitura={serie}
        placeholder="1"
        ajuda={MOTIVO_RPS_SERIE}
        extra={serie.valor && serie.valor !== String(rpsSerie).trim() && (
          <span style={AJUDA}>
            Na nota ela aparece com 5 dígitos: <strong style={{ color: "#F8F8F2" }}>{serie.valor}</strong>.
          </span>
        )}
      />

      {/* ── CARGA TRIBUTÁRIA APROXIMADA (Lei 12.741/2012) ──────────────────────────────────
          ⚠ O BLOCO RENDERIZA SEMPRE, e isso é decisão medida. Esconder por
          `Company.regimeTributario` seria o defeito: quem decide o `opSimpNac` da nota é o
          `CadastroFiscal` (é o que `resolverRegime` lê, com a `Company` só como segunda leitura).
          Uma empresa cujo cadastro fiscal diz LUCRO_PRESUMIDO e cuja `Company` ficou em SIMPLES
          teria a emissão recusada por falta destes percentuais SEM CAMPO ONDE PREENCHÊ-LOS — a
          mesma classe do defeito que criou este bloco inteiro. O texto diz a quem se aplica; a
          tela não decide o regime por conta própria. */}
      <div className="full" style={{ marginTop: 12 }}>
        <strong style={{ fontSize: "0.85rem", color: "#F8F8F2" }}>
          Carga tributária aproximada (Lei 12.741/2012)
        </strong>
        <div style={{ ...AJUDA, marginTop: 4 }}>
          {MOTIVO_CARGA_TRIBUTARIA} {PORQUE_CARGA_DIGITADA}
        </div>
      </div>

      {CAMPOS_CARGA_TRIBUTARIA.map(({ campo, rotulo }) => (
        <Campo
          key={campo}
          id={campo}
          titulo={`${rotulo} (%)`}
          valor={cargaValores[campo]}
          onChange={(v) => onChange(campo, v)}
          leitura={lerPercentualCarga(cargaValores[campo])}
          /* ⚠ SEM `placeholder` NUMÉRICO. Um "11,33" cinza no campo é indistinguível de um valor
             conferido a um metro de distância, e este número vai impresso ao tomador. O exemplo
             mora na mensagem de erro, onde não se confunde com conteúdo. */
          placeholder=""
          ajuda={
            campo === "pTotTribMun"
              ? "É a parcela MUNICIPAL da carga aproximada — a que varia de município para município. "
                + "⚠ Não é a alíquota de ISS da nota: elas podem coincidir e não são o mesmo campo."
              : `Parcela ${rotulo.toLowerCase()} da carga aproximada, em percentual do valor do serviço.`
          }
        />
      ))}

      {cargaParcial && (
        // ⚠ ESTA CAIXA É O CONSERTO DE 18/08/2026 APARECENDO NA TELA. Enquanto o portão do backend
        // usava `.some()`, configurar só um percentual EMITIA — e a nota afirmava 0,00 nos outros
        // dois. Hoje o servidor recusa; a tela avisa antes, e diz por quê.
        <div className="full" style={{
          border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)",
          borderRadius: 6, padding: "8px 10px", fontSize: "0.8rem", color: "var(--state-warn)",
        }}>
          <strong>
            Falta {cargaFaltando.map((c) => c.rotulo.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " e $1")}.
          </strong>{" "}
          {PORQUE_OS_TRES}
        </div>
      )}

      {faltando.length > 0 && (
        // ⚠ A AUSÊNCIA APARECE NO CADASTRO, com o que ela impede — e não só na hora de emitir.
        // `buildMissingFields` recusa a emissão por estes campos; descobrir isso pela recusa é o
        // oposto do que este projeto faz.
        <div className="full" style={{
          border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)",
          borderRadius: 6, padding: "8px 10px", fontSize: "0.8rem", color: "var(--state-warn)",
        }}>
          <strong>Falta {faltando.join(", ").replace(/, ([^,]*)$/, " e $1")}.</strong>{" "}
          Enquanto ficar assim, esta empresa <strong>não emite nota de serviço</strong>: o servidor
          recusa a emissão inteira por falta de configuração. A captura de notas e o resto do portal
          seguem funcionando.
        </div>
      )}

      {acoesDosCampos}

      {/* ⚠ QUEM PODE EMITIR vem DEPOIS de com o que emitir — a ordem é a do trabalho: primeiro a
          empresa fica configurada, depois se decide se o cliente pode usar essa configuração.
          O bloco não aparece no cadastro de empresa NOVA (não há empresa a liberar ainda). */}
      <LiberacaoEmissaoCliente
        emissaoCliente={emissaoCliente}
        razaoSocial={razaoSocial}
        onSetEmissaoCliente={onSetEmissaoCliente}
        saving={emissaoClienteSaving}
      />
    </>
  );
}
