// ⚠ SEM IMPORTS. Os seis que havia aqui (`Button`, `SITUACAO_FISCAL_SIMBOLO`, `corRegime`/
// `descricaoDoRegime`, `GuiaChip`/`todasConcluidas`, `estadoCertificado`, `empresaSemObrigacoes`/
// `TITULO_ZERADA`) eram TODOS do card, e saíram com ele — ver a lápide no fim do arquivo.
// ⚠ Isso desfez de passagem o risco de ciclo que `lib/abaRegime.js:34` registra: era este arquivo
// que importava `abaRegime`, enquanto `acoesDaSelecao` importa este. O comentário de lá continua
// valendo como história (foi por isso que `regimeDe` mudou de casa), mas a corrente não existe mais.

// Tributos potencialmente exibidos nas tags de compliance (a tabela e os filtros da carteira).
// A ordem aqui define a ordem visual das tags (DAS primeiro para Simples; depois Presumidos; PARC_DAS no fim).
const COMPLIANCE_CANDIDATES = [
  { key: "das",       label: "DAS" },
  { key: "irpj",      label: "IRPJ" },
  { key: "csll",      label: "CSLL" },
  { key: "pisCofins", label: "PIS/COFINS" },
  { key: "iss",       label: "ISS" },
  { key: "inss",      label: "INSS" },
  // ⚠ "Parcelamento", não "PARC DAS": desde que a guia da parcela deixou de satisfazer o nó do DAS,
  // uma parcela de INSS parcelado também cai aqui — chamá-la de DAS seria trocar um erro por outro.
  // O tipo real (PARCSN, PERT_SN…) e o número da parcela ficam no popover do chip.
  { key: "parcDas",   label: "Parcelamento" },
];

export function getComplianceTags(guideCompliance) {
  if (!guideCompliance || typeof guideCompliance !== "object") return [];

  // Novo formato: cada tributo é um nó com o CICLO DE VIDA
  // (missing → gerada → enviada, ou missing → vazio; mais `conflito`).
  // Itera todos os candidatos e inclui só os marcados como required pelo backend
  // (que decide com base no regime tributário + pró-labore).
  const tags = [];
  for (const { key, label } of COMPLIANCE_CANDIDATES) {
    const node = guideCompliance[key];
    if (node?.required) {
      // A parcela se identifica pelo número: "Parcela 3/60" diz o que precisa ser entregue ESTE
      // mês. "Parcelamento" (a existência do acordo) é assunto da coluna Situação fiscal — dizer o
      // mesmo nos dois lugares foi o que fez o parcelamento aparecer duplicado.
      const rotulo = key === "parcDas" && node.numeroParcela && node.quantidadeParcelas
        ? `Parcela ${node.numeroParcela}/${node.quantidadeParcelas}`
        : label;
      tags.push({
        key, label: rotulo, ok: Boolean(node.ok),
        // `present` é o formato antigo — sem `emailStatus` não dá para saber se foi enviada,
        // então cai em "gerada", que é o estado que ainda pede ação.
        state: node.state === "present" ? "gerada" : (node.state || (node.ok ? "gerada" : "missing")),
        // Carimbo da guia: é o que permite enviar e auditar a marcação direto do chip.
        guideId: node.guideId || null,
        emailStatus: node.emailStatus || null,
        emailSentAt: node.emailSentAt || null,
        // O MOTIVO da falha de envio (`state: "falhou"`). Sem ele o chip diria só "falhou", e o
        // contador teria que abrir a empresa para descobrir o porquê — que é o passo em que o
        // aviso se perde.
        emailLastError: node.emailLastError || null,
        emailAttempts: Number(node.emailAttempts || 0),
        // O envio agora tem CANAL. É o que permite o popover dizer "WhatsApp · 05/08 14:32 ·
        // ✓✓ lida" em vez de assumir e-mail — e é a informação que o contador usa para saber por
        // onde a guia chegou (ou não) ao cliente.
        canalEnvio: node.canalEnvio || null,
        envioStatus: node.envioStatus || null,
        envioEm: node.envioEm || null,
        envioErro: node.envioErro || null,
        envioDestino: node.envioDestino || null,
        vazioEm: node.vazioEm || null,
        vazioPor: node.vazioPor || null,
        vazioMotivo: node.vazioMotivo || null,
        faturamento: node.faturamento || 0,
        origem: node.origem || null,
        // Só o nó `parcDas` traz estes — identificam QUAL acordo e QUAL parcela no popover.
        tipoParcelamento: node.tipoParcelamento || null,
        numeroParcelamento: node.numeroParcelamento || null,
        numeroParcela: node.numeroParcela || null,
        quantidadeParcelas: node.quantidadeParcelas || null,
        atrasada: Boolean(node.atrasada),
      });
    }
  }
  if (tags.length > 0) return tags;

  // Fallback legado (formato antigo com `expected`).
  if (!guideCompliance?.expected) return [];
  return [
    {
      label: guideCompliance.expected === "SIMPLES" ? "DAS" : "INSS",
      ok: Boolean(guideCompliance.ok),
    },
  ];
}

// ─── ⚠⚠ O CARD FOI APAGADO EM 01/09/2026 ────────────────────────────────────────────────────────
//
// > Dono: *"retirar totalmente a visualização em Cards"*.
//
// Saíram daqui `CompanyCard`, `Pill` e `FISCAL_META` — as três só existiam para desenhar o card, e
// nada mais no app as importava.
//
// ⚠⚠ **E O ARQUIVO NÃO FOI APAGADO JUNTO — isso é o ponto.** `getComplianceTags` (acima) tem
// QUATRO consumidores vivos e nenhum deles é o card: `renderCompaniesTable.jsx` (duas vezes),
// `lib/acoesDaSelecao.js` (duas vezes) e DOIS filtros de `renderCompaniesHomePage.jsx` — o recorte
// de pendência e o "✈ Falta enviar guia". Apagar o arquivo por "o card morreu" derrubaria a tabela,
// a barra de seleção em lote e dois filtros da página principal. `COMPLIANCE_CANDIDATES` é interna
// a ela e vai junto, por isso fica.
//
// ⚠ O NOME DO ARQUIVO ficou falso, e não foi renomeado de propósito: `git mv` num arquivo que cinco
// outros importam é ruído de revisão maior do que o benefício, e esta lápide diz o que ele é hoje.
//
// ⚠ O que o card mostrava NÃO se perdeu — foi conferido campo a campo antes de apagar. O único
// candidato a perda era *"Notas emitidas: R$ …"*, e a Tabela mostra o MESMO
// `company.notasEmitidas.total` (`renderCompaniesTable.jsx:205`) e ainda ORDENA por ele (`:545`).
// O que morreu foi desenho, não informação.
