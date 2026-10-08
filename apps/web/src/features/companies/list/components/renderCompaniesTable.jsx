import { fluxoDaEmpresa, ETAPAS_CARTEIRA } from "@contabilidade/shared/fluxo-carteira";
import { temPendenciaParcelamento } from "../lib/pendenciaParcelamento";
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
import { BotaoCopiar } from "../../../../components/ui/BotaoCopiar";
import { getComplianceTags } from "./renderCompanyCard";
import { GuiaChip } from "./renderGuiaChip";
import { empresaSemObrigacoes } from "../lib/estadoDominante";
import { situacaoFiscalDaLinha } from "../lib/situacaoFiscal";
import { corRegime, descricaoDoRegime } from "../lib/abaRegime";
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

const CELULA = { padding: "8px 10px", borderTop: "1px solid var(--border)", verticalAlign: "middle" };
const CABECALHO = {
  textAlign: "left", position: "sticky", top: 0, zIndex: 2, whiteSpace: "nowrap",
};


// ⚠ `BotaoCopiar` MUDOU DE ENDEREÇO (18/08/2026) — hoje é `components/ui/BotaoCopiar.jsx`.
// Ele nasceu aqui, para o CNPJ, e subiu quando a linha digitável da guia passou a precisar do mesmo
// gesto: duas cópias do bloco seriam duas implementações da promessa "não mente", e a que ninguém
// testasse acabaria mentindo. O comportamento é o mesmo, e o teste desta tabela continua sendo o que
// o prende.
//
// ⚠ O CNPJ CONTINUA SENDO COPIADO SEM MÁSCARA, e é esse o ponto: o e-CAC e os portais da Receita
// recusam (ou silenciosamente truncam) `00.000.000/0001-00`. A tela mostra com máscara porque é
// assim que se confere com o olho; a área de transferência recebe os 14 dígitos porque é assim que
// se cola. As duas leituras vêm do MESMO par de funções (`formatarCnpj` / `soDigitosCnpj`), então
// não têm como divergir.

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

