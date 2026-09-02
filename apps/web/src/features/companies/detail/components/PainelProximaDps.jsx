// O QUE A PRÓXIMA NFS-e DESTA EMPRESA VAI LEVAR — o painel que não existia.
//
// ⚠⚠ POR QUE ELE VALE SOZINHO, com a integração desligada: hoje `regApTribSN` e `tribISSQN` são
// CONSTANTES dentro de `buildDpsXml`. Constante em código é invisível até a nota sair — o contador
// nunca teve como ver o que a empresa dele emite antes de emitir. Aqui os seis campos aparecem com
// o valor, a TAG do XML e a PROCEDÊNCIA.
//
// ⚠ A REGRA DE LEITURA MORA EM `lib/nfse/perfilEmissao.js`, com teste próprio e amarrada por teste
// à lista do backend. Este arquivo só LIGA — é o costume da casa, e é o que impede a tela e o
// servidor de discordarem sobre o mesmo campo.
//
// ⚠⚠ ELE NÃO PROMETE EFEITO QUE NÃO EXISTE. Com `INTEGRACAO_PERFIL_EMISSAO_NFSE` desligada o perfil
// ainda não manda no XML, e a frase do rodapé é CONDICIONAL ("sairiam diferentes"). Dizer "esta
// nota vai sair assim" seria uma frase falsa sobre documento fiscal.

import { useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Painel } from "../../../../components/ui/Painel";
import { Aviso } from "../../../../components/ui/Aviso";
import {
  CAMPOS_PERFIL_EMISSAO,
  ESTADO,
  FONTE,
  fraseDoEfeito,
  lerPainelDaProximaDps,
} from "../../../../lib/nfse/perfilEmissao";

/** A cor da procedência. ⚠ `CRAVADO` é âmbar: é pendência de configuração, não erro. */
const TOM_DA_FONTE = {
  [FONTE.PERFIL]: "var(--state-ok)",
  [FONTE.COMPANY]: "var(--text-muted)",
  [FONTE.CRAVADO]: "var(--state-warn)",
  [FONTE.INDEFINIDO]: "var(--text-faint)",
};

function LinhaDoCampo({ linha }) {
  return (
    <tr data-campo={linha.id}>
      <td>
        <div style={{ fontWeight: 500 }}>{linha.rotulo}</div>
        {/* ⚠ A tag do XML fica visível: é o que liga o que o contador configura ao que a Receita lê. */}
        <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "monospace" }}>
          {linha.tag}
        </div>
      </td>
      <td className="tabela__num" style={{ textAlign: "left" }}>
        <span style={{ fontWeight: linha.mudariaComPerfil ? 600 : 400 }}>{linha.texto}</span>
        {linha.mudariaComPerfil ? (
          // ⚠ O "antes" fica ao lado do "depois". Sem ele, "mudaria" é uma afirmação sem referência.
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            hoje: {linha.textoHoje}
          </div>
        ) : null}
      </td>
      <td>
        <span style={{ fontSize: 12, color: TOM_DA_FONTE[linha.fonte] || "var(--text-muted)" }}>
          {linha.textoDaFonte}
        </span>
      </td>
    </tr>
  );
}

