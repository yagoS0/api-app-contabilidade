// OS CÓDIGOS DE SERVIÇO DA EMPRESA — N códigos, escolhidos numa lista oficial, buscados por TEXTO.
//
// ⚠ DECISÃO DO DONO, 16/08/2026:
// > *"ao cadastrar podemos ter mais de um código, a empresa pode usar mais de uma atividade e na
// > hora da emissão ela deve escolher, ou seja, o contador cadastra os códigos de serviço, e na
// > hora de emitir aparecem apenas aqueles pré-cadastrados, existe uma lista da LC116 com texto vs
// > o código, devemos mostrar o texto para que facilite a escolha."*
//
// ⚠ O QUE MUDOU DESDE 14/08/2026, E O QUE AUTORIZOU A MUDANÇA. Este campo era DIGITADO, e a razão
// escrita aqui era literal: *"a lista de serviços da LC 116 não está neste repositório"*. Agora
// está — o Anexo B oficial do portal `gov.br/nfse` está versionado em
// `docs/lista-servico-nacional/` com URL, data, contagem e SHA-256. Some a razão, some o campo
// digitado. É o mesmo caminho que o município fez.
//
// ⚠ ESCOLHER NÃO É DERIVAR — a regra do seletor de município vale inteira aqui:
//   • NADA vem pré-selecionado, e não há de-para CNAE → serviço;
//   • a busca ENCONTRA: um único resultado também não se autosseleciona;
//   • toda opção mostra **código E texto** — o texto é o que faz achar, o código é o que vai na nota.
//
// ⚠ O `cTribNac` NÃO É O ITEM DA LC 116. Ele é `item(2)+subitem(2)+desdobro nacional(2)`. A lista
// mostra os DESDOBRAMENTOS (335), que é a granularidade que a nota carrega; o nome do item/subitem
// aparece como GRUPO, para orientar a busca, e não é selecionável.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buscarServicos,
  carregarServicosNacionais,
  formatarCodigoServicoNacional,
  grupoDoServico,
  lerCodigosServicoNacional,
  servicoPorCodigo,
  MOTIVO_CODIGOS_SERVICO_NACIONAL,
  PORQUE_LISTA_OFICIAL,
} from "../../../../lib/servicosNacionais/servicoNacional";

const LIMITE_VISIVEL = 40;

const CAIXA = {
  background: "#282A36", border: "1px solid #44475A", borderRadius: 5,
  color: "#F8F8F2", padding: "7px 9px", fontSize: "0.85rem", width: "100%",
  boxSizing: "border-box",
};

const AJUDA = { fontSize: 11, color: "#8A8FA3", lineHeight: 1.6 };

