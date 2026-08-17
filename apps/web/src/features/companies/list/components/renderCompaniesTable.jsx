// A carteira em TABELA — a visão padrão no desktop.
//
// POR QUE ELA EXISTE
// O trabalho do contador aqui é varredura e comparação ("quais faltam? quais têm pendência?"), mas
// o card fragmenta a informação e mostra 8 empresas por tela. Em tabela cabem 15+ em 1080p, e as
// colunas alinhadas deixam comparar de relance — que é o gesto real.
//
// Padrão herdado do `renderAnnualGrid` (mesma feature): tabela HTML pura, primeira coluna STICKY
// (o nome da empresa não pode sumir no scroll horizontal) e razão + CNPJ empilhados.
//
// Os cards continuam existindo e são o padrão no celular — a grade de 6 colunas não sobrevive a
// 375px de largura.

import { useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { getComplianceTags } from "./renderCompanyCard";
import { GuiaChip, Popover, todasConcluidas, todasPorGerar, ehParcela } from "./renderGuiaChip";
import { empresaSemObrigacoes, TITULO_ZERADA } from "../lib/estadoDominante";
import { estadoApuracao, detalheApuracao } from "../lib/estadoApuracao";
import { situacaoFiscalDaLinha } from "../lib/situacaoFiscal";
import { rotuloRegime } from "../../../../lib/vocabulario";
import { estadoCertificado } from "../lib/certificado";
import { lerFalhaDeCarga } from "../../../../lib/falhaDeCarga";
// ⚠ REUSO, NÃO CÓPIA. Já existiam DOIS formatadores de CNPJ no projeto
// (`detail/components/DeleteCompanyModal.jsx` e este) — escrever o terceiro era o defeito clássico
// daqui. Este é o único que vem com teste (`onboarding/lib/__tests__/brasilApi.test.js`) e com o
// par `soDigitosCnpj`, que é exatamente o "copiar sem máscara" que o e-CAC exige.
// ⚠ O acoplamento a `features/onboarding` é reconhecido e está no relatório: o lugar natural das
// duas funções é `src/lib/`, mas MOVER arquivo que outra sessão está editando é colisão garantida.
import { formatarCnpj, soDigitosCnpj } from "../../../onboarding/lib/brasilApi";

// TRÊS PERGUNTAS, TRÊS COLUNAS — e a leitura esquerda→direita é o próprio fluxo de trabalho:
//   Apuração ......... como está o mês?          (trabalho nosso)
//   Situação fiscal .. como está com o fisco?    (dívida do cliente)
//   Guias ............ o que falta entregar?     (o que sai para o cliente)
//
// ⚠ Cada célula tem NO MÁXIMO UM CHIP. A versão anterior empilhava duas linhas de status na mesma
// célula e produzia combinações que não queriam dizer nada — "Falta apurar" com "Sem pendência" em
// verde logo abaixo, misturando andamento do mês com relação com a Receita.

/**
 * O quanto as GUIAS de uma empresa pedem atenção. Mesma escala das outras colunas.
 *
 * 0 = falta gerar (ou conflito) · 1 = gerada, falta enviar · 2 = tudo terminal · 3 = nada a entregar.
 *
 * ⚠ Empresa zerada não tem guia a entregar — as tags "faltando" dela são artefato, não trabalho.
 * Sem esta guarda ela subia ao topo como se tivesse guia atrasada.
 */
function severidadeGuias(company) {
  if (empresaSemObrigacoes(company)) return 3;
  const tags = getComplianceTags(company.guideCompliance);
  if (!tags.length) return 3;
  // ⚠ `falhou` entra no degrau 0, junto de `missing`. Ele não é "gerada, falta enviar" (degrau 1,
  // trabalho de rotina do fim do mês): é uma tentativa JÁ FEITA que não deu certo e que ninguém vai
  // repetir sozinha. Deixá-lo no 1 afundaria a empresa afetada no meio da carteira, que é
  // exatamente o efeito que a ordenação existe para evitar.
  if (tags.some((t) => t.state === "missing" || t.state === "conflito" || t.state === "falhou")) return 0;
  if (tags.some((t) => t.state === "gerada")) return 1;
  return 2;
}

/**
 * A severidade da LINHA = a pior das três colunas. É ela que ordena por padrão.
 * 0 = danger · 1 = warning · 2 = neutro · 3 = fechada (sempre por último, fora do fluxo).
 */
function severidadeDaLinha(company, trava) {
  const ap = estadoApuracao(company, trava);
  if (ap.chave === "fechada") return 3;
  return Math.min(ap.severidade, situacaoFiscalDaLinha(company).estado.severidade, severidadeGuias(company));
}

const CELULA = { padding: "8px 10px", borderTop: "1px solid var(--border)", verticalAlign: "middle" };
const CABECALHO = {
  padding: "8px 10px", textAlign: "left", fontSize: "0.68rem", fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)",
  background: "var(--bg-subtle)", position: "sticky", top: 0, zIndex: 2, whiteSpace: "nowrap",
};

