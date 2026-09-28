import { CnpjDaConversa } from "./ConversaVisual";

const INTENCOES = { ABERTURA: "Abrir empresa", TRANSFERENCIA: "Trocar de contador", INATIVA: "Regularizar empresa", PLANEJAMENTO: "Planejamento tributário", GESTAO: "Resultados e gestão" };
const CAMPOS_IA = { nome: "Nome", atividade: "Atividade", cidade: "Cidade", necessidade: "O que precisa", origemDeclarada: "Origem informada", urgencia: "Urgência", preferenciaContato: "Preferência de contato" };

export function ResumoPreatendimento({ atendimento, atendimentoHumano = false }) {
  const pre = atendimento?.triagem?.preatendimento;
  if (!pre || !INTENCOES[pre.intencao]) return null;
  const evidencias = { ...pre.evidenciasIa, ...pre.evidenciasDeclaradas };
  const dados = [
    ["Nome", pre.nome], ["Atividade", pre.atividade], ["Cidade", pre.cidade],
    ["O que precisa", pre.necessidade], ["Urgência informada", pre.urgencia],
    ["Preferência de contato", pre.preferenciaContato],
    ["CNPJ informado", pre.dadosInformados?.cnpj],
    ["Origem informada", pre.origemDeclarada], ["Palavra de entrada", pre.palavraEntrada],
  ].filter(([, valor]) => valor);
  return <section className="wa-pre-summary" aria-label="Resumo do pré-atendimento">
    <header><h3>{INTENCOES[pre.intencao]}</h3><span>{atendimento.encerradoEm ? "Solicitação anterior" : atendimentoHumano || pre.estado === "ENCAMINHADO" ? "Com a equipe" : "Conversa inicial"}</span></header>
    <p>Continue a conversa a partir do que a pessoa já contou. Confira os dados antes de preparar uma proposta.</p>
    {pre.ultimaInterpretacaoIa && <p>{pre.ultimaInterpretacaoIa.estado === 'APLICADA' ? 'Última mensagem interpretada com IA. Confira as informações abaixo.' : pre.ultimaInterpretacaoIa.estado === 'FALLBACK' ? 'A IA não conseguiu interpretar a última mensagem. O atendimento foi encaminhado à equipe; confira o relato recebido.' : 'A IA não participou da última resposta. O atendimento continuou pelo fluxo padrão.'}</p>}
    {Object.keys(evidencias).length > 0 && <details><summary>Trechos que sustentam o resumo</summary><ul>{Object.entries(evidencias).filter(([campo]) => CAMPOS_IA[campo]).map(([campo, evidencia]) => <li key={campo}><strong>{CAMPOS_IA[campo]}: </strong><q>{evidencia.trecho}</q>{pre.evidenciasDeclaradas?.[campo] ? ' — relato registrado diretamente da mensagem' : ''}{evidencia.valor === null ? ' — informação removida do resumo' : ''}</li>)}</ul></details>}
    {dados.length > 0 && <dl>{dados.map(([titulo, valor]) => <div key={titulo}><dt>{titulo}</dt><dd>{titulo === "CNPJ informado" ? <CnpjDaConversa cnpj={valor} empresa="empresa informada" /> : String(valor)}</dd></div>)}</dl>}
    {pre.ultimoRelato && <details><summary>Último relato recebido</summary><p>{pre.ultimoRelato}</p></details>}
    {atendimento.triagem.proximaSolicitacao && <p><strong>Outro pedido na conversa:</strong> {atendimento.triagem.proximaSolicitacao.relato || INTENCOES[atendimento.triagem.proximaSolicitacao.intencao]}</p>}
    {!atendimento.onboardingId && <p>Este pedido segue com a equipe pelo chat. Uma ficha de abertura ou transferência só é necessária se esse serviço também for solicitado.</p>}
  </section>;
}
