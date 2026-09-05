import { descricoesGravadas, fundirDescricoes } from "../../../../lib/cnae/descricoesDeAtividades";
import { estadoDoResponsavel } from "../../../../lib/portal/responsavelCompartilhado";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "../../../../components/ui/Button";
import { companyCreateFormSchema, companyUpdateFormSchema } from "../../../../lib/schemas/companySchema";
import { passwordChecklist } from "../../../../lib/schemas/passwordPolicy";
import { SeletorMunicipioIbge } from "./SeletorMunicipioIbge";
import { CamposEmissaoNfse } from "./CamposEmissaoNfse";
// ⚠ O caminho da configuração sai de UMA fonte (`lib/nfse/cadastroEmissaoNfse.js`): ele mudou de
// lugar duas vezes em dois dias, e um texto solto aqui apontaria para a tela anterior.
import { ONDE_CONFIGURA_EMISSAO } from "../../../../lib/nfse/cadastroEmissaoNfse";

// Q11.2: estilo padrão pra mensagens de erro inline (vermelho, abaixo do input)
const ERROR_TEXT_STYLE = {
  display: "block",
  marginTop: 4,
  fontSize: 12,
  color: "var(--state-danger)",
  fontWeight: 600,
};

async function fetchCnpjData(cnpj) {
  const digits = cnpj.replace(/\D/g, "");
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
  if (!res.ok) throw new Error("CNPJ não encontrado");
  return res.json();
}

// Porte da BrasilAPI ("MICRO EMPRESA", "EMPRESA DE PEQUENO PORTE"...) → como a ficha escreve.
function porteDaBrasilApi(data) {
  const raw = String(data.porte || data.descricao_porte || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw.includes("MICRO EMPRESA") || raw === "ME") return "MICROEMPRESA";
  if (raw.includes("PEQUENO PORTE") || raw === "EPP") return "EMPRESA DE PEQUENO PORTE";
  if (raw.includes("DEMAIS")) return "DEMAIS";
  return raw;
}

