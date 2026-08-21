import { useEffect, useMemo, useRef, useState } from "react";
import {
  buscarMunicipios,
  carregarMunicipiosIbge,
  municipioPorCodigo,
  rotuloMunicipio,
  TAMANHO_CODIGO_IBGE,
} from "../../lib/municipios/municipioIbge";

/**
 * MUNICÍPIO POR NOME — a pessoa ESCOLHE numa lista oficial; o código IBGE vem junto da escolha.
 *
 * ⚠ ANTES ERAM SETE DÍGITOS DIGITADOS À MÃO. Pedido do dono, 18/08/2026. Um dígito trocado emite a
 * nota apontando o ISS para outro município, e o erro é silencioso: nada na tela nem no servidor
 * sabe que 3550308 devia ser 3550408.
 *
 * ⚠ ESCOLHER NÃO É DERIVAR. Nada aqui converte nome→código por conta própria; o que a busca faz é
 * mostrar as linhas da tabela oficial para que a escolha seja de quem lê. Por isso, e sem exceção:
 *   • NADA vem pré-selecionado;
 *   • **resultado único NÃO se autosseleciona**, e `Enter` sem item marcado não elege ninguém —
 *     numa nota fiscal, "só sobrou um" não é o mesmo que "é este";
 *   • toda opção mostra MUNICÍPIO **e** UF — é a UF que desambigua o homônimo (há cinco "Bom
 *     Jesus" no país).
 *
 * ⚠ A LISTA ENTRA POR `import()` DINÂMICO (ver `lib/municipios/municipioIbge.js`): são ~197 KB que
 * não podem pesar no bundle inicial de um portal que abre numa tela de login.
 *
 * ⚠ CÓDIGO QUE NÃO ESTÁ NA LISTA APARECE COMO TAL. O campo pode ser preenchido de fora (a consulta
 * do CNPJ escreve o `cMun` do tomador); se o código não casar com nenhuma linha, a tela diz "fora
 * da lista" em vez de mostrar um espaço em branco que parece vazio.
 */
export function SeletorMunicipio({
  id,
  rotulo,
  valor,
  onChange,
  ajuda = null,
  aoLadoDoRotulo = null,
  limite = 40,
}) {
  const [lista, setLista] = useState(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const vivo = useRef(true);
  const idLista = `${id}-lista`;

  useEffect(() => {
    vivo.current = true;
    carregarMunicipiosIbge()
      .then((dados) => {
        if (vivo.current) setLista(dados);
      })
      .catch(() => {
        if (vivo.current) setErroCarga(true);
      });
    return () => {
      vivo.current = false;
    };
  }, []);

  const codigo = String(valor || "").replace(/\D+/g, "");
  const escolhido = useMemo(
    () => (lista && codigo.length === TAMANHO_CODIGO_IBGE ? municipioPorCodigo(lista, codigo) : null),
    [lista, codigo]
  );

  const resultado = useMemo(
    () => (lista && aberto ? buscarMunicipios(lista, termo, { limite }) : { itens: [], total: 0 }),
    [lista, aberto, termo, limite]
  );
  const itens = resultado.itens;

  function fechar() {
    setAberto(false);
    setAtivo(-1);
  }

  function escolher(indice) {
    const m = itens[indice];
    if (!m) return;
    onChange(m[0]);
    setTermo("");
    fechar();
  }

  function aoTeclar(evento) {
    if (!aberto && (evento.key === "ArrowDown" || evento.key === "ArrowUp")) {
      setAberto(true);
      return;
    }
    if (!aberto || itens.length === 0) return;
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setAtivo((i) => (i + 1) % itens.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setAtivo((i) => (i - 1 + itens.length) % itens.length);
    } else if (evento.key === "Enter") {
      // ⚠ SÓ escolhe o que está marcado. Sem marcação, Enter não elege ninguém — nem com um
      // resultado só. E `preventDefault` sempre que a lista está aberta, senão o Enter da busca
      // ENVIA O FORMULÁRIO e emite a nota.
      evento.preventDefault();
      if (ativo >= 0) escolher(ativo);
    } else if (evento.key === "Escape") {
      fechar();
    }
  }

  // Já escolhido: mostra o que está gravado e some com a busca até pedirem para trocar.
  if (codigo.length === TAMANHO_CODIGO_IBGE && !aberto) {
    return (
      <div className="municipio">
        <span className="municipio-rotulo">
          {rotulo}
          {aoLadoDoRotulo}
        </span>
        <div className="municipio-escolhido">
          <strong>
            {escolhido
              ? rotuloMunicipio(escolhido)
              : lista
                ? "município fora da lista oficial"
                : "carregando a lista…"}
          </strong>
          <code>{codigo}</code>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setAberto(true);
              setTermo("");
            }}
          >
            Trocar
          </button>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              onChange("");
              setTermo("");
              setAberto(true);
            }}
          >
            Limpar
          </button>
        </div>
        {ajuda ? <span className="hint">{ajuda}</span> : null}
      </div>
    );
  }

  return (
    <div className="municipio">
      <label htmlFor={id}>
        {rotulo}
        {aoLadoDoRotulo}
        <input
          id={id}
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAberto(true);
            setAtivo(-1);
          }}
          onFocus={() => setAberto(true)}
          onBlur={() => fechar()}
          onKeyDown={aoTeclar}
          placeholder={lista ? "Buscar por nome (ex.: bom jesus rs) ou código" : "Carregando…"}
          disabled={!lista && !erroCarga}
          autoComplete="off"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={aberto && ativo >= 0 ? `${idLista}-${ativo}` : undefined}
        />
      </label>

      {erroCarga ? (
        // ⚠ "— digitar o código de sete dígitos à mão não é oferecido aqui de propósito" SAIU
        // (19/08/2026): é a NOSSA decisão de desenho, e o cliente não tem o que fazer com ela. O que
        // ele precisa — que a lista não carregou e o que fazer a respeito — ficou inteiro. A decisão
        // em si continua registrada no cabeçalho deste arquivo, que é onde ela é do programador.
        <span className="hint">
          Não foi possível carregar a lista de municípios do IBGE. Recarregue a página.
        </span>
      ) : null}

      {aberto && lista && termo.trim() !== "" ? (
        <div
          id={idLista}
          role="listbox"
          aria-label="Municípios encontrados"
          className="municipio-lista"
          // O clique precisa chegar antes de o blur fechar a lista.
          onMouseDown={(e) => e.preventDefault()}
        >
          {itens.length === 0 ? (
            <p className="municipio-vazio">
              Nenhum município com “{termo}”. Tente só o nome, ou nome + UF.
            </p>
          ) : (
            itens.map((m, i) => (
              <button
                key={m[0]}
                id={`${idLista}-${i}`}
                type="button"
                role="option"
                aria-selected={i === ativo}
                data-ativo={i === ativo ? "sim" : undefined}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(i)}
              >
                {/* Nome E UF, sempre — nunca só o nome. */}
                <span>
                  {m[1]} <span className="muted">/ {m[2]}</span>
                </span>
                <code>{m[0]}</code>
              </button>
            ))
          )}
          {resultado.total > itens.length ? (
            // ⚠ Recorte que não se anuncia faz escolher dentro de uma lista parcial achando que é a
            // lista inteira — e o município certo pode estar fora dela.
            <p className="municipio-vazio">
              Mostrando {itens.length} de {resultado.total} — refine a busca (acrescente a UF).
            </p>
          ) : null}
        </div>
      ) : null}

      {ajuda ? <span className="hint">{ajuda}</span> : null}
    </div>
  );
}