const fmtMoeda = (v) => `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function corRegime(regime) {
  if (regime === "SIMPLES") return "var(--accent-cyan)";
  if (regime === "LUCRO_PRESUMIDO") return "var(--accent-orange)";
  if (regime === "LUCRO_REAL") return "var(--accent-purple)";
  return "var(--text-faint)";
}

/**
 * COPIAR — o gesto que o contador repete o dia inteiro.
 *
 * ⚠ O CNPJ é COPIADO SEM MÁSCARA, e é esse o ponto: o e-CAC e os portais da Receita recusam (ou
 * silenciosamente truncam) `00.000.000/0001-00`. A tela mostra com máscara porque é assim que se
 * confere com o olho; a área de transferência recebe os 14 dígitos porque é assim que se cola.
 * As duas leituras vêm do MESMO par de funções (`formatarCnpj` / `soDigitosCnpj`), então não têm
 * como divergir.
 *
 * ⚠ O RETORNO NÃO MENTE. `navigator.clipboard` não existe em contexto inseguro (http://ip:porta,
 * que é como o portal roda em rede local) e a chamada pode ser recusada. Nesses casos o botão diz
 * "não deu" em vez de piscar "copiado" — um sucesso falso aqui manda o contador colar o conteúdo
 * ANTERIOR da área de transferência num campo de CNPJ.
 */
function BotaoCopiar({ valor, rotulo, titulo }) {
  const [estado, setEstado] = useState("parado"); // parado | copiado | falhou

  async function copiar(e) {
    e.stopPropagation();
    const texto = String(valor || "");
    if (!texto) return;
    try {
      if (!navigator?.clipboard?.writeText) throw new Error("sem clipboard");
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      setEstado("falhou");
    }
    window.setTimeout(() => setEstado("parado"), 1600);
  }

  const cor = estado === "copiado" ? "var(--state-ok)" : estado === "falhou" ? "var(--state-danger)" : "var(--text-muted)";
  return (
    <button
      type="button"
      onClick={copiar}
      title={estado === "falhou" ? "Não foi possível copiar neste navegador — selecione e copie à mão" : titulo}
      aria-label={rotulo}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 18, padding: 0, flex: "0 0 auto",
        background: "transparent", border: "none", borderRadius: 4,
        color: cor, cursor: "pointer", font: "inherit", fontSize: "0.7rem", lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{estado === "copiado" ? "✓" : estado === "falhou" ? "✖" : "⧉"}</span>
    </button>
  );
}

/** Configuração da empresa (A1, SERPRO, parc, folha) — sai da linha para não competir com estado. */
function PopoverConfig({ company, onFechar }) {
  const ref = useRef(null);
  const cert = estadoCertificado(company);
  const linhas = [
    ["Certificado A1", cert.chave === "ausente"
      ? "não cadastrado"
      : cert.chave === "vencido"
        ? `vencido em ${cert.expiraEm.toLocaleDateString("pt-BR")}`
        : cert.expiraEm ? `ativo até ${cert.expiraEm.toLocaleDateString("pt-BR")}` : "ativo"],
    ["SERPRO", company?.serproStatus?.eligible ? "apta" : "não apta — confira procuração e certificado"],
    ["Folha", company?.temFolha ? "tem empregado registrado" : "sem folha"],
    ["Parcelamento", (company?.temParcelamento || company?.fiscalSituacao === "EM_PARCELAMENTO") ? "ativo" : "não"],
    ["E-mail do cliente", company?.guideNotificationEmail || company?.ownerEmail || "—"],
  ];
  return (
    <div
      ref={ref}
      role="dialog"
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={onFechar}
      style={{
        position: "absolute", top: "100%", left: 0, zIndex: 300, minWidth: 280,
        background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)", padding: 10, fontSize: "0.76rem",
        fontWeight: 400, whiteSpace: "normal",
      }}
    >
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
          <span style={{ color: "var(--text-muted)", flex: "0 0 46%" }}>{rotulo}</span>
          <span style={{ color: "var(--text)" }}>{valor}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * O chip agregado das guias por gerar — clicável, com a lista de QUAIS faltam.
 *
 * ⚠ Condensar quatro chips num só resolve o muro vermelho, mas cobra um preço: o detalhe some. O
 * `title` do HTML não paga essa conta — ele não é descobrível (ninguém sabe que há algo ali), some
 * ao mover o mouse e não existe no toque. Por isso o agregado abre o MESMO popover dos outros
 * chips: a informação continua a um clique, e o gesto é o que o contador já aprendeu no chip de
 * parcelamento.
 */
function ChipGuiasFaltando({ tributos, empresa, competencia, acoes }) {
  const [aberto, setAberto] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-label={`${tributos.length} guias por gerar: ${tributos.map((t) => t.label).join(", ")}`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
          fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
          background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
          color: "var(--state-danger)", cursor: "pointer", font: "inherit", lineHeight: 1.6,
        }}
      >
        <span aria-hidden="true">⚠</span>{tributos.length} guias
      </button>

      {aberto && (
        <Popover onFechar={() => setAberto(false)}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>
            {tributos.length} guias por gerar · {competencia}
          </div>
          <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
            Todas dependem da mesma coisa: apurar o mês.
          </div>
          <ul style={{ margin: "0 0 10px", padding: 0, listStyle: "none", display: "grid", gap: 3 }}>
            {tributos.map((t) => (
              <li key={t.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span aria-hidden="true" style={{ color: "var(--state-danger)" }}>⚠</span>
                <span style={{ color: "var(--text)" }}>{t.label}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => acoes.onAbrirEmpresa?.(empresa.companyId)}
            style={{
              padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: "transparent",
              border: "1px solid var(--border)", color: "var(--text)", font: "inherit",
              fontSize: "0.76rem", fontWeight: 600,
            }}
          >
            Abrir apuração
          </button>
        </Popover>
      )}
    </span>
  );
}

function Linha({ company, trava, competencia, onOpenCompany, acoesGuia, busca, selecionada, onAlternarSelecao }) {
  const [config, setConfig] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const apuracao = estadoApuracao(company, trava);
  const fechada = apuracao.chave === "fechada";
  const tags = getComplianceTags(company.guideCompliance);
  const concluidas = todasConcluidas(tags);
  const agregarGuias = todasPorGerar(tags);
  const zerada = empresaSemObrigacoes(company);
  const fiscal = situacaoFiscalDaLinha(company);
  const cert = estadoCertificado(company);
  const regime = company?.legacyCompany?.regimeTributario || null;
  const notasTotal = Number(company?.notasEmitidas?.total || 0);

  // ⚠ A consulta SITFIS é PAGA, tem trava de 4h por empresa, e o limite do `/Apoiar` é por
  // CONTRATANTE — ou seja, por escritório inteiro. Numa lista de trinta linhas, cliques distraídos
  // viram fatura E podem travar a consulta de todas as outras. Por isso o clique confirma primeiro,
  // dizendo o custo, em vez de disparar direto.
  async function consultarFiscal() {
    if (consultando) return;
    const ok = window.confirm(
      `Consultar a situação fiscal de ${company.razao}?\n\n`
      + "É uma consulta paga ao SERPRO, limitada a 1 por empresa a cada 4 horas.",
    );
    if (!ok) return;
    setConsultando(true);
    try { await acoesGuia?.onConsultarFiscal?.(company.companyId); } finally { setConsultando(false); }
  }

  // Destaque do trecho buscado: com 30 empresas de nome parecido, achar a certa no meio da lista é
  // metade do trabalho.
  const nome = company.razao || "—";
  const alvo = String(busca || "").trim();
  let nomeRender = nome;
  if (alvo) {
    const i = nome.toLowerCase().indexOf(alvo.toLowerCase());
    if (i >= 0) {
      nomeRender = (
        <>
          {nome.slice(0, i)}
          <mark style={{ background: "var(--state-warn-surface)", color: "var(--state-warn)", padding: 0 }}>
            {nome.slice(i, i + alvo.length)}
          </mark>
          {nome.slice(i + alvo.length)}
        </>
      );
    }
  }

  return (
    /* ⚠ A LINHA NÃO NAVEGA. Clicar em qualquer ponto abria a empresa, e com chips, popovers e
       botão de enviar e-mail na mesma linha isso virava navegação por acidente. Só o botão
       "Acessar" abre — no mouse e no teclado. As setas ↑↓ continuam movendo o foco entre linhas,
       porque isso é leitura, não ação. */
    <tr
      tabIndex={0}
      data-linha-empresa={company.companyId}
      style={{ opacity: fechada ? 0.55 : 1, outlineOffset: -2 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {/* ⚠ A CAIXA DE SELEÇÃO NÃO NAVEGA E NÃO ABRE POPOVER. Ela vive numa célula própria, à
          esquerda do nome, porque marcar linha é o gesto que se repete — e porque o `aria-label`
          precisa carregar o nome da empresa: trinta caixas com o rótulo "Selecionar" não
          distinguem nada para quem usa leitor de tela.
          `data-coluna-acao` some no papel, junto do botão Acessar: seleção é gesto de tela. */}
      {onAlternarSelecao && (
        <td data-coluna-acao style={{ ...CELULA, width: 34, textAlign: "center" }}>
          <input
            type="checkbox"
            checked={Boolean(selecionada)}
            onChange={() => onAlternarSelecao(company.companyId)}
            aria-label={`Selecionar ${nome}`}
            style={{ cursor: "pointer", width: 15, height: 15 }}
          />
        </td>
      )}
      <td style={{ ...CELULA, position: "relative" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            role="button"
            tabIndex={-1}
            onClick={() => setConfig((v) => !v)}
            title="Ver certificado, SERPRO, folha e e-mail"
            style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text)", lineHeight: 1.25, cursor: "pointer" }}
          >
            {nomeRender}
          </span>
          {/* ⚠ A TAG DE CERTIFICADO FICA NA LINHA, por decisão do dono — o plano v2 mandava tudo
              que é configuração para o popover, e sem A1 não se captura NFS-e: é a única
              configuração que faz a empresa parar de receber nota sem avisar.
              Presente = silêncio: selo que aparece em toda linha não distingue ninguém.
              Cinza, não âmbar: falta certificado não trava o fechamento do mês. */}
          {!cert.ativo && (
            <span
              title={cert.titulo}
              /* ⚠ "A1" sozinho não diz nada a quem usa leitor de tela — e `title` num `<span>` não é
                 anunciado por praticamente nenhum deles. `role="img"` + `aria-label` trocam o
                 rótulo de duas letras pela frase inteira ("Empresa sem certificado A1 cadastrado —
                 não é possível capturar NFS-e"), que é a informação que o selo carrega. O texto
                 visível continua "A1": quem enxerga já aprendeu o que ele significa. */
              role="img"
              aria-label={cert.titulo}
              style={{
                fontSize: "0.64rem", fontWeight: 700, padding: "0 6px", borderRadius: 999,
                background: "var(--state-neutral-surface)", color: cert.cor, whiteSpace: "nowrap",
              }}
            >
              {cert.rotulo}
            </span>
          )}
          <BotaoCopiar
            valor={nome}
            rotulo={`Copiar a razão social de ${nome}`}
            titulo="Copiar a razão social"
          />
        </span>
        {/* ⚠ REGIME DEIXOU DE SER COLUNA. Ele é atributo de leitura ocasional ("esta é do
            Presumido?"), não indicador de trabalho — e uma coluna inteira para ele roubava largura
            das três que respondem o que fazer hoje. Aqui, junto do CNPJ, continua a um olhar.
            O selo A1 também saiu daqui: configuração vive no popover do nome, e nada mais. */}
        <span style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {regime && <span style={{ color: corRegime(regime) }}>{rotuloRegime(regime)}</span>}
          {regime && <span aria-hidden="true">·</span>}
          {/* ⚠ COM MÁSCARA NA TELA, SEM MÁSCARA NA ÁREA DE TRANSFERÊNCIA. `00.000.000/0001-00` é a
              forma que o olho confere contra o contrato social; os 14 dígitos crus são a forma que
              o e-CAC aceita. O botão ao lado existe para não obrigar ninguém a apagar pontuação à
              mão trinta vezes por dia. */}
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "nowrap" }}>
            {company.cnpj ? formatarCnpj(company.cnpj) : "—"}
          </span>
          {company.cnpj && (
            <BotaoCopiar
              valor={soDigitosCnpj(company.cnpj)}
              rotulo={`Copiar o CNPJ de ${nome} sem máscara`}
              titulo="Copiar o CNPJ só com os dígitos (é o que o e-CAC aceita)"
            />
          )}
        </span>
        {config && <PopoverConfig company={company} onFechar={() => setConfig(false)} />}
      </td>

      {/* APURAÇÃO — o pipeline do mês. Um chip, quatro estados possíveis, nada empilhado. */}
      <td style={CELULA}>
        <span
          title={detalheApuracao(apuracao, trava)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
            fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            background: apuracao.fundo, border: `1px solid ${apuracao.cor}`, color: apuracao.cor,
          }}
        >
          <span aria-hidden="true">{apuracao.icone}</span>{apuracao.rotulo}
        </span>
      </td>

      {/* SITUAÇÃO FISCAL — a relação com a Receita. Estado bom não ganha pill: não grita. */}
      <td style={CELULA}>
        {fiscal.precisaConsultar ? (
          <button
            type="button"
            onClick={consultarFiscal}
            disabled={consultando}
            title={`${fiscal.titulo} — clique para consultar no SERPRO (consulta paga)`}
            /* ⚠ ISTO É AÇÃO, NÃO ESTADO — e já era: o elemento sempre foi um `<button>`, com
               confirmação nomeada antes de disparar (a consulta é PAGA e tem trava de 4h por
               empresa). O que faltava era a APARÊNCIA dizer isso: borda tracejada + texto apagado
               liam como etiqueta, e etiqueta ninguém clica.
               ⚠ NÃO virou rótulo "não consultado": trocar o botão por um rótulo tiraria da tela a
               única forma de consultar a situação fiscal de UMA empresa sem entrar nela.
               Continua discreto de propósito — "nunca consultada" não é urgência, e o roxo cheio
               do accent aqui competiria com as colunas que dizem o que fazer hoje. */
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
              fontSize: "0.72rem", fontWeight: 600, padding: "2px 10px", borderRadius: 6,
              background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)",
              cursor: consultando ? "wait" : "pointer", font: "inherit",
            }}
          >
            {consultando ? "consultando…" : <><span aria-hidden="true">{fiscal.estado.icone}</span>{fiscal.rotulo}</>}
          </button>
        ) : (
          <span
            title={fiscal.titulo}
            style={fiscal.estado.pill
              ? {
                display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
                fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                background: fiscal.estado.fundo, border: `1px solid ${fiscal.estado.cor}`, color: fiscal.estado.cor,
              }
              : { display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", fontSize: "0.72rem", color: fiscal.estado.cor }}
          >
            <span aria-hidden="true">{fiscal.estado.icone}</span>{fiscal.rotulo}
          </span>
        )}
      </td>

      <td style={{ ...CELULA }}>
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {zerada ? (
            /* Empresa zerada não tem guia. Dizer isso é diferente de não mostrar nada — coluna
               vazia significaria "não sabemos", e aqui sabemos. Mas basta a TAG: a frase inteira
               ocupava a coluna toda e desalinhava a leitura das outras linhas. A explicação fica no
               title, que é onde ela é procurada. */
            <span
              title={TITULO_ZERADA}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
                fontSize: "0.72rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                background: "var(--state-neutral-surface)", border: "1px solid var(--state-neutral)",
                color: "var(--state-neutral)",
              }}
            >
              <span aria-hidden="true">◌</span>Zerada
            </span>
          ) : concluidas ? (
            <span
              style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--state-ok)" }}
              title={tags.map((t) => `${t.label}: ${t.state === "vazio" ? "sem movimento" : "enviada"}`).join(" · ")}
            >
              ✓ Guias concluídas
            </span>
          ) : agregarGuias ? (
            /* ⚠ UM chip no lugar de quatro vermelhos. No Lucro Presumido são IRPJ + CSLL +
               PIS/COFINS + ISS, e no começo do mês os quatro dizem a mesma coisa e pedem a mesma
               ação. Quatro repetições da mesma informação em toda linha recriavam o muro vermelho
               que este redesign existe para derrubar. Assim que os estados divergirem, os chips
               voltam sozinhos — porque aí o detalhe passa a informar. */
            <>
              <ChipGuiasFaltando
                tributos={tags.filter((t) => !ehParcela(t))}
                empresa={company}
                competencia={competencia}
                acoes={acoesGuia || {}}
              />
              {/* A parcela nunca entra no agregado: ela não vem de apurar, vem de capturar o
                  parcelamento. Somá-la ali mandaria o contador para a ação errada. */}
              {tags.filter(ehParcela).map((tag) => (
                <GuiaChip key={tag.label} tag={tag} empresa={company} competencia={competencia} acoes={acoesGuia || {}} />
              ))}
            </>
          ) : tags.length ? tags.map((tag) => (
            <GuiaChip key={tag.label} tag={tag} empresa={company} competencia={competencia} acoes={acoesGuia || {}} />
          )) : (
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>—</span>
          )}
        </span>
      </td>

      {/* ⚠ `whiteSpace: nowrap` — era aqui que "KODA BEAR" e "SINTROPIA" quebravam em duas linhas.
          Valor monetário partido no meio ("R$ 1.234." / "567,89") não é só feio: ele desalinha a
          coluna inteira, e uma coluna de números desalinhada perde a única coisa que ela faz melhor
          que o card, que é deixar comparar de relance. A largura da coluna subiu junto (ver
          `<colgroup>` lógico nos `<th>` abaixo); o `nowrap` é a garantia, a largura é o conforto. */}
      <td style={{ ...CELULA, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.78rem", color: notasTotal > 0 ? "var(--text)" : "var(--text-muted)" }}>
        {fmtMoeda(notasTotal)}
      </td>

      <td data-coluna-acao style={{ ...CELULA, textAlign: "right", whiteSpace: "nowrap" }}>
        {/* ⚠ Trinta linhas com trinta botões "Acessar" produzem trinta rótulos idênticos na lista
            de links/botões de um leitor de tela. O nome da empresa é o que distingue um do outro. */}
        <Button
          type="button"
          onClick={() => onOpenCompany?.(company.companyId)}
          aria-label={`Acessar ${nome}`}
          style={{ minHeight: 28, padding: "4px 12px", fontSize: "0.78rem" }}
        >
          Acessar
        </Button>
      </td>
    </tr>
  );
}

/**
 * ⚠ O DEFEITO QUE ESTE MAPA CONSERTA — e ele foi relatado como se fosse um filtro quebrado.
 *
 * O relato: *"o chip 'Todas · 33' está selecionado e só aparecem linhas 'Falta apurar'"*. Medido no
 * código, não era filtro nenhum: é ORDENAÇÃO. A ordem padrão (`campo: "urgencia"`) põe o pior
 * estado das três colunas de indicadores no topo, e no começo do mês isso enche a primeira tela de
 * "Falta apurar". Filtro removeria linhas; ordenação apenas as empurra para baixo.
 *
 * O que faltava era a tela DIZER isso. E faltava de um jeito específico: `"urgencia"` não é nenhuma
 * das colunas, então nenhum cabeçalho ganhava o ▲ — a lista parecia não estar ordenada por nada.
 * Daí a leitura "o filtro está errado".
 */
const ROTULO_ORDEM = {
  urgencia: "pendência — o mais urgente primeiro",
  empresa: "nome da empresa",
  apuracao: "apuração",
  fiscal: "situação fiscal",
  guias: "guias",
  notas: "notas emitidas",
};

export function CompaniesTable({
  companies, travas, competencia, onOpenCompany, acoesGuia, busca, imprimindo,
  // ⚠ Os quatro abaixo existem para a tabela parar de responder "não há" quando a resposta certa é
  // "não carregou" ou "os filtros escondem". Ver `lib/falhaDeCarga.js`: são três coisas diferentes
  // e viravam uma só.
  carregando = false,
  totalSemFiltro = null,
  erroDeCarga = null,
  onLimparFiltros = null,
  // ─── SELEÇÃO ────────────────────────────────────────────────────────────────────────────────
  // ⚠ O ESTADO DA SELEÇÃO NÃO MORA AQUI. Ele mora na página, junto do filtro que o recorta e da
  // `api` que o executa — a tabela é quem DESENHA a seleção, não quem a possui. Sem os dois
  // handlers a coluna nem renderiza, e a tabela volta a ser exatamente o que era (é o que mantém
  // as suítes que a montam sem seleção verdes, e o que deixa a impressão intacta).
  selecionados = null,
  onAlternarSelecao = null,
  onSelecionarTodos = null,
}) {
  const [ordem, setOrdem] = useState({ campo: "urgencia", asc: true });
  const [mostrarFechadas, setMostrarFechadas] = useState(false);
  const corpoRef = useRef(null);
  const selecaoAtiva = typeof onAlternarSelecao === "function";
  const marcadas = selecionados instanceof Set ? selecionados : new Set(selecionados || []);

  // ⚠ NA IMPRESSÃO AS FECHADAS SAEM SEMPRE. Elas ficam colapsadas na tela de propósito (estão fora
  // do fluxo de trabalho), mas imprimir assim entregaria uma lista INCOMPLETA sem avisar ninguém —
  // e uma folha que omite empresas em silêncio é pior que folha nenhuma.
  const fechadasVisiveis = mostrarFechadas || Boolean(imprimindo);

  const { abertas, fechadas } = useMemo(() => {
    const trava = (c) => travas?.get?.(c.companyId);
    const ordenar = (lista) => {
      const copia = [...lista];
      const dir = ordem.asc ? 1 : -1;
      copia.sort((a, b) => {
        if (ordem.campo === "empresa") return dir * String(a.razao || "").localeCompare(String(b.razao || ""));
        if (ordem.campo === "notas") return dir * (Number(a.notasEmitidas?.total || 0) - Number(b.notasEmitidas?.total || 0));
        // Cada coluna de indicador ordena pela SUA severidade — e o segundo clique inverte, que é
        // como se pede a pergunta oposta: "quais guias faltam?" no primeiro, "quais já estão
        // completas?" no segundo. Desempate alfabético em todas, senão empresas de mesmo estado
        // trocam de lugar a cada recarga.
        if (ordem.campo === "apuracao") {
          const p = estadoApuracao(a, trava(a)).severidade - estadoApuracao(b, trava(b)).severidade;
          return p !== 0 ? dir * p : String(a.razao || "").localeCompare(String(b.razao || ""));
        }
        if (ordem.campo === "fiscal") {
          const p = situacaoFiscalDaLinha(a).estado.severidade - situacaoFiscalDaLinha(b).estado.severidade;
          return p !== 0 ? dir * p : String(a.razao || "").localeCompare(String(b.razao || ""));
        }
        if (ordem.campo === "guias") {
          const p = severidadeGuias(a) - severidadeGuias(b);
          return p !== 0 ? dir * p : String(a.razao || "").localeCompare(String(b.razao || ""));
        }
        // ⚠ Padrão: o PIOR estado entre as TRÊS colunas de indicadores, não só o da apuração. Uma
        // empresa apurada e fechada no prazo, mas com pendência na Receita, precisa subir — ordenar
        // só pelo mês a esconderia no meio da lista. Desempate alfabético para a ordem não "dançar"
        // entre recargas.
        const p = severidadeDaLinha(a, trava(a)) - severidadeDaLinha(b, trava(b));
        return p !== 0 ? p : String(a.razao || "").localeCompare(String(b.razao || ""));
      });
      return copia;
    };
    const ehFechada = (c) => estadoApuracao(c, trava(c)).chave === "fechada";
    return {
      abertas: ordenar((companies || []).filter((c) => !ehFechada(c))),
      fechadas: ordenar((companies || []).filter(ehFechada)),
    };
  }, [companies, travas, ordem]);

  function alternarOrdem(campo) {
    setOrdem((o) => (o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: true }));
  }

  // Setas movem entre linhas. É o gesto natural numa lista densa — sem isso, navegar por teclado
  // exigiria Tab por todos os chips de cada linha antes de chegar na próxima.
  function aoTeclar(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const linhas = [...(corpoRef.current?.querySelectorAll("tr[data-linha-empresa]") || [])];
    const atual = linhas.indexOf(document.activeElement.closest?.("tr") || document.activeElement);
    if (atual < 0) return;
    e.preventDefault();
    const proxima = linhas[atual + (e.key === "ArrowDown" ? 1 : -1)];
    proxima?.focus();
  }

  /**
   * ⚠ O ▲▼ JÁ EXISTIA e continua sendo o mesmo. O que faltava eram duas coisas:
   *
   * 1. `aria-sort` no `<th>`. O triângulo é PIXEL — leitor de tela não lê glifo decorativo dentro
   *    de um botão como "ordenado por esta coluna". Sem o atributo, quem navega por áudio não tem
   *    como saber que a lista está ordenada, nem por quê.
   * 2. Um sinal de que a coluna É ORDENÁVEL antes do primeiro clique. As cinco colunas eram
   *    botões e nenhuma parecia botão; o ⇅ apagado diz "dá para clicar aqui" sem competir com o
   *    ▲▼ da coluna que está de fato ordenando.
   */
  const Cabecalho = ({ campo, children, alinhar, largura, pergunta }) => {
    const ativo = ordem.campo === campo;
    return (
      <th
        scope="col"
        aria-sort={campo ? (ativo ? (ordem.asc ? "ascending" : "descending") : "none") : undefined}
        style={{ ...CABECALHO, textAlign: alinhar || "left", width: largura }}
      >
        {campo ? (
          <button
            type="button"
            onClick={() => alternarOrdem(campo)}
            title={ativo ? "Inverter a ordem desta coluna" : "Ordenar por esta coluna"}
            style={{ background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: 0, textTransform: "inherit", letterSpacing: "inherit" }}
          >
            {children}
            <span aria-hidden="true" style={ativo ? undefined : { color: "var(--text-faint)", fontWeight: 400 }}>
              {ativo ? (ordem.asc ? " ▲" : " ▼") : " ⇅"}
            </span>
          </button>
        ) : children}
        {/* A pergunta que a coluna responde. Minúscula, sem caixa alta, para ficar claro que é
            legenda do cabeçalho e não um segundo cabeçalho. */}
        {pergunta && (
          <span style={{ display: "block", textTransform: "none", letterSpacing: 0, fontWeight: 400, fontSize: "0.64rem", color: "var(--text-faint)" }}>
            {pergunta}
          </span>
        )}
      </th>
    );
  };

  /**
   * ⚠ "SELECIONAR TODOS" RESPEITA O FILTRO ATIVO — é o ponto inteiro desta caixa.
   *
   * `companies` já chega FILTRADO da página. Com o recorte "falta apurar · 4" na tela, estes ids
   * são 4, não 33 — e o rótulo diz 4. Um "todos" que alcançasse a carteira inteira mandaria guia
   * para empresa que o contador não está vendo, que é exatamente o defeito que a seleção existe
   * para matar.
   *
   * ⚠ As FECHADAS entram, mesmo colapsadas: elas são linhas desta lista, e o grupo recolhido é
   * conveniência de exibição, não filtro. Como isso pode surpreender, o rótulo diz quantas estão
   * lá dentro em vez de deixar o contador descobrir depois.
   */
  const idsDaLista = useMemo(
    () => [...abertas, ...fechadas].map((c) => c.companyId),
    [abertas, fechadas],
  );
  const marcadasNaLista = idsDaLista.filter((id) => marcadas.has(id)).length;
  const todasMarcadas = idsDaLista.length > 0 && marcadasNaLista === idsDaLista.length;
  const rotuloTodos = `Selecionar as ${idsDaLista.length} empresas desta lista`
    + (!fechadasVisiveis && fechadas.length ? ` (${fechadas.length} no grupo Fechadas, recolhido)` : "");

  const colunas = selecaoAtiva ? 7 : 6;
  const visiveis = abertas.length + fechadas.length;
  const total = Number.isFinite(totalSemFiltro) ? totalSemFiltro : visiveis;
  const escondidasPorFiltro = Math.max(0, total - visiveis);
  const falha = lerFalhaDeCarga(erroDeCarga, { assunto: "a carteira de empresas" });

  return (
    <>
      {/* ⚠ "EXIBINDO X DE N" — a resposta ao relato do "chip Todas · 33 com a lista pela metade".
          O contador contava as linhas na tela, comparava com o número do chip e concluía que a
          lista estava errada. Os dois números são verdadeiros e falam de coisas diferentes: o chip
          conta a CARTEIRA, a tabela mostra o RECORTE. Enquanto ninguém escrevia os dois juntos, a
          diferença só podia ser lida como defeito.
          ⚠ E o critério de ordenação vem escrito ao lado, pelo mesmo motivo: sem ele, "as pendentes
          no topo" é indistinguível de "só as pendentes". */}
      {!carregando && (visiveis > 0 || escondidasPorFiltro > 0) && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            margin: "0 0 6px", fontSize: "0.76rem", color: "var(--text-muted)",
          }}
        >
          <span>
            {escondidasPorFiltro > 0
              ? <>Exibindo <strong style={{ color: "var(--text)" }}>{visiveis}</strong> de {total} empresas</>
              : <><strong style={{ color: "var(--text)" }}>{visiveis}</strong> empresa{visiveis === 1 ? "" : "s"}</>}
          </span>
          <span aria-hidden="true" style={{ color: "var(--text-faint)" }}>·</span>
          <span>
            ordenadas por <strong style={{ color: "var(--text)" }}>{ROTULO_ORDEM[ordem.campo] || ordem.campo}</strong>
            {ordem.campo !== "urgencia" && !ordem.asc ? " (invertida)" : ""}
          </span>
          {ordem.campo !== "urgencia" && (
            <button
              type="button"
              onClick={() => setOrdem({ campo: "urgencia", asc: true })}
              style={{
                padding: "1px 8px", borderRadius: 999, cursor: "pointer", fontSize: "0.72rem",
                background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", font: "inherit",
              }}
            >
              Voltar à ordem por pendência
            </button>
          )}
          {escondidasPorFiltro > 0 && onLimparFiltros && (
            <button
              type="button"
              onClick={onLimparFiltros}
              style={{
                padding: "1px 8px", borderRadius: 999, cursor: "pointer", fontSize: "0.72rem",
                background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", font: "inherit",
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      <div data-print-tabela style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto", maxHeight: "calc(100vh - 320px)" }}>
      {/* ⚠ `minWidth` — em tela estreita a coluna Guias era ESMAGADA: os chips (que já embrulham em
          várias linhas) viravam uma pilha vertical de uma letra por linha, e a linha da empresa
          crescia até três vezes a altura. Com um mínimo, o contêiner rola na horizontal — que é
          desconforto — em vez de destruir a leitura, que é perda de informação. A tabela continua
          sendo o padrão só a partir de 1024px; abaixo disso o dashboard já abre em Cards. */}
      <table aria-busy={carregando || undefined} style={{ width: "100%", minWidth: 880, borderCollapse: "collapse", fontSize: "0.85rem" }} onKeyDown={aoTeclar}>
        <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Empresas da carteira na competência {competencia}, com estado do fechamento e guias do mês.
          Ordenadas por {ROTULO_ORDEM[ordem.campo] || ordem.campo}.
        </caption>
        <thead>
          {/* ⚠ AS TRÊS COLUNAS DO MEIO SÃO EIXOS INDEPENDENTES, e a tela precisava dizer isso.
              Relato real: *"a PHAOS aparece com 'Falta apurar', 'Com pendência' E 'Guias
              concluídas' ao mesmo tempo"* — lido como dado contraditório. Medido: os três são
              verdadeiros e não se contradizem, porque respondem a perguntas diferentes (o mês na
              nossa mão · a dívida do cliente com a Receita · o que já saiu para o cliente). O
              subtítulo de cada cabeçalho é a pergunta que a coluna responde; sem ele, três chips
              lado a lado parecem três estados do MESMO eixo. */}
          <tr>
            {/* ─── AS LARGURAS, E POR QUE ESTES NÚMEROS ─────────────────────────────────────────
                ⚠ Antes: 26+16+18+22+10 = 92%, com a coluna Ação herdando os 8% que sobravam sem
                nunca declarar quanto. Largura que ninguém escreve é largura que o browser decide —
                e foi exatamente assim que, em outra tela deste projeto, a coluna de ação apertou
                até o botão transbordar sobre a coluna vizinha.

                Agora somam 100, e cada número foi MEDIDO no DOM da tela rodando (largura de tabela
                1201px), não estimado:

                  empresa  27% = 324px
                  apuração 11% = 132px  (conteúdo mais largo medido: 117px)
                  fiscal   14% = 168px  (conteúdo mais largo medido: 149px)
                  guias    25% = 300px  (chips embrulham; 25% põe o caso de 2 chips numa linha só)
                  notas    13% = 156px  ("R$ 1.234.567,89" mede 103px na fonte real + 20 de padding)
                  ação     10% = 120px  (o botão "Acessar" mede 95px com o padding da célula)

                ⚠ NOTAS ERA 10% (120px) — 17px a menos que o valor mais largo precisa. Era essa a
                quebra em duas linhas de KODA BEAR e SINTROPIA. O `nowrap` na célula é a garantia;
                estes 13% são o conforto, para o `nowrap` não virar rolagem horizontal.
                ⚠ Não é `table-layout: fixed`: percentual aqui é SUGESTÃO, e em tela estreita o
                browser devolve a cada coluna o seu mínimo de conteúdo — que é o comportamento
                desejado, e o motivo de o `minWidth` da tabela existir logo acima. */}
            {selecaoAtiva && (
              <th scope="col" data-coluna-acao style={{ ...CABECALHO, width: 34, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={todasMarcadas}
                  /* Estado intermediário: parte da lista marcada. Sem ele, "algumas" e "nenhuma"
                     são visualmente a mesma coisa. */
                  ref={(el) => { if (el) el.indeterminate = marcadasNaLista > 0 && !todasMarcadas; }}
                  onChange={() => onSelecionarTodos?.(idsDaLista, !todasMarcadas)}
                  aria-label={rotuloTodos}
                  title={rotuloTodos}
                  disabled={idsDaLista.length === 0}
                  style={{ cursor: "pointer", width: 15, height: 15 }}
                />
              </th>
            )}
            <Cabecalho campo="empresa" largura="27%">Empresa</Cabecalho>
            <Cabecalho campo="apuracao" largura="11%" pergunta="como está o mês?">Apuração</Cabecalho>
            <Cabecalho campo="fiscal" largura="14%" pergunta="e com a Receita?">Situação fiscal</Cabecalho>
            <Cabecalho campo="guias" largura="25%" pergunta="o que falta entregar?">Guias</Cabecalho>
            <Cabecalho campo="notas" alinhar="right" largura="13%">Notas</Cabecalho>
            <th scope="col" data-coluna-acao style={{ ...CABECALHO, textAlign: "right", width: "10%" }}>Ação</th>
          </tr>
        </thead>
        <tbody ref={corpoRef}>
          {/* ⚠ CARREGANDO NÃO É "NÃO HÁ". A tabela vazia durante a busca dizia, em corpo grande,
              "Nenhuma empresa encontrada para os filtros atuais" — uma afirmação sobre a carteira
              feita antes de o servidor responder. O contador lê isso, mexe nos filtros e piora o
              que já ia se resolver sozinho. O esqueleto ocupa o lugar da resposta sem afirmar
              nada, e o `aria-busy` diz o mesmo a quem ouve a tela. */}
          {carregando && !abertas.length && !fechadas.length && [0, 1, 2, 3, 4].map((i) => (
            <tr key={`esqueleto-${i}`} aria-hidden="true">
              {(selecaoAtiva ? [3, 27, 11, 14, 25, 13, 10] : [27, 11, 14, 25, 13, 10]).map((largura, col) => (
                <td key={col} style={{ ...CELULA }}>
                  <span style={{
                    display: "block", height: 12, borderRadius: 6,
                    width: `${Math.min(90, largura * 3)}%`,
                    background: "var(--state-neutral-surface)",
                  }}
                  />
                </td>
              ))}
            </tr>
          ))}

          {abertas.map((c) => (
            <Linha
              key={c.companyId} company={c} trava={travas?.get?.(c.companyId)}
              competencia={competencia} onOpenCompany={onOpenCompany} acoesGuia={acoesGuia} busca={busca}
              selecionada={marcadas.has(c.companyId)} onAlternarSelecao={onAlternarSelecao}
            />
          ))}

          {/* Fechadas ficam no fim, COLAPSADAS: estão fora do fluxo de trabalho, e no meio da lista
              só empurram para baixo o que ainda precisa de atenção. */}
          {fechadas.length > 0 && (
            <tr>
              <td colSpan={colunas} style={{ ...CELULA, padding: 0 }}>
                <button
                  type="button"
                  onClick={() => setMostrarFechadas((v) => !v)}
                  aria-expanded={fechadasVisiveis}
                  style={{
                    width: "100%", textAlign: "left", padding: "8px 10px", background: "var(--bg-subtle)",
                    border: "none", color: "var(--state-closed)", font: "inherit", fontSize: "0.76rem",
                    fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {fechadasVisiveis ? "▾" : "▸"} Fechadas ({fechadas.length})
                </button>
              </td>
            </tr>
          )}
          {fechadasVisiveis && fechadas.map((c) => (
            <Linha
              key={c.companyId} company={c} trava={travas?.get?.(c.companyId)}
              competencia={competencia} onOpenCompany={onOpenCompany} acoesGuia={acoesGuia} busca={busca}
              selecionada={marcadas.has(c.companyId)} onAlternarSelecao={onAlternarSelecao}
            />
          ))}

          {/* ⚠ TRÊS VAZIOS DIFERENTES, TRÊS RESPOSTAS — a mesma doutrina de `lib/falhaDeCarga.js`,
              que existe porque cinco telas deste projeto já afirmaram "0" quando a verdade era
              "não sei". Aqui a frase única "Nenhuma empresa encontrada para os filtros atuais"
              cobria os três casos, inclusive o de servidor mudo E o de carteira vazia (onde não
              há filtro nenhum a acusar, e a frase mandava o contador caçar um filtro que não
              existe).

                não carregou   → a leitura de `lerFalhaDeCarga`, com o motivo e o código
                filtros        → quantas foram escondidas, e o botão que as traz de volta
                carteira vazia → a carteira está vazia mesmo, e o caminho é criar a primeira */}
          {!carregando && !abertas.length && !fechadas.length && (
            <tr>
              <td colSpan={colunas} style={{ ...CELULA, textAlign: "center", padding: 24 }}>
                {falha ? (
                  <>
                    <div style={{ color: "var(--state-danger)", fontWeight: 700, marginBottom: 4 }}>
                      {falha.titulo}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{falha.motivo}</div>
                  </>
                ) : escondidasPorFiltro > 0 ? (
                  <>
                    <div style={{ color: "var(--text)", marginBottom: 6 }}>
                      Nenhuma das <strong>{total}</strong> empresas da carteira bate com os filtros atuais.
                    </div>
                    {onLimparFiltros && (
                      <button
                        type="button"
                        onClick={onLimparFiltros}
                        style={{
                          padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontSize: "0.78rem",
                          background: "transparent", border: "1px solid var(--border)", color: "var(--text)", font: "inherit",
                        }}
                      >
                        Limpar filtros
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ color: "var(--text-muted)" }}>
                    Nenhuma empresa nesta carteira ainda. Use <strong>Nova empresa</strong> para cadastrar a primeira.
                  </div>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </>
  );
}
