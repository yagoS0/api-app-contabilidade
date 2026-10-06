# Pendências fiscais em tabelas e simulação de parcelamento

Plano de implementação — 06/10/2026. Base inspecionada: `main`, commit `7061b2f`.

## Objetivo e limite da verificação

Evoluir a Situação Fiscal existente para exibir pendências individualizadas, em tabelas separadas por origem, com seleção de débitos, comparação de regularizações e histórico. Público inicial: empresas do Simples Nacional e Lucro Presumido.

Verificados: código, modelos, rotas, interface e documentação pública oficial. Não foram executadas consultas autenticadas, acesso ao banco de produção, contratação de produtos, emissão de guias ou adesão a acordos. Disponibilidade documentada não comprova habilitação do contrato, procuração ou funcionamento na empresa real. Municípios e UFs da carteira não foram informados; a homologação municipal/estadual permanece uma dependência delimitada, não um impedimento para as tabelas e importações.

## Viabilidade por fonte

| Fonte/operação | Evidência | Decisão |
| --- | --- | --- |
| SITFIS RFB/PGFN | API `SITFIS`, `RELATORIOSITFIS92`, versão 2.0; retorno PDF base64. O app já solicita protocolo, emite, guarda e interpreta. | Reutilizar consulta e leitores; estruturar dados a partir do documento, sem tratar o retorno como JSON de débitos. |
| Parcelamentos ordinários SN | App implementa pedidos, contrato, parcelas disponíveis, guia e pagamento. | Reutilizar e homologar os fluxos existentes. |
| Parcelamentos especiais SN | Documentação inclui `PARCSN-ESP/PEDIDOSPARC173`, `PERTSN/PEDIDOSPARC183`, `RELPSN/PEDIDOSPARC193`; catálogo contém também detalhe, pagamento e emissão. App tem suporte parcial e descoberta automática só PARCSN/PARCMEI. | Ampliar por operação/modalidade, com fixtures oficiais e piloto. Não presumir mesmos campos/IDs. Programa antigo consultável não significa adesão aberta. |
| Dívida ativa federal complementar | Produto oficial SERPRO Consulta Dívida Ativa permite consulta por CNPJ/CPF/inscrição e informa situação, valores, órgão e processo. | Conector separado, condicionado à contratação/habilitação, escopo e contrato técnico. Não confundir com API Conecta destinada a órgãos públicos, nem com negociação SISPAR. |
| Novos acordos RFB/SN | Catálogo Integra-Parcelamento examinado contém acompanhamento/emissão; não foi localizado serviço de nova simulação/adesão. | Simulação estimativa interna com regras versionadas; registrar resultado oficial obtido no portal. |
| Negociação PGFN | Regularize/SISPAR oferece Simular/Negociar; transações podem depender de capacidade de pagamento e edital. | Importar/registrar proposta oficial. API comercial de negociação não confirmada; não prometer execução automática. |
| ISS/taxas municipais e dívida ativa municipal | App tem guias ISS e cadastro municipal; não foi localizado conector de passivo municipal. NFS-e/ADN não comprova consulta integral da conta fiscal. | Extrato/documento com conferência inicialmente; conectores específicos após inventário de jurisdições. |
| Estadual | Nenhum conector genérico de passivo estadual identificado no fluxo analisado. | Mesmo contrato de importação/fonte; homologação por UF/SEFAZ/PGE. |

## Encaixe no código