function Linha({ company, trava, competencia, onOpenCompany, acoesGuia, busca, selecionada, onAlternarSelecao, onFluxo }) {
  const [config, setConfig] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const fluxo = fluxoDaEmpresa(company);
  const apuracao = fluxo.apuracao;
  const fechada = fluxo.status.chave === "concluido";
  const tags = getComplianceTags(company.guideCompliance);
  const fiscal = situacaoFiscalDaLinha(company);
  const cert = estadoCertificado(company);
  const regime = company?.legacyCompany?.regimeTributario || null;

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
      style={{ opacity: fechada && !temPendenciaParcelamento(company) ? 0.55 : 1, outlineOffset: -2 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {/* ⚠ A CAIXA DE SELEÇÃO NÃO NAVEGA E NÃO ABRE POPOVER. Ela vive numa célula própria, à
          esquerda do nome, porque marcar linha é o gesto que se repete — e porque o `aria-label`
          precisa carregar o nome da empresa: trinta caixas com o rótulo "Selecionar" não
          distinguem nada para quem usa leitor de tela.
          `data-coluna-acao` some no papel, junto do botão Acessar: seleção é gesto de tela. */}
      {onAlternarSelecao && (
        <td className="company-row__selection" data-coluna-acao style={{ ...CELULA, width: 34, textAlign: "center" }}>
          <input
            type="checkbox"
            checked={Boolean(selecionada)}
            onChange={() => onAlternarSelecao(company.companyId)}
            aria-label={`Selecionar ${nome}`}
            style={{ cursor: "pointer", width: 15, height: 15 }}
          />
        </td>
      )}
      <td className="company-row__name" style={{ ...CELULA, position: "relative" }}>
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
          {/* ⚠ O REGIME SEMPRE APARECE — inclusive quando NÃO HÁ. Enquanto a ausência era um vazio,
              a empresa sem regime cadastrado era indistinguível de qualquer outra nesta linha; com
              as abas de regime ela cai em "Outros", e uma aba chamada "Outros" sem a linha dizer
              por quê é a ausência de novo, um nível acima. A leitura é a mesma de `abaRegime.js`,
              que é quem decide a aba. */}
          <span style={{ color: corRegime(regime) }}>{descricaoDoRegime(company)}</span>
          {company.empresaZerada && <small title="Sem movimento confirmado na competência">Zerada</small>}
          <span aria-hidden="true">·</span>
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
      <td data-label="Status" style={CELULA}>
        <button type="button" onClick={() => onFluxo?.(company)} className="carteira-etapa" aria-label={`Ver tarefas de ${nome}: ${fluxo.status.rotulo}`}>{fluxo.status.rotulo}</button>
      </td>
      <td data-label="Apuração" style={CELULA}>
        <span className={`carteira-apuracao-tag carteira-apuracao-tag--${apuracao.chave}`}><span aria-hidden="true" className="carteira-apuracao-tag__dot"/>{apuracao.rotulo}</span>
      </td>
      <td data-label="Guias" style={CELULA}>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tags.map(tag => <GuiaChip key={tag.key || tag.label} tag={tag} empresa={company} competencia={competencia} acoes={acoesGuia || {}} />)}
          {!tags.length && <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{company.guideCompliance ? 'Sem guias previstas' : 'Não disponível'}</span>}
        </span>
      </td>
      <td data-label="Contabilização" style={CELULA}>
        <span style={{ fontSize: '0.76rem', color: fluxo.contabilizacao.chave === 'importado' ? 'var(--state-ok)' : 'var(--text)' }}>{fluxo.contabilizacao.rotulo}</span>
        {fluxo.contabilizacao.importados > 0 && fluxo.contabilizacao.chave !== 'importado' && <small style={{display:'block'}}>ERP: {fluxo.contabilizacao.importados}/{fluxo.contabilizacao.total}</small>}
      </td>
      <td data-label="Situação fiscal" style={CELULA}>
        {fiscal.precisaConsultar ? (
          <button
            type="button"
            onClick={consultarFiscal}
            aria-label={`Consultar situação fiscal de ${nome}: ${fiscal.rotulo}`}
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
        {fiscal.parcelamento && <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: 3 }}>{fiscal.parcelamento}</small>}
      </td>

      <td className="company-row__action" data-coluna-acao style={{ ...CELULA, textAlign: "right", whiteSpace: "nowrap" }}>
        {/* ⚠ Trinta linhas com trinta botões "Acessar" produzem trinta rótulos idênticos na lista
            de links/botões de um leitor de tela. O nome da empresa é o que distingue um do outro. */}
        <Button
          type="button"
          onClick={() => onOpenCompany?.(company.companyId)}
          aria-label={`Acessar ${nome}`}
          variant="secondary"
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
  urgencia: "etapa do fluxo — apuração primeiro",
  status: "etapa do fluxo",
  contabilizacao: "contabilização",
  empresa: "nome da empresa",
  apuracao: "apuração",
  fiscal: "situação fiscal",
  guias: "guias",
};

export function CompaniesTable({
  companies, travas, competencia, onOpenCompany, acoesGuia, busca, imprimindo,
  // ⚠ Os quatro abaixo existem para a tabela parar de responder "não há" quando a resposta certa é
  // "não carregou" ou "os filtros escondem". Ver `lib/falhaDeCarga.js`: são três coisas diferentes
  // e viravam uma só.
  carregando = false,
  /**
   * ⚠ `totalSemFiltro` é o universo DESTA lista sem os filtros — e com as abas de regime esse
   * universo passou a ser o da ABA, não a carteira inteira. Fosse a carteira, o rodapé diria
   * "Exibindo 5 de 6" com um botão "Limpar filtros" que não traria a sexta (ela está na outra aba,
   * e limpar filtro nenhum a traz). O que explica a diferença entre 5 e 6 é a barra de abas logo
   * acima, que mostra as duas contagens.
   */
  totalSemFiltro = null,
  /**
   * O nome do recorte a que esta lista pertence ("Simples Nacional"), quando há um.
   * ⚠ Ele existe por causa do VAZIO: sem ele, uma aba de regime sem nenhuma empresa cairia na frase
   * "Nenhuma empresa nesta carteira ainda", que é falsa — a carteira tem empresas, esta aba é que
   * não tem. Ausência dizendo a coisa errada é pior que ausência calada.
   */
  rotuloDoRecorte = null,
  /** Quantas empresas a carteira tem ao todo — é o que separa "aba vazia" de "carteira vazia". */
  totalDaCarteira = null,
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
  onFluxo = null,
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
    const ordenar = (lista) => {
      const copia = [...lista];
      const dir = ordem.asc ? 1 : -1;
      copia.sort((a, b) => {
        if (ordem.campo === "empresa") return dir * String(a.razao || "").localeCompare(String(b.razao || ""));
        // Cada coluna de indicador ordena pela SUA severidade — e o segundo clique inverte, que é
        // como se pede a pergunta oposta: "quais guias faltam?" no primeiro, "quais já estão
        // completas?" no segundo. Desempate alfabético em todas, senão empresas de mesmo estado
        // trocam de lugar a cada recarga.
        if (ordem.campo === "apuracao") {
          const p = ["a_apurar","apurado","transmitido"].indexOf(fluxoDaEmpresa(a).apuracao.chave) - ["a_apurar","apurado","transmitido"].indexOf(fluxoDaEmpresa(b).apuracao.chave);
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
        const p = ordem.campo === "contabilizacao" ? ["aberto","fechado","importado"].indexOf(fluxoDaEmpresa(a).contabilizacao.chave) - ["aberto","fechado","importado"].indexOf(fluxoDaEmpresa(b).contabilizacao.chave) : ETAPAS_CARTEIRA.indexOf(fluxoDaEmpresa(a).status.chave) - ETAPAS_CARTEIRA.indexOf(fluxoDaEmpresa(b).status.chave);
        return p !== 0 ? dir * p : String(a.razao || "").localeCompare(String(b.razao || ""));
      });
      return copia;
    };
    const ehFechada = (c) => fluxoDaEmpresa(c).status.chave === "concluido" && situacaoFiscalDaLinha(c).estado.severidade !== 0 && !temPendenciaParcelamento(c);
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
   * `aria-sort` comunica a ordem aos leitores de tela. As setas decorativas indicam
   * as colunas ordenáveis e destacam a direção ativa sem alterar o nome do botão.
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
            className="companies-table__sort"
          >
            <span className="companies-table__heading">{children}</span>
            <svg className="companies-table__sort-icon" aria-hidden="true" width="14" height="16" viewBox="0 0 14 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 6 3-3 3 3" className={ativo && ordem.asc ? 'is-active' : ''}/>
              <path d="m4 10 3 3 3-3" className={ativo && !ordem.asc ? 'is-active' : ''}/>
            </svg>
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
    + (!fechadasVisiveis && fechadas.length ? ` (${fechadas.length} no grupo Concluídas, recolhido)` : "");

  const colunas = selecaoAtiva ? 8 : 7;
  const visiveis = abertas.length + fechadas.length;
  const total = Number.isFinite(totalSemFiltro) ? totalSemFiltro : visiveis;
  const escondidasPorFiltro = Math.max(0, total - visiveis);
  const falha = lerFalhaDeCarga(erroDeCarga, { assunto: "a carteira de empresas" });

  return (
    <>
      <div data-print-tabela className="companies-table-scroll">
      {/* ⚠ `minWidth` — em tela estreita a coluna Guias era ESMAGADA: os chips (que já embrulham em
          várias linhas) viravam uma pilha vertical de uma letra por linha, e a linha da empresa
          crescia até três vezes a altura. Com um mínimo, o contêiner rola na horizontal — que é
          desconforto — em vez de destruir a leitura, que é perda de informação. A tabela continua
          sendo o padrão só a partir de 1024px; abaixo disso o dashboard já abre em Cards. */}
      <table className="companies-table" role="table" aria-busy={carregando || undefined} style={{ width: "100%", minWidth: 880, borderCollapse: "collapse", fontSize: "0.85rem" }} onKeyDown={aoTeclar}>
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
            <Cabecalho campo="empresa" largura="27%">Empresa <span className="companies-table__count">({carregando ? "…" : escondidasPorFiltro > 0 ? `${visiveis}/${total}` : visiveis})</span></Cabecalho>
            <Cabecalho campo="status">Status</Cabecalho>
            <Cabecalho campo="apuracao">Apuração</Cabecalho>
            <Cabecalho campo="guias" largura="24%">Guias</Cabecalho>
            <Cabecalho campo="contabilizacao">Contabilização</Cabecalho>
            <Cabecalho campo="fiscal">Situação fiscal</Cabecalho>
            <th scope="col" data-coluna-acao style={CABECALHO}>Ações</th>
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
              {(selecaoAtiva ? [3, 24, 12, 10, 20, 12, 12, 7] : [24, 12, 10, 20, 12, 12, 7]).map((largura, col) => (
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
              selecionada={marcadas.has(c.companyId)} onAlternarSelecao={onAlternarSelecao} onFluxo={onFluxo}
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
                  {fechadasVisiveis ? "▾" : "▸"} Concluídas ({fechadas.length})
                </button>
              </td>
            </tr>
          )}
          {fechadasVisiveis && fechadas.map((c) => (
            <Linha
              key={c.companyId} company={c} trava={travas?.get?.(c.companyId)}
              competencia={competencia} onOpenCompany={onOpenCompany} acoesGuia={acoesGuia} busca={busca}
              selecionada={marcadas.has(c.companyId)} onAlternarSelecao={onAlternarSelecao} onFluxo={onFluxo}
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
                      Nenhuma das <strong>{total}</strong> empresas
                      {rotuloDoRecorte ? <> de <strong>{rotuloDoRecorte}</strong></> : " da carteira"} bate
                      com os filtros atuais.
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
                ) : rotuloDoRecorte && Number(totalDaCarteira) > 0 ? (
                  /* ⚠ ABA VAZIA ≠ CARTEIRA VAZIA. Mandar cadastrar a primeira empresa a quem tem 33
                     na carteira, só porque a aba do Lucro Real está vazia, é a ausência respondendo
                     a pergunta errada. */
                  <div style={{ color: "var(--text-muted)" }}>
                    {rotuloDoRecorte === "Desativadas" ? "Nenhuma empresa desativada nesta carteira." : <>Nenhuma empresa de <strong>{rotuloDoRecorte}</strong> nesta carteira.</>}
                  </div>
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
