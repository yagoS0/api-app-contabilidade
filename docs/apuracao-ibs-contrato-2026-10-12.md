# IBS: contrato público e bloqueios de integração

Referência verificada em 12/10/2026: [CGIBS, MOC API Apuração Assistida v1.10, 23/09/2026](https://cgibs.gov.br/upload/arquivos/202609/23171119-moc-api-apuracao-assistida-ibs-v1-10-23092026.pdf). Pesquisa pública não identificou versão posterior; isso não garante inexistência de documentação restrita.

## Evidência do MOC (páginas impressas)

Etapa 1 indica testes em 28/09/2026; produção e etapas posteriores sem data (p.4). Diferencial segue processamento diário; solicitação manual limita período à competência, duas solicitações/dia, sem sobreposição (pp.13–14). Notificação identifica solicitação, arquivos e validade; uma operação pode atravessar arquivos. Lançamentos complementam o extrato, cujo hash representa o acumulado (pp.19–20,29–33).

Credenciais usam ClientID/ClientSecret; webhook admite TokenContrib. Habilitação propõe POST `/v1/aassist/habilitar`. Inclusão propõe GET `/v1/aassist/solicitacao/incluir` com corpo. Exemplos divergem das tabelas nos nomes de campos. Não foi localizada base HTTP nem rota de download; anexos detalham o retorno. Algoritmo do hash e tabela MOV permanecem pendentes. Saldo, emissão/consulta de guia e PDF aguardam especificação; não há confirmação de pagamento implementável (pp.18–25,29).

## Decisões ALTAN

`IbsCapacidades.js` publica metadados imutáveis e motivos legíveis por máquina; todas as capacidades permanecem OFF em ambos ambientes. `criarClienteIbsBloqueado().executar(acao)` sempre recusa; não recebe rede ou cofre. Configuração local não altera esse resultado. Nenhuma rota, hostname, autenticação OAuth ou verbo alternativo foi inventado.

Para liberar transporte, obter contrato oficial executável com base por ambiente, rota de download, versão inequívoca dos nomes, limites de arquivo e homologação do contribuinte. A futura ingestão deve preservar lote/parte e bytes brutos, recusar duplicidade contraditória, comprovar todas as partes antes de cobertura e impedir confusão entre delta e saldo. Isso é requisito interno proposto, não capacidade externa presente. Hash ilustrativo não deve ser tratado como prova de integridade; SHA-256 local serve apenas à integridade do arquivo armazenado. Guias e pagamento exigem contratos separados antes de liberação.