function applyBrasilApiData(data, onChange) {
  const telefone = [data.ddd_telefone_1, data.ddd_telefone_2].filter(Boolean).join(" / ");
  const cnae = data.cnae_fiscal ? String(data.cnae_fiscal) : "";

  onChange("razaoSocial", data.razao_social || "");
  onChange("nomeFantasia", data.nome_fantasia || "");
  onChange("telefone", telefone);
  onChange("cnaePrincipal", cnae);
  onChange("enderecoRua", [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(" "));
  onChange("enderecoNumero", data.numero || "");
  onChange("enderecoBairro", data.bairro || "");
  onChange("enderecoCidade", data.municipio || "");
  onChange("enderecoUf", (data.uf || "").toUpperCase());
  onChange("enderecoCep", data.cep || "");
  onChange("enderecoComplemento", data.complemento || "");

  // A BrasilAPI já devolvia tudo abaixo e a gente jogava fora — o contador redigitava
  // (ou simplesmente ficava sem). Agora entra direto na ficha.
  onChange("porte", porteDaBrasilApi(data));
  onChange("naturezaJuridica", String(data.codigo_natureza_juridica || data.natureza_juridica || "").trim());
  onChange("dataAbertura", data.data_inicio_atividade || "");
  if (data.capital_social !== undefined && data.capital_social !== null) {
    onChange("capitalSocial", String(data.capital_social));
  }
  // Traz TODOS os CNAEs, com descrição. O classificador consolida a sugestão de anexo sobre o
  // CONJUNTO (principal + secundários): apoio administrativo que também faz obra e engenharia é
  // outro caso. Antes só o código era guardado, e a tela virava uma fileira de números sem
  // sentido — dava pra ter o dado certo e ainda assim não saber o que ele significa.
  if (Array.isArray(data.cnaes_secundarios)) {
    const secundarios = data.cnaes_secundarios
      .map((c) => String(c?.codigo || "").replace(/\D+/g, ""))
      .filter(Boolean);
    onChange("cnaesSecundarios", secundarios.join(", "));
  }

  // ⚠⚠ A DESCRICAO PASSOU A SER GRAVADA (decisao do dono, 30/08/2026). Antes ela vivia so num
  //   `useState` e morria com a tela: a consulta trazia o texto oficial e o cadastro guardava
  //   numero nu. O formato e o que JA existe em producao — "codigo - descricao" —, na coluna
  //   `Company.atividades`, que e a UNICA fonte de texto de atividade da carteira e alimenta a
  //   descricao do servico na NFS-e (`descricaoSugerida.js`).
  // ⚠ ELA NAO DECIDE CODIGO NENHUM: `cnaePrincipal`/`cnaesSecundarios` continuam sendo a
  //   autoridade sobre QUAIS atividades a empresa tem. Esta lista so acrescenta TEXTO a codigos
  //   que ja foram escolhidos — o backend descarta o que nao casar.
  const descritas = [];
  if (cnae && data.cnae_fiscal_descricao) descritas.push(`${cnae} - ${data.cnae_fiscal_descricao}`);
  for (const c of Array.isArray(data.cnaes_secundarios) ? data.cnaes_secundarios : []) {
    const codigo = String(c?.codigo || "").replace(/\D+/g, "");
    if (codigo && c?.descricao) descritas.push(`${codigo} - ${c.descricao}`);
  }
  onChange("atividadesDescritas", descritas);
}

// Descrições dos CNAEs vindas da consulta — só para EXIBIR ao lado do código. O que é gravado
// continua sendo o código; a descrição é conveniência de leitura, não dado fiscal.
function descricoesDosCnaes(data) {
  const mapa = new Map();
  const norm = (v) => String(v || "").replace(/\D+/g, "").slice(0, 7);
  if (data?.cnae_fiscal) mapa.set(norm(data.cnae_fiscal), String(data.cnae_fiscal_descricao || ""));
  for (const c of Array.isArray(data?.cnaes_secundarios) ? data.cnaes_secundarios : []) {
    const k = norm(c?.codigo);
    if (k) mapa.set(k, String(c?.descricao || ""));
  }
  return mapa;
}

// Formata "8219999" → "8219-9/99", que é como o cartão CNPJ escreve.
function formatarCnae(valor) {
  const d = String(valor || "").replace(/\D+/g, "").slice(0, 7);
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : String(valor || "");
}

// Mostra o CNAE do jeito que o cartão CNPJ escreve (8219-9/99) + a descrição, quando conhecida.
// Sem isso o campo é só um número, e conferir contra o cartão vira trabalho manual.
function CnaeLegenda({ valor, descricoes }) {
  const digitos = String(valor || "").replace(/\D+/g, "").slice(0, 7);
  if (digitos.length !== 7) return null;
  const desc = descricoes?.get(digitos) || "";
  return (
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
      {formatarCnae(digitos)}{desc ? ` — ${desc}` : ""}
    </span>
  );
}

function ListaCnaesSecundarios({ valor, descricoes }) {
  const codigos = String(valor || "")
    .split(",")
    .map((c) => c.replace(/\D+/g, "").slice(0, 7))
    .filter((c) => c.length === 7);
  if (!codigos.length) return null;
  return (
    <div className="full" style={{ marginTop: -4 }}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.7 }}>
        {codigos.map((c) => (
          <li key={c}>
            <strong style={{ color: "var(--text)", fontWeight: 600 }}>{formatarCnae(c)}</strong>
            {descricoes?.get(c) ? ` — ${descricoes.get(c)}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MINI_INPUT = {
  background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: 5,
  color: "var(--text)", padding: "5px 7px", fontSize: "0.8rem", width: "100%",
  colorScheme: "dark",
};
const MINI_TH = { padding: "4px 6px", fontSize: "0.68rem", color: "var(--text-faint)", textTransform: "uppercase", textAlign: "left" };

// Sócios: lista editável. Sócio que saiu NÃO é removido — preenche "Saiu em" e ele fica no
// histórico (é assim que a ficha do escritório trata).
function SociosEditor({ socios, onChange }) {
  const linhas = Array.isArray(socios) ? socios : [];
  function setLinha(i, campo, valor) {
    onChange(linhas.map((s, idx) => (idx === i ? { ...s, [campo]: valor } : s)));
  }
  function add() {
    onChange([...linhas, { name: "", documento: "", participacao: "", rg: "", rgOrgaoEmissor: "", dataNascimento: "", dataSaida: "", representante: false }]);
  }
  function remove(i) {
    onChange(linhas.filter((_, idx) => idx !== i));
  }
  const totalPerc = linhas
    .filter((s) => !s.dataSaida)
    .reduce((sum, s) => sum + (Number(String(s.participacao).replace(",", ".")) || 0), 0);

  return (
    <div id="secao-socios" className="full" style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12, scrollMarginTop: ANCORA_ABAIXO_DO_CABECALHO }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontSize: "0.9rem", color: "var(--text)" }}>Sócios</strong>
        <span style={{ fontSize: 11, color: totalPerc > 100 ? "var(--state-danger)" : "var(--text-faint)" }}>
          {linhas.length > 0 && `Soma dos ativos: ${totalPerc}%`}
          {totalPerc > 100 && " — passa de 100%"}
        </span>
      </div>
      {linhas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={MINI_TH}>Nome</th>
                <th style={{ ...MINI_TH, width: 120 }}>CPF</th>
                <th style={{ ...MINI_TH, width: 60 }}>%</th>
                <th style={{ ...MINI_TH, width: 110 }}>Nascimento</th>
                <th style={{ ...MINI_TH, width: 110 }}>RG</th>
                <th style={{ ...MINI_TH, width: 80 }}>Órgão</th>
                <th style={{ ...MINI_TH, width: 110 }}>Saiu em</th>
                <th style={{ width: 26 }} />
              </tr>
            </thead>
            <tbody>
              {linhas.map((s, i) => (
                <tr key={i} style={{ opacity: s.dataSaida ? 0.6 : 1 }}>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.name} onChange={(e) => setLinha(i, "name", e.target.value)} placeholder="nome do sócio" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.documento} onChange={(e) => setLinha(i, "documento", e.target.value)} placeholder="000.000.000-00" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.participacao} onChange={(e) => setLinha(i, "participacao", e.target.value)} placeholder="100" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={s.dataNascimento} onChange={(e) => setLinha(i, "dataNascimento", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.rg} onChange={(e) => setLinha(i, "rg", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={s.rgOrgaoEmissor} onChange={(e) => setLinha(i, "rgOrgaoEmissor", e.target.value)} placeholder="DIC/RJ" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={s.dataSaida} onChange={(e) => setLinha(i, "dataSaida", e.target.value)} /></td>
                  <td style={{ padding: 3, textAlign: "center" }}>
                    <button type="button" onClick={() => remove(i)} title="Remover linha" style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer" }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={add} style={{ marginTop: 6, background: "none", border: "1px dashed #44475A", color: "var(--accent-cyan)", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: "0.8rem" }}>
        + Adicionar sócio
      </button>
    </div>
  );
}

// Histórico de regime. INFORMATIVO: a apuração continua usando o regime atual da empresa.
function RegimeHistoricoEditor({ historico, onChange }) {
  const linhas = Array.isArray(historico) ? historico : [];
  function setLinha(i, campo, valor) {
    onChange(linhas.map((r, idx) => (idx === i ? { ...r, [campo]: valor } : r)));
  }
  function add() {
    onChange([...linhas, { regime: "SIMPLES", vigenciaInicio: "", vigenciaFim: "", impostos: "", desoneracao: false }]);
  }
  function remove(i) {
    onChange(linhas.filter((_, idx) => idx !== i));
  }

  return (
    <div id="secao-historico-de-regime" className="full" style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12, scrollMarginTop: ANCORA_ABAIXO_DO_CABECALHO }}>
      <div style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: "0.9rem", color: "var(--text)" }}>Histórico de regime</strong>
        <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 8 }}>
          Registro para consulta. A apuração usa o regime atual selecionado acima.
        </span>
      </div>
      {linhas.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
            <thead>
              <tr>
                <th style={{ ...MINI_TH, width: 150 }}>Regime</th>
                <th style={{ ...MINI_TH, width: 120 }}>De</th>
                <th style={{ ...MINI_TH, width: 120 }}>Até</th>
                <th style={MINI_TH}>Impostos</th>
                <th style={{ ...MINI_TH, width: 70 }}>Desone</th>
                <th style={{ width: 26 }} />
              </tr>
            </thead>
            <tbody>
              {linhas.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 3 }}>
                    <select style={MINI_INPUT} value={r.regime} onChange={(e) => setLinha(i, "regime", e.target.value)}>
                      <option value="SIMPLES">Simples Nacional</option>
                      <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
                      <option value="LUCRO_REAL">Lucro Real</option>
                      <option value="MEI">MEI</option>
                    </select>
                  </td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={r.vigenciaInicio} onChange={(e) => setLinha(i, "vigenciaInicio", e.target.value)} /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} type="date" value={r.vigenciaFim} onChange={(e) => setLinha(i, "vigenciaFim", e.target.value)} placeholder="vigente" /></td>
                  <td style={{ padding: 3 }}><input style={MINI_INPUT} value={r.impostos} onChange={(e) => setLinha(i, "impostos", e.target.value)} placeholder="ISS/PIS/COFINS/CSLL/IRPJ" /></td>
                  <td style={{ padding: 3, textAlign: "center" }}>
                    <input type="checkbox" checked={Boolean(r.desoneracao)} onChange={(e) => setLinha(i, "desoneracao", e.target.checked)} />
                  </td>
                  <td style={{ padding: 3, textAlign: "center" }}>
                    <button type="button" onClick={() => remove(i)} title="Remover linha" style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer" }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={add} style={{ marginTop: 6, background: "none", border: "1px dashed #44475A", color: "var(--accent-cyan)", borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: "0.8rem" }}>
        + Adicionar período
      </button>
    </div>
  );
}

import {
  AvisoAcessoNovoCriado,
  AvisoVinculoCriado,
  SemResponsavel,
  AvisoEmailCompartilhado,
  ConfirmacaoAcessoProprio,
} from "./ResponsavelCompartilhado";

// ── O CABEÇALHO DE SEÇÃO, UM SÓ ──────────────────────────────────────────────────────────────
//
// ⚠ Eram OITO cópias do mesmo bloco, cada uma com os mesmos três hex escritos à mão
// (`#2b2d45` na linha, `#F8F8F2` no título, `#6b7280` na ajuda). O último é o mesmo cinza que a
// ficha usava nos rótulos e que mede **3,10:1** sobre este fundo — abaixo do mínimo 4,5:1 da
// WCAG AA. Aqui ele pintava o texto que EXPLICA o campo, que é justamente o que alguém lê quando
// não sabe o que preencher.
//
// ⚠ O `id` não é enfeite: é o destino das frases que já existem em outras telas — a ficha e o
// assistente de emissão mandam "preencha em Editar → Inscrições" e, até agora, quem lia isso
// tinha de procurar a seção rolando. Ver `ANCORAS_DO_FORMULARIO`.
export const ANCORAS_DO_FORMULARIO = [
  { id: "secao-responsavel-pelo-acesso", titulo: "Responsável" },
  { id: "secao-identificacao-da-empresa", titulo: "Identificação" },
  { id: "secao-regime-e-obrigacoes", titulo: "Regime" },
  { id: "secao-atividades-cnae", titulo: "Atividades" },
  { id: "secao-endereco", titulo: "Endereço" },
  { id: "secao-dados-da-ficha", titulo: "Ficha" },
  { id: "secao-inscricoes", titulo: "Inscrições" },
  { id: "secao-alteracoes-contratuais", titulo: "Alterações" },
  // ⚠ ESTAS DUAS FALTAVAM, e eram as que mais precisavam: são as ÚLTIMAS de ~700 linhas de campo,
  // exatamente o alvo declarado da trilha ("o que faltava era só CHEGAR"). A barra prometia o
  // conjunto (`aria-label="Seções do cadastro"`) e entregava 8 de 10.
  { id: "secao-socios", titulo: "Sócios" },
  { id: "secao-historico-de-regime", titulo: "Histórico de regime" },
];

/**
 * ⚠ O cabeçalho da empresa é `position: sticky; top: 0` (`.company-section-header`), e com as
 * sub-abas ele passa de 140px. Com `scroll-margin-top` menor que isso, clicar na trilha rola a
 * seção para DEBAixo do cabeçalho: some justamente o título que trouxe a pessoa até ali, e o
 * primeiro elemento visível é um campo sem rótulo. Era 96.
 */
const ANCORA_ABAIXO_DO_CABECALHO = 168;

function SecaoDoFormulario({ id, titulo, ajuda = null, primeira = false }) {
  return (
    <div
      id={id}
      className="full"
      style={primeira
        ? { paddingBottom: 4, scrollMarginTop: ANCORA_ABAIXO_DO_CABECALHO }
        : { borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12, scrollMarginTop: ANCORA_ABAIXO_DO_CABECALHO }}
    >
      <strong style={{ fontSize: "0.9rem", color: "var(--text)" }}>{titulo}</strong>
      {ajuda ? (
        <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 8 }}>{ajuda}</span>
      ) : null}
    </div>
  );
}

/**
 * A TRILHA DE SEÇÕES — só no modo edição.
 *
 * ⚠ O formulário NÃO foi quebrado em passos, e isto não é meio caminho para quebrá-lo: são nove
 * seções que se leem juntas (o CNPJ preenche a ficha, o regime muda o que a emissão exige), e um
 * wizard obrigaria a passar por todas para corrigir um telefone. O que faltava era só CHEGAR: são
 * ~700 linhas de campo num scroll só.
 *
 * ⚠ Não é `ui/Tabs`: aba TROCA o que a tela mostra, e aqui nada troca — tudo continua na mesma
 * página, e o alvo é uma âncora do documento. Usar a barra de abas ensinaria que clicar ali some
 * com o resto.
 *
 * ⚠ Só no cadastro de empresa que JÁ EXISTE: numa empresa nova o formulário se preenche de cima
 * para baixo (o CNPJ é o primeiro campo e alimenta o resto), e pular seção é o oposto do fluxo.
 */
function TrilhaDeSecoes() {
  return (
    <nav
      className="company-form-trilha"
      aria-label="Seções do cadastro"
    >
      {ANCORAS_DO_FORMULARIO.map((s) => (
        <a key={s.id} href={`#${s.id}`}>{s.titulo}</a>
      ))}
    </nav>
  );
}

export function CompanyForm({
  form,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  showOwnerPassword,
  cnpjReadOnly = false, // true em modo edição: CNPJ é imutável após criação (UI + API)
  // Município/UF que o cadastro (PortalClient) já tem, como TEXTO — servem para CONFERIR o
  // município emissor escolhido, nunca para escolhê-lo. Ausentes, o bloco cai no endereço do
  // próprio formulário, que é a mesma informação pela outra fonte.
  municipioCadastrado = null,
  ufCadastrado = null,
  // O PORTÃO DA EMISSÃO PELO CLIENTE — estado + ação, e NÃO campo do formulário. Ele não entra em
  // `form` porque não é salvo pelo "Salvar alterações": tem rota própria, confirmação e auditoria.
  // ⚠ `emissaoCliente = null` quer dizer "esta tela não recebeu o estado" (é o caso do cadastro de
  // empresa NOVA, onde ainda não há empresa a liberar) e o bloco simplesmente não aparece — não é
  // o mesmo que "não liberada", e desenhar as duas iguais faria o contador achar que revogaram.
  emissaoCliente = null,
  onSetEmissaoCliente = null,
  emissaoClienteSaving = false,
  // ⚠⚠ O E-MAIL DO RESPONSÁVEL QUE ATENDE VÁRIAS EMPRESAS. As duas props abaixo são as DUAS
  // horas em que a consequência precisa estar na tela — ao digitar e ao salvar. Ausentes (o caso
  // do cadastro de empresa NOVA, e de qualquer chamador antigo), nada renderiza e o formulário se
  // comporta exatamente como antes. Defeito que elas fecham: um login enxergando nove empresas
  // (produção, 19/08/2026). Ver `lib/portal/responsavelCompartilhado.js`.
  empresasDoResponsavel = null,      // { empresas, carregando } — a consulta ao digitar
  confirmacaoAcessoProprio = null,   // os detalhes que o servidor devolveu no 409
  onConfirmarAcessoProprio = null,
  onCancelarAcessoProprio = null,
  acessoProprioCriado = null,        // o aviso de "a conta nova nasce sem senha"
  vinculoCriado = null,              // o aviso de "esta empresa mudou de conta"
  empresaAtualId = null,             // para o aviso não acusar a própria empresa editada
  razaoSocialAtual = null,
  // Q11.1: zona de risco — botões só aparecem em modo edição (cnpjReadOnly=true)
  status,            // "ATIVA" | "SUSPENSA" (vem do servidor)
  onSuspend,         // (reason?) => Promise
  onResume,          // () => Promise
  onDelete,          // () => abre o modal de confirmação (parent gerencia)
  dangerSaving,      // bool — loading state pros botões da zona de risco
}) {
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cnpjError, setCnpjError] = useState(null);
  // Descrições dos CNAEs da última consulta — só para exibir; o que é gravado é o código.
  // ⚠⚠ A LEGENDA NASCE DO QUE ESTA GRAVADO, e nao vazia. Em modo EDICAO `handleCnpjBlur` nunca
  //   roda (`cnpjReadOnly`), entao o mapa ficava SEMPRE vazio e o CNAE saia como numero nu —
  //   inclusive nas 12 de 34 empresas que TEM o texto no banco (medido em producao, 30/08/2026).
  // ⚠ A consulta VENCE o gravado quando roda (`fundirDescricoes`): ela e a fonte oficial e mais
  //   nova. O gravado e o piso, nao o teto.
  const [cnaeDaConsulta, setCnaeDaConsulta] = useState(() => new Map());
  const cnaeDescricoes = fundirDescricoes(
    descricoesGravadas(form.atividadesGravadas),
    cnaeDaConsulta
  );

  // Q11.2: RHF "paralelo" — não possui o state (continua sendo `form` externo), só faz
  // validação visual em tempo real. Vantagem: zero refactor dos callers (continua chamando
  // `onChange(field, value)`). RHF é alimentado pelo `values: form` (resync automático)
  // e `trigger(field)` é chamado a cada onChange pra atualizar `errors`.
  const isEditMode = cnpjReadOnly; // edição usa schema menos rigoroso (senha opcional)
  const {
    register, formState: { errors }, trigger,
  } = useForm({
    resolver: zodResolver(isEditMode ? companyUpdateFormSchema : companyCreateFormSchema),
    values: form,
    mode: "onChange",
  });

  // Helper: chama onChange externo + dispara validação no RHF
  function handleChange(field, value) {
    onChange(field, value);
    // valida o campo modificado pra atualizar errors[field]
    trigger(field).catch(() => null);
  }

  async function handleCnpjBlur() {
    const digits = form.cnpj.replace(/\D/g, "");
    if (digits.length !== 14) return;
    setCnpjLoading(true);
    setCnpjError(null);
    try {
      const data = await fetchCnpjData(digits);
      applyBrasilApiData(data, onChange);
      setCnaeDaConsulta(descricoesDosCnaes(data));
    } catch {
      setCnpjError("CNPJ não encontrado ou inválido.");
    } finally {
      setCnpjLoading(false);
    }
  }

  return (
    /* ⚠⚠ O `<form>` DEIXOU DE SER A GRADE, e isso é o que faz a barra de ação grudar.
       `position: sticky` num ITEM DE GRID tem como bloco contenedor a PRÓPRIA ÁREA da célula:
       a barra ocupava a última linha, dimensionada ao conteúdo, e o curso de deslocamento era
       zero — ela simplesmente não grudava, e a "barra fixa" era decorativa. Não era `overflow`
       de ancestral (conferido: nem `.layout`, nem `.company-form-page-shell`, nem
       `.company-form-page__panel` têm `overflow`); era o grid.
       Hoje a grade é um `<div>` interno e a barra é irmã dela, filha do `<form>` — que continua
       sendo o mesmo `<form>`, com o mesmo `onSubmit` e o mesmo `type="submit"`. */
    <form className="company-form" onSubmit={onSubmit}>
      {cnpjReadOnly ? <TrilhaDeSecoes /> : null}
      <div className="form-grid two-col">
      <SecaoDoFormulario id="secao-responsavel-pelo-acesso" titulo="Responsável pelo acesso" primeira
        ajuda={<>Quem vai entrar no portal do cliente.</>}
      />
      <label>
        Nome do responsavel
        <input value={form.ownerName} onChange={(event) => onChange("ownerName", event.target.value)} />
      </label>
      <label>
        E-mail do responsável (login do portal)
        {/* ⚠⚠ `required` SO NA CRIACAO. Na EDICAO, campo em branco significa "nao mexer" — e o
            contrato de `omitIfEmpty` (`realApi.js`), travado por `companyEmailVazio.test.js`
            ("ownerEmail vazio NAO reprova a atualizacao"). Incondicional, o HTML5 contradizia o
            backend: o navegador bloqueava o submit com um balao nativo e o botao "Salvar
            alteracoes" PARECIA nao fazer nada. */}
        <input
          // ⚠⚠ `text` + `inputMode`, NAO `type="email"`: a validacao NATIVA do navegador era a
          //   TERCEIRA regra discordante — ela recusa `joao@…` com acento, que o servidor aceita,
          //   e o unico aviso dela e um balao fora do vocabulario do app. O `inputMode` mantem o
          //   teclado de e-mail no celular sem trazer a validacao junto.
          type="text"
          inputMode="email"
          value={form.ownerEmail}
          onChange={(event) => handleChange("ownerEmail", event.target.value)}
          required={!cnpjReadOnly}
        />
        {errors.ownerEmail && (
          <span style={ERROR_TEXT_STYLE}>{errors.ownerEmail.message}</span>
        )}
        {cnpjReadOnly && (
          <span style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
            Em branco = não alterar o responsável.
          </span>
        )}
      </label>
      {/* ⚠⚠ CELULA VAZIA E PROIBIDA: sem responsavel o campo fica em branco E a tela diz por que.
          Antes, o formulario CAIA para o e-mail da EMPRESA (`company.ownerEmail || company.email`)
          — sao coisas diferentes, e o e-mail da empresa recebe guias, nao abre portal. */}
      <SemResponsavel estado={estadoDoResponsavel({
        ownerEmail: form.ownerEmail,
        emailDaEmpresa: form.email,
        edicao: cnpjReadOnly,
      })} />
      {/* ⚠ AVISA, NÃO PROÍBE — e fica COLADO no campo, não numa faixa no topo: o aviso é sobre o
          que acabou de ser digitado, e longe do campo ele vira paisagem. */}
      <div className="full">
        <AvisoEmailCompartilhado
          email={form.ownerEmail}
          empresas={empresasDoResponsavel?.empresas}
          carregando={empresasDoResponsavel?.carregando}
          empresaAtualId={empresaAtualId}
        />
        {/* A confirmação nasce aqui, e não junto do botão Salvar, porque o ato é sobre ESTE campo:
            é o e-mail acima que muda de dono, e é ele que o contador precisa reler ao confirmar. */}
        <ConfirmacaoAcessoProprio
          detalhes={confirmacaoAcessoProprio}
          razaoSocial={razaoSocialAtual}
          salvando={submitting}
          onConfirmar={onConfirmarAcessoProprio}
          onCancelar={onCancelarAcessoProprio}
        />
        <AvisoAcessoNovoCriado acessoNovo={acessoProprioCriado} />
        <AvisoVinculoCriado vinculoCriado={vinculoCriado} />
      </div>
      {showOwnerPassword ? (
        <label>
          Senha do responsavel
          <input
            type="password"
            value={form.ownerPassword}
            onChange={(event) => handleChange("ownerPassword", event.target.value)}
            required
          />
          {/* Q27.A: checklist ao vivo dos requisitos da senha forte */}
          <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", fontSize: 12 }}>
            {passwordChecklist(form.ownerPassword).map((r) => (
              <li key={r.key} style={{ color: r.ok ? "var(--state-ok)" : "var(--text-muted)" }}>
                {r.ok ? "✓" : "○"} {r.label}
              </li>
            ))}
          </ul>
          {errors.ownerPassword && (
            <span style={ERROR_TEXT_STYLE}>{errors.ownerPassword.message}</span>
          )}
        </label>
      ) : null}
      <SecaoDoFormulario id="secao-identificacao-da-empresa" titulo="Identificação da empresa"
        ajuda={<>Digite o CNPJ e saia do campo: o resto preenche sozinho.</>}
      />
      <label>
        CNPJ
        {cnpjReadOnly && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>
            (não editável — para mudar, exclua a empresa e crie outra)
          </span>
        )}
        {!cnpjReadOnly && cnpjLoading && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#888" }}>Consultando...</span>
        )}
        {!cnpjReadOnly && cnpjError && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#e55" }}>{cnpjError}</span>
        )}
        <input
          value={form.cnpj}
          onChange={(event) => {
            if (cnpjReadOnly) return;
            handleChange("cnpj", event.target.value);
            setCnpjError(null);
          }}
          onBlur={cnpjReadOnly ? undefined : handleCnpjBlur}
          placeholder="00.000.000/0000-00"
          required
          readOnly={cnpjReadOnly}
          style={cnpjReadOnly ? { background: "var(--bg-page)", color: "var(--text-muted)", cursor: "not-allowed" } : undefined}
        />
        {!cnpjReadOnly && errors.cnpj && (
          <span style={ERROR_TEXT_STYLE}>{errors.cnpj.message}</span>
        )}
      </label>
      <label>
        Razao social
        <input value={form.razaoSocial} onChange={(event) => handleChange("razaoSocial", event.target.value)} required />
        {errors.razaoSocial && (
          <span style={ERROR_TEXT_STYLE}>{errors.razaoSocial.message}</span>
        )}
      </label>
      <label>
        Nome fantasia
        <input value={form.nomeFantasia} onChange={(event) => onChange("nomeFantasia", event.target.value)} />
      </label>
      {/* ⚠⚠ ESTE CAMPO NAO EXISTIA NA TELA e MESMO ASSIM era enviado e validado
          (`useManageCompanyForm` semeia, `realApi` envia, `companySchemas` valida com
          `z.string().email()`). Valor legado que nao fosse e-mail reprovava o PATCH INTEIRO com
          `validation_failed`, e nao havia onde corrigir: a empresa nao salvava mais nada, para
          sempre. Medido hoje: so 1 empresa tem o campo, e ela passa — e prevencao. */}
      <label className="full">
        E-mail da empresa
        <input
          // ⚠⚠ `text` + `inputMode`, NAO `type="email"`: a validacao NATIVA do navegador era a
          //   TERCEIRA regra discordante — ela recusa `joao@…` com acento, que o servidor aceita,
          //   e o unico aviso dela e um balao fora do vocabulario do app. O `inputMode` mantem o
          //   teclado de e-mail no celular sem trazer a validacao junto.
          type="text"
          inputMode="email"
          value={form.email}
          onChange={(event) => handleChange("email", event.target.value)}
          placeholder="o e-mail do cadastro da empresa — NAO e o login do portal"
        />
        {errors.email && <span style={ERROR_TEXT_STYLE}>{errors.email.message}</span>}
      </label>
      {/* ⚠ Aqui o onChange e o `handleChange`, nao o cru: e ele que dispara o `trigger` do
          schema. Com o cru, o unico aviso era o balao NATIVO do navegador — fora do vocabulario
          do app e em posicao que depende da rolagem de um formulario de dez secoes. */}
      {/* ⚠⚠ O TERCEIRO E-MAIL SAIU DAQUI EM 05/09/2026 (decisão do dono: *"o cadastro padrão da
          empresa digitamos o email 3 vezes, devemos digitar apenas duas — email da empresa e email
          de acesso, e o email para envio de guias deve sair de lá"*). Quem recebe a guia passou a
          ser cadastrado na **Configuração de envio**, dentro da aba Guias, onde cabem VÁRIOS
          destinatários — e o envio vai para todos.
          ⚠ A COLUNA `guideNotificationEmail` NÃO FOI APAGADA e o valor salvo continua viajando no
          formulário: ela é a rede da cascata (`resolveCompanyNotificationEmails`) para a empresa que
          ainda não tem destinatário cadastrado. Tirar o CAMPO é decisão de tela; apagar o DADO
          deixaria essas empresas sem receber. */}
      <label>
        Telefone
        <input value={form.telefone} onChange={(event) => onChange("telefone", event.target.value)} />
      </label>
      <SecaoDoFormulario id="secao-regime-e-obrigacoes" titulo="Regime e obrigações" />
      <label>
        Regime tributario
        <select value={form.regimeTributario} onChange={(event) => onChange("regimeTributario", event.target.value)}>
          <option value="SIMPLES">SIMPLES</option>
          <option value="LUCRO_PRESUMIDO">LUCRO_PRESUMIDO</option>
          <option value="LUCRO_REAL">LUCRO_REAL</option>
        </select>
      </label>
      {/* ⚠⚠ O ANEXO SO APARECE NO SIMPLES. Em outro regime ele nao existe, e um campo vazio ali
          seria lido como "falta preencher" numa empresa que nao deve preencher nada.
          ⚠ Nada vem pre-selecionado: o anexo decide a aliquota da empresa, e escolher por ela
          seria o portal afirmando um enquadramento que ninguem conferiu. */}
      {form.regimeTributario === "SIMPLES" && (
        <>
          <label>
            Anexo do Simples
            <select
              value={form.simplesAnexo}
              onChange={(event) => onChange("simplesAnexo", event.target.value)}
            >
              <option value="">— não informado —</option>
              <option value="I">I</option>
              <option value="II">II</option>
              <option value="III">III</option>
              <option value="IV">IV</option>
              <option value="V">V</option>
            </select>
          </label>
          <label>
            Data de opção pelo Simples
            <input
              type="date"
              value={form.simplesDataOpcao}
              onChange={(event) => onChange("simplesDataOpcao", event.target.value)}
            />
          </label>
        </>
      )}
      <label>
        Pró-labore
        <select
          value={form.hasProlabore ? "sim" : "nao"}
          onChange={(event) => onChange("hasProlabore", event.target.value === "sim")}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim</option>
        </select>
      </label>
      {/* Folha ≠ pró-labore: sócio retirando pró-labore sem empregado não gera eSocial/FGTS de
          folha. São dois campos porque juntá-los criaria obrigação trabalhista em quem não tem. */}
      <label>
        Possui folha de pagamento?
        <select
          value={form.temFolha ? "sim" : "nao"}
          onChange={(event) => onChange("temFolha", event.target.value === "sim")}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim — tem empregado registrado</option>
        </select>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          Permite aplicar obrigações trabalhistas em lote pelas regras do escritório.
        </span>
      </label>
      <label>
        Empresa zerada (sem movimento)
        <select
          value={form.empresaZerada ? "sim" : "nao"}
          onChange={(event) => onChange("empresaZerada", event.target.value === "sim")}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim — só obrigações zeradas</option>
        </select>
      </label>
      <SecaoDoFormulario id="secao-atividades-cnae" titulo="Atividades (CNAE)"
        ajuda={<>Todos os CNAEs contam: a sugestão de anexo é feita sobre o conjunto, não só o principal.</>}
      />
      <label>
        CNAE principal
        <input value={form.cnaePrincipal} onChange={(event) => onChange("cnaePrincipal", event.target.value)} required />
        <CnaeLegenda valor={form.cnaePrincipal} descricoes={cnaeDescricoes} />
      </label>
      <label>
        CNAEs secundários
        <input
          value={form.cnaesSecundarios}
          onChange={(event) => onChange("cnaesSecundarios", event.target.value)}
          placeholder="4330405, 4321500"
        />
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Separados por vírgula. Preenchem sozinhos pelo CNPJ.</span>
      </label>
      {/* Lista legível: o campo de texto é uma fileira de números; aqui dá pra CONFERIR se os
          CNAEs batem com o cartão CNPJ antes de salvar. */}
      <ListaCnaesSecundarios valor={form.cnaesSecundarios} descricoes={cnaeDescricoes} />
      <SecaoDoFormulario id="secao-endereco" titulo="Endereço" />
      <label>
        Endereco - rua
        <input value={form.enderecoRua} onChange={(event) => onChange("enderecoRua", event.target.value)} required />
      </label>
      <label>
        Endereco - numero
        <input
          value={form.enderecoNumero}
          onChange={(event) => onChange("enderecoNumero", event.target.value)}
          required
        />
      </label>
      <label>
        Endereco - bairro
        <input
          value={form.enderecoBairro}
          onChange={(event) => onChange("enderecoBairro", event.target.value)}
          required
        />
      </label>
      <label>
        Endereco - cidade
        <input
          value={form.enderecoCidade}
          onChange={(event) => onChange("enderecoCidade", event.target.value)}
          required
        />
      </label>
      <label>
        Endereco - UF
        <input value={form.enderecoUf} onChange={(event) => onChange("enderecoUf", event.target.value)} required />
      </label>
      <label>
        Endereco - CEP
        <input value={form.enderecoCep} onChange={(event) => onChange("enderecoCep", event.target.value)} required />
      </label>
      <label className="full">
        Endereco - complemento
        <input
          value={form.enderecoComplemento}
          onChange={(event) => onChange("enderecoComplemento", event.target.value)}
        />
      </label>

      {/* ── Ficha de cadastro ── */}
      <SecaoDoFormulario id="secao-dados-da-ficha" titulo="Dados da ficha"
        ajuda={<>Porte, natureza jurídica, capital e abertura preenchem sozinhos pelo CNPJ.</>}
      />
      <label>
        Data de abertura
        <input type="date" value={form.dataAbertura} onChange={(event) => onChange("dataAbertura", event.target.value)} />
      </label>
      <label>
        Porte
        <input value={form.porte} onChange={(event) => onChange("porte", event.target.value)} placeholder="MICROEMPRESA" />
      </label>
      <label>
        Natureza jurídica
        <input value={form.naturezaJuridica} onChange={(event) => onChange("naturezaJuridica", event.target.value)} placeholder="230-5" />
      </label>
      <label>
        Capital social
        <input value={form.capitalSocial} onChange={(event) => onChange("capitalSocial", event.target.value)} placeholder="100.000,00" />
      </label>
      <label>
        Abriu com
        <input value={form.abriuCom} onChange={(event) => onChange("abriuCom", event.target.value)} placeholder="JEFFERSON" />
      </label>
      <label>
        Diário nº
        <input value={form.diarioNumero} onChange={(event) => onChange("diarioNumero", event.target.value)} />
      </label>
      <label>
        Nº de registro
        <input value={form.numeroRegistro} onChange={(event) => onChange("numeroRegistro", event.target.value)} placeholder="33.6.0068899-0" />
      </label>
      <label>
        Tipo de registro
        <input value={form.tipoRegistro} onChange={(event) => onChange("tipoRegistro", event.target.value)} placeholder="JUNTA COMERCIAL" />
      </label>
      <label>
        Desoneração da folha
        <select
          value={form.desoneracao ? "sim" : "nao"}
          onChange={(event) => onChange("desoneracao", event.target.value === "sim")}
        >
          <option value="nao">Não</option>
          <option value="sim">Sim — c/ desoneração</option>
        </select>
      </label>
      <SecaoDoFormulario id="secao-inscricoes" titulo="Inscrições" />
      <label>
        Inscrição municipal
        <input value={form.inscricaoMunicipal} onChange={(event) => onChange("inscricaoMunicipal", event.target.value)} />
      </label>
      <label>
        Data da IM
        <input type="date" value={form.inscricaoMunicipalData} onChange={(event) => onChange("inscricaoMunicipalData", event.target.value)} />
      </label>
      <div />
      {/* ⚠ O MUNICÍPIO EMISSOR FICA AQUI, junto da inscrição municipal, e não em tela nova: são os
          dados que o `buildMissingFields` do emissor de NFS-e exige, e o contador já vem a este
          bloco para preenchê-los. Seletor, não campo livre — ver `SeletorMunicipioIbge`. */}
      <SeletorMunicipioIbge
        valor={form.codigoMunicipioIbge}
        onChange={(codigo) => onChange("codigoMunicipioIbge", codigo)}
        municipioCadastrado={municipioCadastrado || form.enderecoCidade}
        ufCadastrado={ufCadastrado || form.enderecoUf}
      />
      <label>
        Inscrição estadual
        <input value={form.inscricaoEstadual} onChange={(event) => onChange("inscricaoEstadual", event.target.value)} />
      </label>
      <label>
        Data da IE
        <input type="date" value={form.inscricaoEstadualData} onChange={(event) => onChange("inscricaoEstadualData", event.target.value)} />
      </label>
      <div />

      {/* ── A CONFIGURAÇÃO DE EMISSÃO DE NFS-e SAIU DAQUI (dono, 19/08/2026) ────────────────────
          > *"configuração de notas na aba do contador está ficando muito grande, vamos separar ela
          > em uma aba própria."*

          ⚠ EM MODO EDIÇÃO ela virou ABA PRÓPRIA, com SALVAR PRÓPRIO
          (`detail/components/renderEmissaoNfseTab.jsx`, rota `PATCH .../emissao-nfse`, que aceita
          só os sete campos). Renderizá-la também aqui devolveria dois lugares editando os mesmos
          campos, com dois salvares diferentes — o defeito, não a solução.

          ⚠ MAS OS CAMPOS CONTINUAM NO `form` E NO PAYLOAD deste formulário, e isso NÃO é sobra:
          `buildCompanyPayload` manda a empresa inteira, e campo ausente vira `null` — tirá-los
          daqui faria o "Salvar alterações" APAGAR a configuração de emissão de quem veio só trocar
          o telefone. Ver `mapCompanyToEmissaoNfseForm`.

          No cadastro de empresa NOVA (`!cnpjReadOnly`) o bloco CONTINUA aqui: não existe aba antes
          de a empresa existir, e o portão do cliente já não aparecia nesse caso. */}
      {!cnpjReadOnly ? (
        <CamposEmissaoNfse
          codigoServicoNacional={form.codigoServicoNacional}
          codigosServicoNacional={form.codigosServicoNacional}
          codigoServicoMunicipal={form.codigoServicoMunicipal}
          rpsSerie={form.rpsSerie}
          pTotTribFed={form.pTotTribFed}
          pTotTribEst={form.pTotTribEst}
          pTotTribMun={form.pTotTribMun}
          beneficioMunicipalNumero={form.beneficioMunicipalNumero}
          beneficioMunicipalTipoReducao={form.beneficioMunicipalTipoReducao}
          beneficioMunicipalPRedBC={form.beneficioMunicipalPRedBC}
          onChange={onChange}
          emissaoCliente={emissaoCliente}
          razaoSocial={form.razaoSocial}
          onSetEmissaoCliente={onSetEmissaoCliente}
          emissaoClienteSaving={emissaoClienteSaving}
        />
      ) : (
        /* ⚠ A SAÍDA FICA DITA, não subentendida: quem procurava os códigos de serviço aqui precisa
           saber para onde eles foram. Aba sumida sem rastro é o que faz recadastrar. */
        <div className="full" style={{
          borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12,
          fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
        }}>
          <strong style={{ color: "var(--text)", fontSize: "0.9rem" }}>Emissão de NFS-e</strong>
          <div style={{ marginTop: 4 }}>
            Os códigos de serviço, a série da DPS, a carga tributária aproximada e a liberação de
            emissão para o cliente ficam em <strong>{ONDE_CONFIGURA_EMISSAO}</strong> (a engrenagem
            no topo da aba), com o salvar próprio dela.
          </div>
        </div>
      )}

      <SecaoDoFormulario id="secao-alteracoes-contratuais" titulo="Alterações contratuais" />
      <label>
        Nº da última alteração
        <input value={form.alteracaoNumero} onChange={(event) => onChange("alteracaoNumero", event.target.value)} placeholder="2" />
      </label>
      <label>
        Data da alteração
        <input type="date" value={form.alteracaoData} onChange={(event) => onChange("alteracaoData", event.target.value)} />
      </label>
      <div />

      <SociosEditor socios={form.socios} onChange={(next) => onChange("socios", next)} />
      <RegimeHistoricoEditor historico={form.regimeHistorico} onChange={(next) => onChange("regimeHistorico", next)} />
      </div>

      {/* ⚠ FIXA NO RODAPÉ (`.form-actions--fixa`, no App.css). Eram nove seções e ~700 linhas de
          campo num scroll só, com o Salvar no fim: quem corrigia a inscrição municipal (seção 7)
          rolava tudo de volta para gravar. O botão não mudou de lugar no DOM nem de comportamento
          — é o mesmo `type="submit"` do mesmo `<form>`; ele só deixou de sair da tela. */}
      <div className="form-actions form-actions--fixa">
        <Button type="submit" variant="primary" className="company-form-page__submit" disabled={submitting || cnpjLoading}>
          {submitting ? "Salvando..." : submitLabel}
        </Button>
      </div>

      {/* Q11.1: Zona de Risco — só no modo edição (cnpjReadOnly), abaixo do form */}
      {cnpjReadOnly && (onSuspend || onResume || onDelete) && (
        <div className="full" style={{
          marginTop: 32, padding: "16px 18px", borderRadius: 8,
          background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
        }}>
          <h3 style={{ margin: "0 0 4px", color: "var(--state-danger)", fontSize: "0.95rem" }}>
            ⚠ Zona de Risco
          </h3>
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Suspender desativa a captura SERPRO e bloqueia processamentos. Excluir apaga tudo.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {status === "SUSPENSA" ? (
              onResume && (
                <Button
                  type="button" variant="primary"
                  onClick={onResume}
                  disabled={dangerSaving}
                >
                  {dangerSaving ? "Reativando…" : "Reativar empresa"}
                </Button>
              )
            ) : (
              onSuspend && (
                <Button
                  type="button" variant="secondary"
                  onClick={() => {
                    // eslint-disable-next-line no-alert
                    const reason = window.prompt("Motivo da suspensão (opcional):", "");
                    if (reason === null) return; // cancelou
                    onSuspend(reason.trim() || null);
                  }}
                  disabled={dangerSaving}
                >
                  {/* ⚠ O âmbar inline foi removido: `--state-warn` é PENDÊNCIA ("falta enviar"), não
                      cor de comando — e a caixa "Zona de Risco" em volta já carrega o peso. */}
                  {dangerSaving ? "Suspendendo…" : "Suspender empresa"}
                </Button>
              )
            )}
            {onDelete && (
              <Button
                type="button"
                variant="danger"
                onClick={onDelete}
                disabled={dangerSaving}
                style={{ marginLeft: "auto" }}
              >
                Excluir empresa…
              </Button>
            )}
          </div>
          {status === "SUSPENSA" && (
            <div style={{
              marginTop: 12, padding: "8px 10px", background: "rgba(255, 179, 71, 0.10)",
              border: "1px solid var(--state-warn)", borderRadius: 6, fontSize: "0.8rem", color: "var(--state-warn)",
            }}>
              ⏸ Empresa SUSPENSA — workers SERPRO não vão capturar guias.
            </div>
          )}
        </div>
      )}
    </form>
  );
}
