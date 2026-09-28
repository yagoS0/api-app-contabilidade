# Adequação IBS/CBS — entrega técnica de 28/09/2026

Status: implementação inicial em revisão. Não equivale à conclusão da adequação fiscal nem à ativação em produção.

## Resultado desta entrega

- Catálogos oficiais versionados: 18 CST, 164 classificações tributárias e 26 indicadores do Anexo C. Registra fonte, data de consulta e SHA-256; um importador reproduz os arquivos a partir das fontes públicas.
- Validação de existência, vigência, correspondência CST/classificação e documento permitido. O Anexo VIII continua oferecendo sugestões, mas deixou de ser uma lista exaustiva de operações autorizadas.
- Recusa antes de reservar número quando a integração está desligada e o perfil declara IBS/CBS, quando faltam informações exigidas ou quando o enquadramento do prazo precisa ser confirmado.
- Campo de enquadramento do cronograma no perfil, com as hipóteses de outubro/dezembro de 2026. A seleção é responsabilidade fiscal; não preenche classificação ou benefício automaticamente.
- Pré-preparação do cliente e emissão utilizam a mesma validação IBS/CBS. Os canais que passam pelo `NfseService.issue` herdam a recusa final.
- XML do pedido e contexto usado ficam preservados antes do envio. Falha local depois do retorno nacional exige conciliação e não libera o número.
- Projeção reconstruível de IBS/CBS de NFS-e e NF-e: base, códigos, alíquotas, reduções, valores por jurisdição e total; itens da NF-e preservados. Os números monetários permanecem strings decimais; ausência é diferente de zero.
- Captura e importação usam a projeção na ingestão comum. Resumo posterior de NF-e não apaga XML completo, tributos e classificação, inclusive na corrida entre leitura e gravação.
- Detalhe da nota no escritório e consulta no portal apresentam valores vindos do documento. O destaque não é tratado como crédito apropriado.
- Migração aditiva e reprocessamento por empresa, em simulação por padrão, com proteção contra XML alterado durante o processamento.

## Limites operacionais explícitos

O acesso ao projeto Railway retornou `Not Authorized`. Não foi possível comprovar as flags, migrações aplicadas, carteira, certificados, amostras reais ou conectividade de homologação desta instalação. Nenhuma migração, emissão, evento ou reprocessamento foi executado em produção.

Esta entrega permanece em rascunho até concluir inventário, revisão fiscal e homologação. As novas recusas podem impedir emissões em empresas sem enquadramento ou configuração. Não devem ser promovidas às cegas.

O enquadramento usa a competência informada como data de referência. É necessário validar, por cenário, a relação entre competência, fato gerador, emissão e pagamento antes da liberação. O regime ainda vem do cadastro atual; regime histórico e opção temporal do Simples pertencem à próxima entrega. Por isso, o caminho do Simples em 2027 fica explicitamente pendente de revisão, sem inferir opção a partir de campos preenchidos. **Não há liberação operacional do Simples 2027 nesta versão.**

O emissor continua no leiaute em produção identificado como NT004 + ajuste NT007. Publicação/ratificação da NT009 não foi interpretada como confirmação de implantação. Esta entrega lê os grupos conhecidos, guarda grupos adicionais para rastreabilidade e não emite ajustes de crédito/débito, split payment ou grupos NT009 ainda não homologados.

Projeção é leitura do documento, não verificação de assinatura, autorização ou apuração. O ciclo oficial da nota continua determinando autorização/cancelamento. Os caminhos legados de eventos, a conciliação automática de resposta recebida e os créditos fiscais precisam de entregas próprias.

## Situação das etapas do plano

