# Comunicação, documentos, entrada de clientes e rotas — desenvolvimento

16/10/2026. Implementação no worktree `altan-revisao-produto-dev`, sem publicação nem comunicação externa.

## Direção e impacto operacional

Consultados os quatro documentos fornecidos pelo usuário, AGENTS, decisões dos módulos Empresas/Onboarding, `docs/design-review.md` e a referência central `../altan-regras-operacionais/REGRAS_OPERACIONAIS.md`.

Aplicam-se R02 (indisponível não é vazio), R19 (evidência após persistência e isolamento de leitura), R21 (filtro/lista coerentes), R22 (controle compartilhado, recuperação, celular) e R23 (descarte confirmado e vínculos). Nenhuma política tributária, de baixa ou envio foi alterada. V08 continua pendente: não foi inventado arquivamento de oportunidade nem remoção em cascata. A autorização explícita de executar em dev prevalece sobre o gate genérico de wireframe do pacote.

## Diagnóstico e implementação

| Área | Problema encontrado | Mudança |
|---|---|---|
| Anotações | Resposta antiga podia aparecer na empresa seguinte; modal de exclusão fechava mesmo quando o hook recusava | Invalidar requisições por revisão/contexto; recusa mantém nota e confirmação com nova tentativa |
| Anotações | Ações com estilos próprios, prioridade repetida, instrução longa no vazio | Button compartilhado, prioridade só no controle colorido, vazio conciso; nota fixa e rascunho provenientes do chat preservados |
| Documentos | Lista sem filtro, CTA repetido, instrução extensa; leitura inválida virava lista vazia | Busca e filtro por tipo com limpeza, uma ação de inclusão; erro distinto; resposta antiga descartada e seleção limpa na troca de empresa |
| Suporte | Fila indisponível dependia de aguardar polling | Recuperação explícita; remover resumo idêntico ao motivo. Conversa, confirmação e ações existentes preservadas |
| Entrada de clientes | Resposta lenta de busca sobrescrevia filtro mais recente, erro sem retry | Leitura versionada, contrato de lista validado, recuperação explícita; remover subtítulo redundante |
| Demonstração de documentos/notas | Arrays globais ignoravam empresa; recarga perdia mudanças, IDs dependiam de tamanho; download devolvia conteúdo inválido | Helper isolado por empresa, metadados/notas em sessionStorage, IDs sequenciais únicos, exclusividade da fixação, destinatário respeitado; download entrega o arquivo realmente anexado ou indisponibilidade explícita |
| Demonstração da central | Regime estava na empresa legada, mas o leitor mock procurava só na raiz; quadro de rotinas inventava regime pelo índice; avisos indisponíveis | Aplicabilidade usa regime cadastrado da fixture; avisos e reconhecimento reutilizam a mesma pendência da auditoria, sem inferir transmissão |
| Aplicação completa | Vite retornava `504 Outdated Optimize Dep`, tela branca fora do harness | Diagnóstico reportado; servidor reiniciado com regeneração de dependências pelo agente principal |

## Layout aplicado

Anotações preserva duas áreas: notas/pedidos e conversa ampla. Importância e fixação usam a paleta existente; uma única indicação por dado. Documentos usa cabeçalho com inclusão, busca/tipo e tabela densa. A tabela mantém rolagem local no celular. Não há novos cartões decorativos, paleta ou texto explicativo permanente.

Documentos é o acervo cadastral do backend (`CompanyDocumentsService`), sem competência/versão expostas no contrato atual. Não foram inventadas datas de competência, versões ou estados fiscais para esses arquivos. Guias/notas fiscais preservam seus próprios domínios. Arquivos reais do mock ficam na memória da aba; metadados sobrevivem à recarga, mas baixar um binário não disponível informa a limitação. Nenhum arquivo é transmitido a provedores pelo mock.

## Verificação

- 82 testes passaram no primeiro conjunto: documentos/anotações, descarte/entrada de clientes e mapa de rotas.
- 40 testes passaram no conjunto após recuperação do suporte: documentos/anotações, descarte, chat e layout móvel. Há sobreposição: não somar os conjuntos como testes únicos.
- 30 testes em sete suítes passaram no conjunto final de documentos/notas, mock documental, automação/avisos e recuperação de suporte. Em rodada de compatibilidade anterior, um teste de onboarding excedeu 5 segundos sob carga; repetido com limite de 30 segundos junto das suítes mock/revisão: 13 testes passaram. Não somar rodadas sobrepostas.
- Após o último ajuste de textos/contadores, 23 testes de documentos e páginas WhatsApp passaram; 29 testes de documentos e descarte/entrada de clientes passaram. `git diff --check` sem erros (somente aviso de conversão LF/CRLF).
- `apps/web/scripts/verify-product-routes.mjs` entra pela tela real de login mock, abre a primeira empresa e percorre as onze abas do plano, Entrada de clientes, Suporte e Operações em 1440 e 390 px. Bloqueia rede fora do localhost, captura tela e registra erro JavaScript, página vazia, carregamento persistente e overflow.
- Evidências em `test-evidence/rotas-produto/`. A primeira passagem encontrou carregamento lazy em algumas capturas; essas capturas foram substituídas na passagem final, que esperou a montagem: 28 capturas, 14 rotas em dois tamanhos, nenhum erro JavaScript, página vazia, carregamento persistente ou overflow. `results-operacoes.json` registra nova passagem após corrigir o mock da central: seis empresas habilitadas e seis avisos coerentes com a auditoria da demonstração.
- `apps/web/scripts/verify-communication-dev.mjs` passou no navegador real: criar nota → recarregar → fixar → conferir isolamento em outra empresa → filtrar documentos → anexar arquivo → baixar o arquivo anexado → excluir documento → excluir nota → recarregar e confirmar ausência. Evidência em `test-evidence/comunicacao-dev/results.json` e captura da nota persistida. Rede externa bloqueada.
- Visual de Anotações e Documentos inspecionado em desktop/celular: sem overflow da página; conversa e controles alcançáveis; tabela documental rola dentro do contêiner.
- Visual da entrada de clientes e suporte também inspecionado: fluxo comercial preservado, vazio do chat reduzido a “Selecione uma conversa”. Documentos chama a data de criação “Adicionado em”, para não confundir upload com envio ao cliente; validade futura não recebe atenção artificial, vencida ganha texto e cor.
- As rechecagens `results-suporte.json` e `results-documentos-onboardings.json` registram as capturas finais dessas telas, sem overflow, tela vazia, carregamento persistente ou erro JavaScript. Entrada sem resultados usa um único vazio, preservando criação e filtros. Contadores não exibem zero quando a leitura está indisponível.

## Critérios de aceite preservados

1. Trocar empresa/filtro durante leitura não exibe resposta atrasada de outro contexto.
2. Falha ou resposta incompleta não afirma inexistência de documentos/notas/atendimentos.
3. Excluir nota recusada mantém confirmação e conteúdo; sucesso a fecha.
4. Filtros documentais não apagam seleção existente nem alteram arquivos.
5. Exclusão de rascunho mantém confirmação, bloqueio por vínculo e tratamento de conflito já implementados.
6. Conversa não dá baixa contábil, marca pagamento nem envia documento por abrir uma tela.
7. Alterações demonstrativas da empresa A não alteram a empresa B; recarga conserva metadados e notas.

## Limites

Navegação e simulação local não provam integrações externas. SERPRO, Meta, e-mail e armazenamento remoto não foram chamados nesta auditoria. A validação do fluxo fiscal/contábil pertence às respectivas entregas e evidências de banco local do agente principal. Este registro não declara a aplicação inteira homologada nem aprova V01–V08.