| Existente | Uso proposto |
| --- | --- |
| `apps/api/src/application/fiscal/serpro/SerproSitfisService.js` | Manter protocolo, limites e obtenção de relatório. |
| `lerRelatorioSitfis.js`, `parseSitfisRelatorio.js`, `apps/pdf-reader/app/extractors/sitfis_posicional.py` | Preservar leitura posicional com confronto textual e material não interpretado. Acrescentar normalização após essa etapa. |
| `apps/api/prisma/schema.prisma`: `CompanyFiscalStatus` | Conservar compatibilidade com consumidores atuais; complementar com histórico imutável de consultas/evidências. |
| `apps/web/src/features/fiscal/sitfis/components/renderSitfisTab.jsx` | Hospedar as novas tabelas na aba atual; relatório original continua disponível. |
| `SitfisRelatorioTabela.jsx` | Preservar apresentação documental e regras de totalização; nova tabela operacional usa registros normalizados. |
| `apps/api/src/routes/firm/index.js`: `/pendencias/fiscal` | Evoluir resumo da carteira sem quebrar resposta antiga. Extrair novas rotas para módulo próprio. |
| `serproParcelamentoMap.js`, `SerproParcelamentoService.js`, `ParcelamentoDescobertaService.js` | Ampliar cobertura de consulta sem duplicar contratos/parcelas. |
| `routes/firm/parcelamentosAcompanhamento.js` e entidades `Parcelamento`/`Parcela` | Fonte dos acordos já existentes e vínculos após confirmação. |
| `SerproCallGuard`, `SerproRespostaCache`, `FiscalExecutionLog`, `ManualTask` | Reutilizar controle de consumo, cache, log e execução longa. |
| `application/planejamento/SimulacaoPlanejamentoService.js` | Reaproveitar padrão de cenário congelado e documentos; criar cálculo de parcelamento próprio no servidor. |

Não reintroduzir o painel de acompanhamento anteriormente retirado da aba contábil. Preservar upload de parcela em Guias e cadastro contábil existentes.

## Experiência da tela

Tabelas independentes: Receita Federal; PGFN; Municipal (por município); Estadual (por UF); Obrigações/irregularidades sem valor; Parcelamentos existentes. Manter subtipo de débito e estágio da cobrança separados do tributo. Simples é modalidade/regime, não órgão cobrador.

Colunas financeiras: seleção, tributo/código, competência, vencimento, principal, multa, juros, encargos, total informado, situação e ações. Número de inscrição/processo e estabelecimento conforme origem. Valores não fornecidos permanecem nulos. Não ratear um consolidado para inventar composição.

Em cada tabela: fonte, data-base do documento, última consulta bem-sucedida, última tentativa e cobertura. Estados distintos: não consultado; consultado sem registros; registros encontrados; leitura parcial; acesso pendente; falha. Valor conhecido com itens não quantificados deve ser explicitamente subtotal, nunca passivo total da empresa.

Ações: ver origem/documento; filtrar/ordenar; exportar; selecionar débitos; simular; salvar proposta; registrar simulação oficial; vincular acordo confirmado. Seleção entre órgãos resulta em cenários separados e visão conjunta do fluxo mensal. Obrigações sem valor ficam fora do cálculo.

## Modelo de dados proposto

- `FiscalConsulta`: empresa (`portalClientId`), fonte, órgão/jurisdição/inscrição, escopo consultado, tentativa, sucesso, data-base, resultado, documento, hash, versão do leitor e completude. Guardar snapshots imutáveis. Não sobrescrever evidência anterior.
- `FiscalPendencia`: identidade da pendência, empresa, órgão cobrador, tributo, identificação oficial, competência, natureza (débito/omissão/outro), situação fiscal e situação de tratamento independentes.
- `FiscalPendenciaEvidencia`: vínculo pendência/consulta, referência de página/bloco/linha quando disponível, valores Decimal, texto original, qualidade da leitura. Resposta bruta fica protegida no servidor/storage.
- `FiscalPendenciaVinculo`: associações comprovadas com guia, inscrição sucessora ou parcelamento; autor e motivo. Suportar vários débitos em um acordo e guia composta sem duplicar valores.
- `SimulacaoParcelamento`: empresa, modalidade e versão de regra, entradas, seleção congelada com versões das evidências, resultado, data-base, hipóteses de atualização, origem estimada/oficial, autor e documento. Recalcular cria nova versão.

Unicidade por empresa/fonte/jurisdição/identificador oficial quando existente. Sem identidade oficial suficiente, chave de evidência idempotente por documento/bloco/linha; similaridade só sugere conciliação. Alteração de valor não cria automaticamente nova dívida. Saída de um relatório não prova pagamento. Transferência RFB→PGFN preserva histórico e só exclui dupla contagem com vínculo comprovado. Dívida parcelada e saldo do acordo não podem ser somados como duas exposições independentes.

## Serviços e rotas propostos