export function PainelProximaDps({
  dados,
  carregando = false,
  podeEditar = false,
  salvando = false,
  onCriarDoCadastro,
  onMarcarPadrao,
}) {
  const painel = useMemo(() => lerPainelDaProximaDps(dados), [dados]);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");

  if (carregando) {
    return (
      <Painel titulo="O que a próxima nota vai levar">
        <p className="text-muted">Carregando…</p>
      </Painel>
    );
  }

  // ⚠⚠ TRÊS ESTADOS, e este é o terceiro: a resposta não veio. É diferente de "esta empresa não tem
  // perfil" — dizer a segunda coisa aqui seria afirmar algo sobre o cadastro quando o problema é a
  // chamada. Mesma disciplina de `cargaTributaria.js` no portal do cliente.
  if (painel.estado === ESTADO.NAO_RECEBIDA) {
    return (
      <Painel titulo="O que a próxima nota vai levar">
        <Aviso tom="neutro">
          Não recebemos a configuração de emissão desta empresa. Recarregue a página; se continuar
          assim, a tabela de perfis pode ainda não existir neste ambiente.
        </Aviso>
      </Painel>
    );
  }

  const perfis = Array.isArray(dados?.perfis) ? dados.perfis : [];
  const cravados = painel.linhas.filter((l) => l.cravadoHoje).length;

  return (
    <Painel titulo="O que a próxima nota vai levar">
      <p className="text-muted" style={{ marginTop: 0 }}>
        Cada campo abaixo entra no XML da NFS-e desta empresa. A coluna da direita diz{" "}
        <strong>de onde o valor sai</strong>.
      </p>

      {/* ⚠ O aviso que justifica o painel: dois valores não vêm de cadastro nenhum. */}
      {cravados > 0 ? (
        <Aviso tom="atencao">
          {cravados === 1 ? "Um campo é fixo" : `${cravados} campos são fixos`} no sistema hoje —
          eles não vêm do cadastro desta empresa, e por isso não adianta procurá-los lá. Um perfil
          de emissão é o que permite decidi-los por empresa.
        </Aviso>
      ) : null}

      {painel.avisos.map((a) => (
        <Aviso key={a} tom="atencao">{a}</Aviso>
      ))}

      <table className="tabela tabela--densa">
        <thead>
          <tr>
            <th>Campo</th>
            <th style={{ textAlign: "left" }}>Valor</th>
            {/* ⚠⚠ O TEMPO VERBAL DO CABEÇALHO É PARTE DO COMPORTAMENTO. Com a integração desligada
                o perfil ainda NÃO manda no XML — escrever "de onde vem" numa linha que diz "do
                perfil de emissão" afirmaria que a próxima nota já sai assim, e não sai. É a mesma
                disciplina de `fraseDoEfeito`, aqui na coluna. */}
            <th>{painel.integracaoLigada ? "De onde vem" : "De onde viria"}</th>
          </tr>
        </thead>
        <tbody>
          {painel.linhas.map((l) => <LinhaDoCampo key={l.id} linha={l} />)}
        </tbody>
      </table>

      <p style={{ fontSize: 12, color: "var(--text-muted)" }} data-efeito>
        {fraseDoEfeito({ integracaoLigada: painel.integracaoLigada, mudariam: painel.mudariam })}
      </p>

      {/* ── os perfis ──────────────────────────────────────────────────────────────────────── */}
      <h3 style={{ fontSize: 13, marginBottom: 4 }}>Perfis de emissão</h3>
      {perfis.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 0 }}>
          Esta empresa ainda não tem perfil. Sem perfil, a emissão sai do cadastro — que é o
          comportamento de hoje.
        </p>
      ) : (
        <table className="tabela tabela--densa">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Código de serviço</th>
              <th>ISSQN</th>
              <th>Origem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {perfis.map((p) => (
              <tr key={p.id} data-perfil={p.id}>
                <td>
                  {p.nome}
                  {p.padrao ? <strong style={{ color: "var(--state-ok)" }}> · padrão</strong> : null}
                  {!p.ativo ? <span className="text-muted"> · inativo</span> : null}
                </td>
                <td>{p.codigoServicoNacional || "—"}</td>
                <td>{p.tribISSQN || "—"}</td>
                <td style={{ fontSize: 11, color: "var(--text-faint)" }}>
                  {/* ⚠ A procedência do PERFIL, não do campo: distingue "o sistema montou a partir
                      do que já existia" de "alguém afirmou isto". */}
                  {p.origem === "MANUAL" ? "configurado" : "derivado do cadastro"}
                </td>
                <td>
                  {podeEditar && !p.padrao && p.ativo ? (
                    <button
                      type="button"
                      className="btn-link"
                      disabled={salvando}
                      onClick={() => onMarcarPadrao?.(p.id)}
                    >
                      tornar padrão
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {podeEditar ? (
        criando ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={nome}
              maxLength={60}
              placeholder="Nome do perfil (ex.: Consultoria RJ)"
              onChange={(e) => setNome(e.target.value)}
              aria-label="Nome do perfil"
            />
            <Button
              type="button"
              variant="primary"
              disabled={salvando || !nome.trim()}
              onClick={async () => {
                await onCriarDoCadastro?.(nome.trim());
                setNome("");
                setCriando(false);
              }}
            >
              {salvando ? "Criando…" : "Criar a partir do cadastro"}
            </Button>
            <button type="button" className="btn-link" onClick={() => { setCriando(false); setNome(""); }}>
              Cancelar
            </button>
            {/* ⚠ A tela diz o que o botão faz: ele COPIA o que já está configurado, não inventa. */}
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              O perfil nasce com os valores que esta empresa já usa hoje. Nada muda no XML por criá-lo.
            </span>
          </div>
        ) : (
          <Button type="button" onClick={() => setCriando(true)}>Criar perfil de emissão</Button>
        )
      ) : (
        <p className="text-muted">Apenas admin ou contador pode configurar perfis de emissão.</p>
      )}
    </Painel>
  );
}

export { CAMPOS_PERFIL_EMISSAO };