| Etapa | Situação e próxima entrega |
|---|---|
| E0 — inventário | Script agregado disponível; execução em produção bloqueada pelo acesso. Confirmar carteira, regimes, opções e amostras. |
| E1 — catálogos | Validação oficial implementada; faltam cenários específicos, atualização operacional e matriz completa de versões por ambiente. |
| E2 — vigências | Enquadramento do cronograma cadastrado; faltam histórico de regime/opção do Simples, evidências da opção, vigência do perfil e CNPJ alfanumérico em todos os caminhos. |
| E3 — dados tributários | Projeção XML, contexto do pedido e migração implementados; falta aplicar/homologar migração e reprocessar dados existentes. O backfill da nota preserva itens no JSON; não remapeia linhas históricas de NotaItem por ordem incerta. |
| E4 — emissão | Validação comum e proteção após resposta implementadas; faltam prévia congelada, conciliação automática e homologação ponta a ponta. |
| E5 — canais | Guarda final compartilhada e preparação do assistente; faltam perfil por linha no lote e revisão de cada prévia/modelo/WhatsApp. |
| E6 — recebimento | Leitura integrada e proteção de resumo implementadas; faltam ledger/cursor/eventos, cobertura e conciliação da captura. |
| E7 — apresentação | Escritório e portal mostram IBS/CBS; faltam filtros, resumos/exportações e homologação visual do DANFSe/DANFe contra XML real. |
| E8 — ciclo/eventos | Mantidos os comportamentos anteriores; falta distinguir pedido/aceite/efeito em todos os caminhos, preservar eventos anteriores à nota e revisar isolamento de empresa no ledger. |
| E9 — fechamento/crédito | Mantida proteção de competência fechada; faltam regras de crédito, apuração, fechamento e lançamentos contábeis da reforma. Nenhum crédito é gerado automaticamente nesta entrega. |
| E10 — operações especiais | Dependem da carteira e da disponibilidade oficial do leiaute. Não ativadas. |
| E11 — liberação | Migração aditiva, testes e ferramentas preparados; faltam banco de homologação, piloto por empresa, observabilidade e implantação. |

## Execução das ferramentas

Na pasta `apps/api`, com acesso ao ambiente pretendido:

```sh
node scripts/diag-prontidao-ibscbs.mjs
node scripts/backfill-ibscbs-notas.mjs --empresa ID_PORTAL
# Após revisar o relatório da simulação:
node scripts/backfill-ibscbs-notas.mjs --empresa ID_PORTAL --aplicar
```

O inventário imprime apenas agregados e versões de migrações; as flags informadas pertencem ao processo em execução. O reprocessamento não faz chamadas fiscais, não muda XML nem total de receita, não reabre competências e não gera crédito. Atualiza somente a projeção da nota cujo XML e data de atualização continuam iguais aos lidos.

Na implantação, aplicar a migração `20260928180000_add_projecao_ibscbs`, gerar o cliente Prisma, revisar enquadramento/perfis e homologar antes da ativação. A reversão da aplicação pode manter as colunas novas; não remover os XMLs de pedido e os contextos preservados. Desligar uma flag não é alternativa para omitir informação obrigatória.

## Validação local

- Servidor: 44 suítes, 796 testes aprovados na regressão fiscal. Após acrescentar os casos de retorno vazio e duplicidade E0014, a suíte de emissão foi repetida: 61 testes aprovados, incluindo os dois novos casos (798 casos distintos de servidor verificados).
- Interface do escritório: 3 suítes, 56 testes aprovados; portal: 6 suítes, 100 testes aprovados.
- Compilação das duas interfaces concluída. Permanecem avisos de tamanho dos pacotes e divisão de código, sem erro de compilação.
- Prisma: esquema validado, cliente gerado e diferença conferida contra a base; auditoria de migrações sem comandos destrutivos. A migração não foi executada em banco nesta sessão.
- A regressão fiscal foi incluída no CI. Execução local com Node 24.19; o CI utiliza Node 20, conforme o projeto.

## Fontes conferidas

- [Classificação tributária — SVRS](https://dfe-portal.svrs.rs.gov.br/Cff/ClassificacaoTributaria): relação CST/cClassTrib, vigências e documentos permitidos.
- [Documentação atual de produção NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual): Anexo C e esquemas de produção.
- [RTC e ressalva expressa sobre o Anexo VIII](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc): correlação orientativa e distinção entre NT publicada e implantada.
- [Cronograma oficial da NFS-e](https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-orienta-sobre-os-prazos-para%20destaque-de-ibs-cbs-nas-notas-fiscais-de-servico): hipóteses de outubro/dezembro e Simples em 2027.
- [NF-e NT2025.002 — documento oficial](https://hom.nfe.fazenda.gov.br/PORTAL/exibirArquivo.aspx?conteudo=OJQR7LXdlWA%3D): grupos dos itens e totais IBS/CBS.

Os testes locais usam documentos sintéticos e arquivos versionados. Não substituem uma autorização real no ambiente de homologação e não comprovam o estado da instalação em produção.