Novos módulos em `application/fiscal/pendencias/`: normalização SITFIS, importação, consulta de cobertura, conciliação e leitura das tabelas. Contrato de fornecedor explicita operações disponíveis: consultar débitos, consultar acordos, simular, emitir; operações não suportadas devolvem motivo.

- `GET /firm/companies/:companyId/fiscal/pendencias`: filtros/paginação, tabelas e totais por fonte.
- `GET /firm/companies/:companyId/fiscal/fontes`: cobertura e datas.
- `POST /firm/companies/:companyId/fiscal/reprocessamentos`: só documentos salvos; tarefa idempotente.
- `POST /firm/companies/:companyId/fiscal/importacoes`: documento/arquivo, prévia conferível e confirmação antes de consolidar dados.
- `POST /firm/companies/:companyId/fiscal/consultas`: operação explícita por fonte, usando orçamento e agenda existentes.
- `POST /firm/companies/:companyId/fiscal/simulacoes`: validar elegibilidade e calcular no servidor.
- `GET /firm/companies/:companyId/fiscal/simulacoes/:id`: resultado congelado.
- `POST /firm/companies/:companyId/fiscal/simulacoes/:id/documento`: exportar a versão salva.
- Registro de simulação oficial exige documento/fonte, data e identificação dos débitos; não converte estimativa em oficial por simples edição de rótulo.

Todas as rotas respeitam o acesso à empresa/carteira; mutações exigem papel contábil apropriado. GET deve ler estado e não disparar consulta paga. Não copiar para novas rotas o efeito de reprocessamento atualmente presente em alguns GETs.

## Simulação: cálculo e regras

Primeiros perfis: parcelamento ordinário do Simples na RFB e parcelamento ordinário RFB de demais débitos elegíveis de PJ. A regra é por modalidade e natureza do débito, não apenas regime da empresa.

Na documentação consultada: SN até 60 parcelas, mínimo R$ 300; demais débitos PJ no serviço ordinário RFB até 60, mínimo R$ 500. Reparcelamento pode exigir primeira parcela de 10% ou 20%. GFIP, Simples/MEI, débitos não declarados e recuperação judicial têm procedimentos específicos: separar, não aplicar a regra geral. Esses limites são parâmetros versionados, não validação completa de elegibilidade.

Implementar elegibilidade, abrangência exigida pela modalidade, restrições de seleção, histórico de reparcelamento, entrada, arredondamento e limites. Se faltarem dados determinantes, mostrar pendência e não apresentar elegibilidade como confirmada. Conferir vigência e referência normativa antes de liberar cada perfil.

Calcular em Decimal/centavos. Distinguir saldo na data-base, composição, atualização até a consolidação, entrada e parcelas posteriores. Não reaplicar juros sobre um saldo já atualizado sem respeitar a data-base. SELIC futura não é conhecida: apresentar valor-base e hipóteses explícitas quando houver projeção, sem chamar o custo futuro de definitivo. Não usar motor Price genérico como regra tributária.

Para PGFN, municipal e estadual, permitir registrar e comparar propostas oficiais inicialmente. Perfis estimativos só após regras locais/edital verificadas. Capag, descontos, elegibilidade e prazo de adesão dependem da modalidade; não inferir benefício pelo CNPJ/regime.

Salvar ou aprovar cenário interno não adere ao acordo, não gera guia, não envia mensagem e não cria provisão/baixa. Ao confirmar um acordo efetivo, vincular ao cadastro de parcelamento existente; preservar os atos contábeis explícitos do app.

## Sequência de implementação e aceite

