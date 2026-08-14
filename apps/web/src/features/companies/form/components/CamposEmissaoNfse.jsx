// CONFIGURAÇÃO DA EMISSÃO DE NFS-e — os três campos que existiam no banco e não existiam em tela.
//
// ⚠ POR QUE DIGITADO E NÃO SELETOR, se o município ao lado virou lista.
// O município tem uma lista OFICIAL, publicada pelo IBGE, que está versionada no projeto — por isso
// lá o contador ESCOLHE. Aqui não: a lista de serviços da LC 116 e a lista de códigos do município
// **não estão neste repositório**, e escrevê-las de memória (ou deduzi-las do CNAE) é o que a regra
// 1 do projeto proíbe. O erro sairia como nota emitida com o serviço errado, que é silencioso.
// Então o código é DIGITADO, e a tela valida só a FORMA que uma fonte já versionada prova.
//
// ⚠ NADA VEM PRÉ-PREENCHIDO, nem a série. "1" parece inofensivo, mas a série entra no identificador
// de toda nota emitida: um valor que o sistema escolheu sozinho seria indistinguível de um valor
// que o contador conferiu. Campo vazio é a verdade sobre uma empresa não configurada — e a caixa
// âmbar abaixo diz o que essa ausência impede, em vez de deixar a descoberta para a recusa.

import {
  lerCodigoServicoNacional,
  lerCodigoServicoMunicipal,
  lerRpsSerie,
  digitosQueVaoParaDps,
  MOTIVO_CODIGO_SERVICO_NACIONAL,
  MOTIVO_CODIGO_SERVICO_MUNICIPAL,
  MOTIVO_RPS_SERIE,
  PORQUE_DIGITADO_E_NAO_LISTA,
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
  codigoServicoMunicipal,
  rpsSerie,
  onChange,
}) {
  const nacional = lerCodigoServicoNacional(codigoServicoNacional);
  const municipal = lerCodigoServicoMunicipal(codigoServicoMunicipal);
  const serie = lerRpsSerie(rpsSerie);

  const naDps = digitosQueVaoParaDps(codigoServicoMunicipal);
  // Só vale avisar quando o corte MUDA o valor — repetir "vai 001" para quem digitou "001" é ruído.
  const municipalSeraCortado = Boolean(naDps && naDps !== municipal.valor);

  const faltando = [
    !nacional.preenchido && "o código nacional do serviço",
    !municipal.preenchido && "o código municipal do serviço",
    !serie.preenchido && "a série da DPS",
  ].filter(Boolean);

  return (
    <>
      <div className="full" style={{ borderTop: "1px solid #2b2d45", marginTop: 12, paddingTop: 12 }}>
        <strong style={{ fontSize: "0.9rem", color: "#F8F8F2" }}>Emissão de NFS-e</strong>
        <div style={{ ...AJUDA, marginTop: 4 }}>
          Configuração da nota de serviço que este sistema emite. {PORQUE_DIGITADO_E_NAO_LISTA}
        </div>
      </div>

      <Campo
        id="codigoServicoNacional"
        titulo="Código nacional do serviço"
        valor={codigoServicoNacional}
        onChange={(v) => onChange("codigoServicoNacional", v)}
        leitura={nacional}
        placeholder="171201"
        ajuda={MOTIVO_CODIGO_SERVICO_NACIONAL}
      />

      <Campo
        id="codigoServicoMunicipal"
        titulo="Código municipal do serviço"
        valor={codigoServicoMunicipal}
        onChange={(v) => onChange("codigoServicoMunicipal", v)}
        leitura={municipal}
        placeholder="001"
        ajuda={MOTIVO_CODIGO_SERVICO_MUNICIPAL}
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
        titulo="Série da DPS"
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
    </>
  );
}
