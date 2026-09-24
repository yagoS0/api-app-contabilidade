import { CnpjDaConversa } from "./ConversaVisual";

const INTENCOES = { ABERTURA: "Abrir empresa", TRANSFERENCIA: "Trocar de contador", INATIVA: "Regularizar empresa", PLANEJAMENTO: "Planejamento tributário", GESTAO: "Resultados e gestão" };

export function ResumoPreatendimento({ atendimento, atendimentoHumano = false }) {
  const pre = atendimento?.triagem?.preatendimento;
  if (!pre || !INTENCOES[pre.intencao]) return null;
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
    {dados.length > 0 && <dl>{dados.map(([titulo, valor]) => <div key={titulo}><dt>{titulo}</dt><dd>{titulo === "CNPJ informado" ? <CnpjDaConversa cnpj={valor} empresa="empresa informada" /> : String(valor)}</dd></div>)}</dl>}
    {pre.ultimoRelato && <details><summary>Último relato recebido</summary><p>{pre.ultimoRelato}</p></details>}
    {atendimento.triagem.proximaSolicitacao && <p><strong>Outro pedido na conversa:</strong> {atendimento.triagem.proximaSolicitacao.relato || INTENCOES[atendimento.triagem.proximaSolicitacao.intencao]}</p>}
    {!atendimento.onboardingId && <p>Este pedido segue com a equipe pelo chat. Uma ficha de abertura ou transferência só é necessária se esse serviço também for solicitado.</p>}
  </section>;
}