| Etapa | Trabalho | Critério de conclusão |
| --- | --- | --- |
| 1 — Base confiável | Corrigir REGULAR por ausência de texto; separar tentativa de relatório válido; adicionar modelos e normalização de documentos salvos. | Documento vazio/ilegível não vira regular; reprocessamento repetido não duplica; relatório original preservado; nenhuma chamada externa. |
| 2 — Tabelas operacionais | Tabelas por origem, filtros, seleção, evidências, resumo da carteira, exportação e visualização dos acordos existentes. | Cada linha rastreável; valores e totais conferidos com documentos; omissões/valores desconhecidos não somem; troca de empresa não mistura respostas. |
| 3 — Importação municipal/estadual | Importação assistida de extratos e lançamento documentado; prévia, validação, jurisdição e histórico. | ISS visível mesmo sem API; duplicata reconhecida; guia conhecida não representa cobertura completa municipal. |
| 4 — Simulador inicial | Perfis SN/RFB-PJ, cálculo no servidor, versões, comparação e PDF; registro de propostas oficiais. | Cenários conferidos contra portal oficial nas mesmas condições/data; testes de limites/reparcelamento/juros; nenhum ato fiscal ou contábil implícito. |
| 5 — Ampliação de consultas | Especiais SN; Consulta Dívida Ativa se habilitada; conectores locais por prioridade comprovada. | Cada fonte com contrato técnico, acesso, custo, escopo, fixtures e piloto documentados; falha parcial permanece visível. |
| 6 — Implantação gradual | Migração aditiva, reprocessamento em lotes, feature flag, piloto e observabilidade. | Sem regressão em guias/baixas/carteira; desligar UI/conector preserva dados e fluxos anteriores. |

Etapas 1–4 entregam o núcleo pedido sem depender da contratação de nova API. Documentação dos conectores pode avançar em paralelo, mas a cobertura municipal/estadual só é declarada para jurisdições homologadas.

## Validações necessárias

1. PDFs com RFB limpa e PGFN devedora; débito suspenso; omissão sem valor; bloco ilegível; valor ausente e zero verdadeiro; relatórios extensos. Verificar o truncamento atual do texto em 20.000 caracteres e preservar o conteúdo integral na nova evidência.
2. Reimportação concorrente, alteração de saldo, documento antigo chegando depois de novo e vínculo RFB/PGFN incerto.
3. Guia composta, acordo existente e parcela paga: nenhuma soma ou baixa duplicada.
4. Isolamento por carteira/empresa em leitura, importação, simulação, documentos e exportação.
5. Modalidades SERPRO com envelope, IDs, dados vazios, respostas 202/304 e erro; cache/reserva/custos preservados. Não executar APIs reais em testes automatizados.
6. Simulação: limites mínimos/máximos, centavos, entrada, reparcelamento, débito incompatível, data-base divergente, regra expirada, valor editado após cálculo e cenário salvo imutável.
7. Teste de navegador com tabelas desktop/celular, filtros, seleção, mudança de empresa, evidência e comparação de cenários.
8. Migração/reprocessamento em PostgreSQL de homologação; piloto de leitura com escopo definido e chamadas contabilizadas. Pagamento, transmissão, adesão e mensagens ficam fora do piloto de consulta.

## Dependências operacionais remanescentes

- Verificar no ambiente autorizado flags, contrato e permissões SERPRO, sem expor segredos; código não comprova configuração de produção.
- Extrair somente município/UF/inscrição e contagem de empresas da carteira real para priorizar fontes. O schema tem `PortalClient.municipio`, `uf` e `inscricaoMunicipal`; o checkout não fornece essa distribuição.
- Homologar cada jurisdição: consulta administrativa, dívida ativa, autenticação, API/exportação, regras e data dos dados. São Paulo é apenas exemplo pesquisado, não município presumido da carteira.
- Confirmar proposta comercial e documentação técnica da Consulta Dívida Ativa. Não estimar preço sem tabela vigente do contrato. Medir custo como volume de operações cobradas por fonte/modalidade, descontando cache/reprocessamento local.
- Obter exemplos oficiais de simulação para validar cada perfil, inclusive histórico de reparcelamento. Documentação pública sozinha não comprova elegibilidade de uma empresa.

## Fontes oficiais consultadas em 06/10/2026