export function SeletorServicosNacionais({
  codigos,
  codigoDaNota,
  onChangeCodigos,
  onChangeCodigoDaNota,
  inputId = "codigosServicoNacional",
}) {
  const [dados, setDados] = useState(null);
  const [erroCarga, setErroCarga] = useState(null);
  const [termo, setTermo] = useState("");
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    carregarServicosNacionais()
      .then((d) => { if (vivo.current) setDados(d); })
      .catch(() => {
        if (vivo.current) setErroCarga("Não foi possível carregar a lista oficial de códigos de serviço.");
      });
    return () => { vivo.current = false; };
  }, []);

  const leitura = useMemo(() => lerCodigosServicoNacional(codigos), [codigos]);
  const escolhidos = leitura.codigos;

  const resultado = useMemo(
    () => (dados ? buscarServicos(dados.servicos, termo, { limite: LIMITE_VISIVEL, grupos: dados.grupos }) : { itens: [], total: 0 }),
    [dados, termo],
  );

  function acrescentar(codigo) {
    if (escolhidos.includes(codigo)) return;
    onChangeCodigos([...escolhidos, codigo]);
    setTermo("");
  }

  function remover(codigo) {
    onChangeCodigos(escolhidos.filter((c) => c !== codigo));
  }

  function descricaoDe(codigo) {
    if (!dados) return null;
    const s = servicoPorCodigo(dados.servicos, codigo);
    return s ? s[1] : null;
  }

  return (
    <div className="full" style={{ display: "grid", gap: 8 }}>
      <label htmlFor={inputId} style={{ display: "block" }}>
        Códigos de serviço (tributação nacional)
      </label>

      <div style={AJUDA}>
        {MOTIVO_CODIGOS_SERVICO_NACIONAL} {PORQUE_LISTA_OFICIAL}
      </div>

      {erroCarga && (
        <div style={{ fontSize: 12, color: "var(--state-danger)" }}>
          {erroCarga} Recarregue a página para tentar de novo — sem a lista não dá para escolher, e
          digitar o código à mão não é oferecido aqui de propósito.
        </div>
      )}

      {/* ⚠ Código gravado que não existe na lista NÃO SOME da tela. Sumir faria o contador achar
          que a empresa tem menos códigos do que tem — e o código torto continuaria no banco. */}
      {leitura.invalidos.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--state-warn)" }}>
          ⚠ Há {leitura.invalidos.length} valor(es) gravado(s) que não têm a forma de um código de
          tributação nacional ({leitura.invalidos.join(", ")}). Eles não aparecem na lista abaixo e
          precisam ser reescolhidos.
        </div>
      )}

      {/* ── O que já está cadastrado ─────────────────────────────────────────── */}
      {escolhidos.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {escolhidos.map((codigo) => {
            const descricao = descricaoDe(codigo);
            const grupo = dados ? grupoDoServico(dados.grupos, codigo) : null;
            return (
              <li
                key={codigo}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  border: "1px solid #44475A", borderRadius: 6, padding: "8px 10px", background: "#282A36",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", color: "#F8F8F2" }}>
                    <code style={{ color: "var(--accent-cyan)" }}>{formatarCodigoServicoNacional(codigo)}</code>
                    {" — "}
                    {descricao || (dados ? "código fora da lista oficial" : "carregando…")}
                  </div>
                  {grupo && (
                    <div style={{ ...AJUDA, marginTop: 2 }}>{grupo[1]}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remover(codigo)}
                  aria-label={`Remover ${formatarCodigoServicoNacional(codigo)}`}
                  style={{ background: "none", border: "none", color: "var(--state-danger)", cursor: "pointer", fontSize: "0.78rem" }}
                >
                  Remover
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        // ⚠ A AUSÊNCIA APARECE NO CADASTRO, com o que ela impede — e não só na hora de emitir.
        <div style={{
          border: "1px solid var(--state-warn)", background: "var(--state-warn-surface)",
          borderRadius: 6, padding: "8px 10px", fontSize: "0.8rem", color: "var(--state-warn)",
        }}>
          <strong>Nenhum código de serviço cadastrado.</strong>{" "}
          Enquanto ficar assim, esta empresa <strong>não emite nota de serviço</strong>: o servidor
          recusa a emissão inteira por falta do código nacional. A captura de notas e o resto do
          portal seguem funcionando.
        </div>
      )}

      {/* ── QUAL DELES A NOTA LEVA ───────────────────────────────────────────── */}
      {/* ⚠ ESTE BLOCO É UMA PONTE, e o motivo está escrito para quem vier depois: o dono pediu a
          escolha NA HORA DE EMITIR, e ela ainda não chega ao XML — `buildDpsXml` monta o `cTribNac`
          a partir de `company.codigoServicoNacional` e de mais nada, e não há campo de serviço no
          payload da emissão (`NfseService.js:540`). Enquanto for assim, a empresa com mais de um
          código precisa dizer AQUI qual vale, senão o cadastro descreve uma coisa e a nota declara
          outra. Com um código só não há o que escolher, e a tela não pergunta. */}
      {escolhidos.length > 1 && (
        <fieldset style={{ border: "1px solid #44475A", borderRadius: 6, padding: "8px 10px", margin: 0 }}>
          <legend style={{ fontSize: "0.8rem", color: "#F8F8F2", padding: "0 6px" }}>
            Qual destes a nota leva
          </legend>
          <div style={{ ...AJUDA, marginBottom: 6 }}>
            A escolha por emissão ainda não está ligada: hoje toda nota deste sistema sai com o
            código marcado abaixo. Os demais ficam cadastrados e aparecem na tela de emissão.
          </div>
          {escolhidos.map((codigo) => (
            <label key={codigo} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.82rem", cursor: "pointer", padding: "3px 0" }}>
              <input
                type="radio"
                name="codigoServicoNacionalDaNota"
                checked={String(codigoDaNota || "") === codigo}
                onChange={() => onChangeCodigoDaNota(codigo)}
              />
              <span>
                <code style={{ color: "var(--accent-cyan)" }}>{formatarCodigoServicoNacional(codigo)}</code>
                {" — "}
                {descricaoDe(codigo) || "…"}
              </span>
            </label>
          ))}
          {!escolhidos.includes(String(codigoDaNota || "")) && (
            <div style={{ fontSize: 11, color: "var(--state-danger)", marginTop: 6 }}>
              Escolha qual código a nota leva — sem isso o servidor recusa o cadastro
              (“company_codigo_servico_nacional_fora_da_lista”). O sistema não elege um por você:
              o serviço declarado é dado fiscal.
            </div>
          )}
        </fieldset>
      )}

      {/* ── A busca ──────────────────────────────────────────────────────────── */}
      <input
        id={inputId}
        value={termo}
        onChange={(event) => setTermo(event.target.value)}
        placeholder={dados ? "Buscar pelo TEXTO do serviço (ex.: contabilidade, telecomunicações) ou pelo código" : "Carregando a lista oficial…"}
        disabled={!dados}
        autoComplete="off"
        style={CAIXA}
      />

      {dados && termo.trim() !== "" && (
        resultado.total === 0 ? (
          <div style={{ fontSize: 12, color: "#8A8FA3" }}>
            Nenhum serviço com “{termo}”. Tente uma palavra só, ou o número do código.
          </div>
        ) : (
          <>
            <ul
              role="listbox"
              aria-label="Serviços encontrados"
              style={{
                listStyle: "none", margin: 0, padding: 0, maxHeight: 260, overflowY: "auto",
                border: "1px solid #44475A", borderRadius: 6, background: "#282A36",
              }}
            >
              {resultado.itens.map((s) => {
                const jaEscolhido = escolhidos.includes(s[0]);
                const grupo = grupoDoServico(dados.grupos, s[0]);
                return (
                  <li key={s[0]}>
                    <button
                      type="button"
                      onClick={() => acrescentar(s[0])}
                      disabled={jaEscolhido}
                      style={{
                        display: "flex", gap: 10, width: "100%", alignItems: "flex-start",
                        background: "none", border: "none", borderBottom: "1px solid #2b2d45",
                        color: jaEscolhido ? "#8A8FA3" : "#F8F8F2", padding: "7px 10px",
                        cursor: jaEscolhido ? "default" : "pointer",
                        fontSize: "0.85rem", textAlign: "left",
                      }}
                    >
                      <code style={{ color: jaEscolhido ? "#8A8FA3" : "var(--accent-cyan)", flex: "0 0 auto" }}>
                        {formatarCodigoServicoNacional(s[0])}
                      </code>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {s[1]}
                        {grupo && <span style={{ display: "block", ...AJUDA }}>{grupo[1]}</span>}
                      </span>
                      {jaEscolhido && <span style={{ flex: "0 0 auto", fontSize: "0.75rem" }}>já cadastrado</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div style={{ fontSize: 11, color: "#8A8FA3" }}>
              {resultado.total > resultado.itens.length
                /* ⚠ Recorte que não se anuncia faz o contador escolher dentro de uma lista parcial
                   achando que é a lista inteira — e o serviço dele pode estar fora. */
                ? `Mostrando ${resultado.itens.length} de ${resultado.total} — refine a busca.`
                : `${resultado.total} serviço(s) encontrado(s).`}
            </div>
          </>
        )
      )}
    </div>
  );
}
