# Plano: captura automática de NF-e emitidas e progresso da importação

Atualizado em 17/09/2026 a pedido do usuário. Implementação autorizada em desenvolvimento. Modal implementado; captura automática aguarda validação de uma fonte real. A correção do upload em lotes já publicada permanece como base. Nenhuma publicação nova em produção nesta etapa.

Decisão posterior do usuário: priorizar a integração com o Fisco Fácil RJ. O plano detalhado de consultas, fila, autenticação, ingestão e conferência está em [plano-consultas-fisco-facil-rj.md](plano-consultas-fisco-facil-rj.md). Ele substitui a dependência anterior de identificar o emissor da Vagalo; a próxima dependência é acesso autenticado ao extrator. Limites da versão pública do manual precisam ser conferidos no portal atual.

A proposta preenche uma lacuna real: descobrir e obter automaticamente as NF-e modelo 55 emitidas pelo cliente. A aplicação já possui importação XML/ZIP, verificação do CNPJ por estabelecimento, identificação de emitente/destinatário e ingestão compartilhada com deduplicação. Essa base deve ser reutilizada. NF-e recebidas ficam fora desta ampliação, sem remover a funcionalidade atual.

## O que foi confirmado

- A [documentação da Jettax](https://jettax360-help.freshdesk.com/support/solutions/articles/151000057221-como-configurar-captura-de-nfe-de-sa%C3%ADda) exige 10 XMLs emitidos nos últimos 40 dias para iniciar a captura. Ela não explica o mecanismo de descoberta; inferir sequências ou padrões do código numérico continua sendo hipótese.
- A [documentação oficial de distribuição da NF-e](https://moc.sped.fazenda.pr.gov.br/NFeDistribuicaoDFe.html) não disponibiliza ao emitente o próprio XML da NF-e. Portanto, repetir a captura nacional atual com o mesmo certificado não resolve essa lacuna.
- O [manual do Fisco Fácil RJ, seção 17](https://portal.fazenda.rj.gov.br/fisco-facil/wp-content/uploads/sites/28/2023/09/manual-Fisco-Facil-versao11.pdf) documenta a extração por emitente, mas exige pelo menos 10 dias desde a emissão. Há controle de solicitações e downloads; não se deve tratá-la como uma consulta síncrona que retorna todas as notas de ontem. O manual consultado não comprova uma API pública de integração.

## Ajustes necessários ao plano

Importar XMLs iniciais ajuda a identificar séries e histórico, mas não constitui uma fonte para descobrir novos documentos. Não anunciar “captura pronta” antes de obter uma nota nova de ponta a ponta.

Primeiro comprovar o fluxo autorizado do Fisco Fácil, fonte escolhida pelo usuário, validando acesso, solicitação, acompanhamento, download e eventos. Uma chamada interna do portal não deve ser anunciada como API oficial. Integração com o emissor deixa de ser pré-requisito desta etapa.

Somente após essa prova, implementar o conector e o agendamento. O estado precisa separar tentativa de sucesso, período coberto, solicitações pendentes, estabelecimento e múltiplas séries. Usar janelas sobrepostas com deduplicação, sem presumir que toda numeração ausente seja uma nota perdida.

O importador atual conta e ignora eventos de cancelamento no ZIP. Para acompanhamento automático confiável, a atualização dos eventos também precisa ser tratada e testada; baixar XML não prova que sua situação permaneça autorizada.

Na tela: origem, última tentativa, última captura concluída, período coberto, quantidade importada, pendências e orientação de falha. Ausência de resultado não deve aparecer como captura concluída.

## Critério de aprovação do piloto

Uma NF-e emitida depois da configuração deve chegar sem upload manual, com XML original, vínculo correto e situação conferida. Repetir o ciclo não pode duplicá-la; testar também múltiplas séries, falha de acesso, recuperação após interrupção e cancelamento. O prazo deve corresponder à fonte: a extração do Fisco Fácil não comprova captura diária das emissões recentes.

Nenhum conector, agendamento ou acesso fiscal autenticado foi executado nesta etapa. Pendente comprovar a aquisição no extrator autenticado do Fisco Fácil.

## Execução e conferência

- Modal implementado com acompanhamento por respostas confirmadas, empresa/tipo congelados no início, totais e pendências por arquivo. O mock demonstra lotes e resultados sem gravar notas.
- O modal é renderizado no `AppInterno`, junto do hook já existente, para sobreviver ao voltar/avançar do navegador. Se a empresa mudar por navegação, o resultado permanece identificado com a empresa original e não contamina a aba da outra empresa. Leituras tardias da lista também são descartadas.
- Fechamento por Esc/fundo/X é bloqueado enquanto importa. Há trava imediata de envio duplo e aviso antes de recarregar/sair. Se a sessão for desmontada, os próximos lotes deixam de ser enviados; o lote em andamento não é repetido automaticamente.
- Navegador local: demonstrados 55 XMLs em dois lotes, resultado persistente após fechar, manutenção do modal após voltar para Planejamento e lote misto com uma nota aceita e dois arquivos recusados (NF-e na área NFS-e e XML quebrado). Layout conferido em largura de celular.
- Validação final: 89 testes passaram em seis suítes de importação, modal, resultados, visibilidade de notas e relatório de faturamento; build de produção do frontend concluído. `git diff --check` sem erros. As importações de conferência ocorreram somente no mock, sem gravação fiscal ou publicação.
- Fonte RJ: a consulta pelo buscador retornou bloqueio de rede; o navegador local acessou a [página oficial](https://portal.fazenda.rj.gov.br/fisco-facil/) e o link “Acesse o sistema”. O login SSA exige acesso autenticado; a página institucional admite e-CNPJ do contribuinte, contabilista cadastrado ou outorgado por procuração da SEFAZ-RJ. Nenhuma solicitação fiscal foi criada. A página pública não expôs contrato de API de extração.
- Dependência atual: disponibilidade do acesso autenticado ao extrator. O emissor da Vagalo não é mais necessário para seguir pela fonte RJ escolhida. Não implementar um provedor com endpoints inventados nem afirmar descoberta automática por importar XMLs iniciais.

## Modal de progresso da importação

Implementado em desenvolvimento um modal centralizado para importação manual de NF-e (XML/ZIP) e NFS-e (XML). Abre assim que a seleção inicia o envio; reutiliza o componente Modal da aplicação e a divisão em lotes já existente. Os critérios abaixo orientam o comportamento implementado.

- Identificar empresa e tipo de nota para manter claro o destino dos arquivos.
- Exibir etapa atual: preparação, envio/processamento do lote e conclusão. Durante a requisição, usar “Enviando e processando lote 2 de 5”; a API atual não distingue essas etapas em tempo real.
- Barra calculada pelos lotes com resposta confirmada, acompanhada de “1 de 5 lotes concluídos” e quantidade de arquivos desses lotes. Não usar temporizador para simular avanço nem chamar o envio de concluído antes da resposta do servidor.
- Em lote único ou ZIP grande, mostrar atividade enquanto aguarda a resposta. Um ZIP é um arquivo enviado, não uma nota: só mostrar a quantidade de notas internas quando o servidor a informar. Progresso por nota dentro do ZIP exigiria acompanhamento adicional no servidor e fica separado desta primeira entrega.
- Atualizar os totais confirmados de notas novas, atualizadas, duplicadas e recusadas ao receber cada lote. Conservar os motivos por arquivo no resultado final.
- Em caso de falha, parar os próximos lotes, preservar resultados confirmados e diferenciar lote com resultado desconhecido dos arquivos ainda não enviados. Não repetir automaticamente uma operação sem confirmação do resultado.
- Na conclusão, manter o resumo visível e oferecer “Concluir”; falha parcial não aparece como sucesso total. O resultado continua disponível na tela após fechar o modal.
- Durante o processamento, impedir importações simultâneas e fechamento acidental por fundo, Esc ou X; avisar antes de recarregar/sair e proteger a navegação que desmonta a tela. Não oferecer um botão de cancelamento que apenas feche o modal enquanto a importação continua.
- Garantir foco, leitura acessível do progresso e uso no celular. O mock deve simular etapas e desfechos, identificando que não grava notas.

Integração realizada: callback de progresso em `importarNotasEmLotes`, repassado por `realApi.importInvoicesXml`; estado no `useNotasFiscais`; modal na sessão (`AppInterno`) para sobreviver à navegação. `renderNotasFiscaisTab` mantém o resultado por empresa/tipo e oferece demonstração apenas no mock. Captura agendada terá acompanhamento próprio; não abrir esse modal automaticamente ao visitar a empresa.

## Ordem de execução

1. **Modal em desenvolvimento:** implementar o acompanhamento dos lotes e os cenários do mock. Conferir visualmente e testar sucesso, duplicatas, recusa parcial, falha no segundo lote, ZIP único demorado, resposta ausente, navegação e tentativa de envio simultâneo. Esta parte não depende da descoberta de uma fonte de captura automática.
2. **Prova da fonte de captura:** investigar o fluxo autorizado do Fisco Fácil RJ conforme o plano específico. Registrar como descobrir, obter o XML original, consultar situação/eventos e qual atraso esperar. Ainda não prometer captura automática apenas porque XMLs iniciais foram importados.
3. **Conector e persistência:** implementar a abstração de provedores e o primeiro conector comprovado, reutilizando `upsertNfeFromParsed`, `PortalInvoice` e `NotaItem`, com controle por estabelecimento, séries e períodos. Preservar os serviços de captura existentes.
4. **Piloto e acompanhamento:** comprovar a captura de uma nova nota sem upload, deduplicação e atualização de eventos. Só então habilitar execução periódica e indicadores de cobertura/pendências, respeitando os limites da fonte.
5. **Conferência e publicação:** apresentar o modal e o fluxo comprovado em desenvolvimento para revisão. Publicação da próxima entrega é uma etapa posterior à implementação e à revisão.

Não é necessário exigir 10 XMLs como regra do nosso produto: essa quantidade pertence ao processo documentado da Jettax. A necessidade de documentos iniciais será definida pelo conector que for efetivamente comprovado.
