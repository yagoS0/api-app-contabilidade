# Guias, parcelamentos e documentos de DP — 21/10/2026

Incremento validado localmente, sem publicação ou ativação produtiva. Referência operacional: seção 26 de `REGRAS_OPERACIONAIS.md`. Os pareceres por candidato não substituem os gates e a revisão sistêmica da versão integrada.

## Constatações da auditoria

Consulta somente leitura em PostgreSQL, em 21/10/2026, abrangeu 38 empresas e registros de envio de outubro, incluindo guias de competências anteriores. Foram identificadas 35 guias enviadas em outubro para 17 empresas, 34 ainda sem pagamento confirmado e uma paga. Isso não significa 35 documentos entregues na revisão atual a todos os destinatários.

Há dois lembretes registrados como enviados em outubro, ambos após o vencimento. A rotina diária executou em 19/10 e registrou 21 bloqueios `GUIA_WHATSAPP_NAO_ENTREGUE`. O dia 25 às 8h é a agenda fiscal observada; não explica sozinho a ausência de lembretes. A rotina de comunicação já possuía frequência diária, mas compartilha configuração e ativação com o fiscal na versão anterior.

No conjunto de 35 guias enviadas em outubro, o cruzamento encontrou 33 sem recibo integral da revisão atual, uma com recibo integral mas vencimento inválido operacionalmente (`0001-01-01`) e uma paga, que não deve receber lembrete. As tentativas antigas não possuem `snapshot.revisaoDocumento`; entrega/leitura agregada não substitui essa evidência. O escritor atual já registra a revisão desde o PR #230, de 18/10; os registros incompletos são anteriores. Dados e horários refletem a consulta, não reconstituem automaticamente o estado de cada dia passado. Nenhuma mensagem foi enviada, recibo completado por suposição ou pagamento alterado na auditoria.

Uma seleção ampliada de candidatas ao acompanhamento também tem 35 guias, mas difere por dois registros: exclui a paga e inclui uma guia antiga sem envio em outubro. Não somar ou confundir esses universos. Em 31 guias há arquivo histórico e hash correspondente para investigar conciliação supervisionada; isso não basta para fabricar o digest fiscal histórico. A agenda independente, sozinha, não remove essas pendências de evidência.

Detalhamento com identificadores e evidências permanece em arquivos locais ignorados sob `.altan-governance/`, evitando publicar dados da carteira nos artefatos de desenvolvimento.

## Comportamentos preparados

- Entrega externa: contador informa data e meio; autoria, instante e revisão ficam auditados. Fecha a pendência de envio sem declarar pagamento ou recibo do provedor. Documento inválido e atualização concorrente são recusados.
- Parcelamento no resumo: documento mensal presente continua visível; conferência documental é independente de pagamento e envio.
- INSS: ausência mensal já confirmada (`VAZIO`) é reconhecida em Operações, preservando documento real, conflitos e exceções.
- Lembretes: agenda própria, desligada até configuração explícita; consultas fiscais preservam seus horários e deixam de disparar mensagens. Os lembretes mantêm as exigências de destinatário, recibo, revisão e idempotência.
- Forma de pagamento: configuração por indicação de parcelamento com vigência e histórico, inclusive antes de cadastrar o contrato. Guardas e projeções revisadas, com precedência do contrato real, atualização após salvar e histórico; regressão integral da API aprovada.
- Benefício municipal: acesso direto aos campos existentes e aviso explícito da limitação. Cadastrar benefício ainda bloqueia emissão pela Altan; este incremento não implementa aplicação fiscal do benefício.

## Pagamentos de parcelamentos

A consulta SERPRO reconhece pagamentos elegíveis das modalidades suportadas e conserva evidência, data e valor. Não equivale à contabilização automática: a geração da baixa contábil segue a ação e as guardas existentes, inclusive composição e mês fechado. Não houve consulta fiscal real para validar esse comportamento; a evidência técnica é de código e testes isolados.

## Proposta para documentos de DP

Primeiro incremento viável: importar PDFs exportados do Drive, conferir empresa, competência, categoria (folha ou pró-labore) e responsável, preparar o lote e acompanhar cada entrega. O caminho de pasta é sugestão; o nome não autoriza vincular documento ou escolher destinatário automaticamente.

O armazenamento privado e o envio manual de documentos já existem. Ainda precisam ser desenvolvidos o vínculo de competência/categoria DP, revisão imutável do arquivo, importação conferida e registro durável do lote. Cada tentativa deve identificar arquivo/revisão, destinatário e canal; timeout permanece indeterminado até conferência. Não usar a rota de atendimento humano como worker, pois ela pode assumir o atendimento.

A integração direta ao Drive é uma etapa posterior: acesso somente leitura às pastas autorizadas, paginação e travessia explícita de subpastas, verificação de download, origem e hash. Não presumir que o acesso à pasta concede acesso a todos os descendentes. Referências oficiais: [busca de arquivos](https://developers.google.com/workspace/drive/api/guides/search-files), [download e exportação](https://developers.google.com/workspace/drive/api/guides/manage-downloads) e [escopos de autorização](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Decisão já aprovada: documentos destinados ao responsável da empresa. Para conectar o Drive será necessário identificar a pasta e autorizar o acesso; nenhuma credencial é necessária para validar primeiro o fluxo com upload de arquivos fictícios.

## Ativação e reversão

Antes de publicar: gates integrais, revisão sistêmica da versão final e aprovação aplicável. Antes de ativar lembretes: conferir horário, empresas e pendências de evidência. Para Sintropia, confirmar a competência inicial antes de registrar débito automático nos quatro acordos identificados. Sem baixa ou cobrança retroativa por inferência.

Reversão deve preservar eventos, recibos e declarações externas. Desligar a agenda de lembretes interrompe novas saídas; reverter código não pode restaurar silenciosamente saídas acopladas à consulta fiscal. Não apagar histórico para desfazer uma configuração.

## Validação final local

API: 11.161 testes aprovados na regressão completa; o teste condicional de PostgreSQL foi executado separadamente e aprovado (1/1). Escritório: 5.887 testes, mais 14 após a integração da configuração; portal: 1.580; governança: 72. Gate de dados, builds, lint do web e revisão sistêmica aprovados. Conferência visual com dados fictícios em desktop e celular. Evidências e limites no registro de governança deste incremento. Não representa validação de envios reais nem autorização de publicação.