- [Catálogo Integra Contador](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/).
- [SITFIS: emissão e retorno PDF](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sitfis/sitfis/servicos/emitir_relatorio/).
- [Pedidos PARCSN Especial](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-parcelamento/parcsn_esp/servicos/consulta_pedidos/), [PERTSN](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-parcelamento/pertsn/servicos/consulta_pedidos/) e [RELPSN](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-parcelamento/relpsn/servicos/consulta_pedidos/).
- [Produto Consulta Dívida Ativa](https://www.gov.br/pt-br/servicos/obter-solucao-de%20consulta-de-dados-de-divida-ativa).
- [Parcelamento Simples](https://www.gov.br/pt-br/servicos/parcelar-imposto-simples) e [parcelamento ordinário RFB](https://www.gov.br/pt-br/servicos/parcelar-imposto).
- [PGFN: transação por capacidade de pagamento e fluxo SISPAR](https://www.gov.br/pgfn/pt-br/servicos/orientacoes-contribuintes/acordo-de-transacao/edital-no-6-2026/transacao-conforme-a-capacidade-de-pagamento-edital-ndeg-06-2026). Consultar vigência no momento da simulação; a citação não habilita oferta automática.
- [NFS-e: documentação técnica](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual).
- [São Paulo: consulta de ISS em dívida ativa](https://prefeitura.sp.gov.br/web/procuradoria_geral/w/servicos/334243).

## Implementação local — 06/10/2026

- Tabelas compactas no design existente; detalhes e composição do valor sob demanda.
- Cadastro manual por empresa disponível mesmo sem SITFIS. Formulário final solicitado: valor, competência, imposto, vencimento e descrição. Origem herdada da tabela. Edição e exclusão disponíveis nos detalhes.
- API com controle de acesso por empresa, escrita a partir de ACCOUNTANT, validação compartilhada, idempotência na criação, versão otimista e exclusão lógica. Registros manuais ficam separados do snapshot SERPRO.
- Migration `20261006180000_pendencias_fiscais_manuais` preparada; schema validado, mas nenhuma migration aplicada a banco remoto. Migration aplicada somente ao PostgreSQL local contabilidade_dev (127.0.0.1:5433); persistência real validada por HTTP. Prévia usa dados fictícios e localStorage por empresa somente no mock.
- Exportação PDF por órgão com dados da empresa, competência, vencimento, valores, situação, origem e descrição; respeita filtros ou seleção explícita. Subtotais de relatório e manuais separados. Sem envio automático ao cliente. PDF gerado no navegador com PDFKit já existente.
- Validação: testes de UI/cadastro, isolamento, permissões, concorrência e exportação; PDF de teste de uma página e cenário de seis páginas renderizados. Sem consultas SERPRO, alteração de produção, push ou deploy.
- Prévia local: http://127.0.0.1:5199/pendencias-dev.html. Simulador de parcelamento e novos conectores ainda pendentes.


## Fluxo contábil integrado — implementação em code

Checkout: C:/Users/yagoa/code/api-app-contabilidade, branch local codex/adequacao-nfse-rtc. Alterações anteriores do checkout preservadas. Sem commit, push ou deploy de produção.

- Lançamentos ganhou Pagamentos: abre as provisões em aberto/parciais do mês anterior, inclusive dezembro → janeiro, e permite escolher outra competência de origem. Reutiliza a baixa existente da Circular, com passivo, banco, principal, juros e multa. A data real deve pertencer ao mês de pagamento selecionado; meses fechados continuam bloqueados pelo servidor.
- Receitas, despesas, folha/pró-labore, provisões e pagamentos são marcados automaticamente quando há lançamentos válidos da respectiva categoria. O cálculo compartilhado alimenta detalhe, fechamento e carteira. Não basta consultar SERPRO; o lançamento precisa existir. Confirmação manual continua disponível para meses sem movimento. Exclusão e estorno no mês aberto removem o automático quando não resta lançamento da categoria.
- Circular mostra Mês fechado a partir do fechamento contábil já existente. Pendência usa o mês do vencimento documentado; sem data, usa o mês seguinte à competência da provisão. Fechar a provisão não antecipa o pagamento para o mesmo mês.
- Saldo em aberto no mês de pagamento fechado aparece vermelho como Vencido no fechamento. É alerta contábil, não certificação de atraso pela autoridade fiscal. Valor é o saldo remanescente calculado pela baixa/estorno, não o valor original inteiro. Guias vinculadas a parcelamento ficam no acompanhamento do acordo.
- Situação Fiscal lê GET /firm/companies/:companyId/pendencias-contabeis e reaproveita a mesma leitura anual da Circular (inclusive INSS/DAS vindos de guia). Origem Contabilidade explícita e somente leitura, com subtotal independente. Não grava uma cópia da dívida. Pagamento, estorno e reabertura repercutem na próxima leitura. Falha de consulta é exibida e bloqueia exportação de um relatório incompleto.
- DAS apenas exibido como guia, sem provisão real, exige gerar a provisão pelo extrato antes da baixa; o seletor explica essa condição. INSS usa o fluxo específico de baixa da guia já existente.
- PDF preserva a origem Contabilidade e seu subtotal separado de SITFIS e lançamentos manuais.

Validação: suites de regressão da Circular/baixa/fechamento, novos testes de checklist, saldo e virada de ano, formulário de pagamento e origem no PDF; build web; geração Prisma. Teste HTTP real reproduzível em scripts/testar-fluxo-contabil-local.mjs, protegido para executar exclusivamente contra contabilidade_dev local, com empresa sintética descartada ao terminar. Cobriu pagamento parcial, fechamento, bloqueio de escrita em mês fechado, reabertura, quitação, estorno, remoção de marca automática e persistência de pendência manual, sem consultas externas. PDF de demonstração de duas páginas e teste de paginação de seis páginas.

Prévia 5199 agora é servida deste checkout e permite alternar Lançamentos, Circular e Situação fiscal com dados fictícios; ambiente completo local com API real permanece em http://127.0.0.1:5173. Produção depende de autorização explícita do usuário.


### Ajustes de interação e aparência
- Pagamentos exibe a quantidade de baixas disponíveis, inclusive saldos de competências anteriores ao mês anterior. A leitura vem de /pagamentos-pendentes, com a mesma montagem da Circular e sem consulta externa.
- Modal usa seletor com nomes dos meses e opção Todas as competências; removido o texto explicativo redundante. Dar baixa abre o mesmo editor da Circular (data, histórico, contas, valores e inclusão de partidas).
- Expressão Vencido no fechamento substituída por Pagamento pendente: fechamento e vencimento são conceitos diferentes. A condição de alerta contábil permanece a mesma.
- Meses fechados recebem verde suave na linha inteira, com tag Fechado/Aberto à esquerda do mês. O texto de valores pendentes continua destacável.
- Teste HTTP local passou com contador antes/depois da quitação; regressões de baixa, Circular e exportação e build aprovados. Sem alteração de produção ou integração na branch remota dev nesta etapa.

## Integração na branch dev — 06/10/2026

Integração isolada a partir de origin/dev (2489e53a), preservando o restante da branch e os trabalhos não relacionados no checkout original. Não inclui alterações de NFS-e, reforma tributária, calendário ou primeira parcela de acordos.

- Fluxo ligado às páginas reais da empresa: Lançamentos, Circular e Situação Fiscal.
- Tags Aberto/Fechado verticais fora da tabela; linha fechada verde; legenda de trimestre removida.
- Migração incluída: 20261006180000_pendencias_fiscais_manuais. Aplicar no banco de desenvolvimento antes de usar a inclusão manual. Não foi executada em banco remoto ou produção nesta integração.
- Validação na versão integrada: 66 testes web e 57 testes API aprovados, build web, geração Prisma e teste HTTP real com banco local. Conferência na interface completa: contador 3 → 2, baixa editável, lançamento salvo e checklist de pagamentos marcado automaticamente.
- Prévia completa local em http://127.0.0.1:5200, API local em 3001, banco contabilidade_dev. Empresa DEMONSTRAÇÃO LOCAL — Pendências contém somente dados fictícios de conferência. Arquivos de ambiente e dados locais não integram o commit.
- Envio autorizado exclusivamente para dev. Main e produção permanecem fora deste trabalho; o envio Git não comprova implantação em hospedagem remota.

## Preparação para main/produção — 06/10/2026

Publicação autorizada pelo usuário após validação na dev. Integração parte de main 7061b2fa, trazendo somente o commit do fluxo fiscal/contábil da dev. Preserva a separação de principal, juros e multa na baixa de ISS, o recálculo de guias, a classificação histórica de tributos e as demais funções atuais da main. Legenda de trimestre removida também nesta versão.

Build web, geração Prisma, auditoria de migrações, regressões contábeis e teste HTTP com PostgreSQL local realizados antes da publicação. A migração é aditiva; o start:prod existente executa prisma migrate deploy antes de iniciar a API. A implantação remota deve ser acompanhada pelos status do Railway e pela saúde da API e do frontend, sem consultas fiscais reais ou gravações de demonstração em produção.
