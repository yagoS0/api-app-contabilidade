# Plano de implementação da consulta cadastral de CNPJ

Data: 13/10/2026. Status: publicação gratuita autorizada pelo responsável e preparada sobre a main atual. A ativação paga continua proibida nesta entrega. As referências abaixo a ausência de publicação descrevem as etapas anteriores à liberação.

## Preparação da publicação gratuita

Branch `codex/consulta-cnpj-producao`, baseada em `c8b81ff`. Mudanças de outros trabalhos foram preservadas na árvore original e não integram esta publicação. A rota de consulta do tomador já existente na main também usa cache, preservando os controles atuais de respostas tardias do emissor. Schema e migration validados; builds dos dois portais aprovados. Validações locais: 235 testes da API (incluindo perfis, após ajuste do mock da nova dependência), 99 do contador, 24 do portal e 18 verificações PostgreSQL. Os checks do PR e o estado da implantação ainda precisam ser conferidos.

Produção usa Railway conectado à main. O start da API aplica migrations antes de iniciar. A nova migration apenas adiciona tabelas e a linha ALTAN desabilitada com preços/teto zero. Nenhuma credencial Consulta CNPJ foi injetada; o runtime fixa `habilitarPago: false`. O cache usa o cofre já adotado pela API; em falhas de leitura/banco permanece a consulta gratuita, e falhas de gravação preservam o resultado sem persistir cache.

## Implementação atual

Preparação da homologação: [roteiro e critérios](homologacao-consulta-cnpj.md), executáveis com `node scripts/homologar-consulta-cnpj.mjs`. Execução local de 13/10/2026: 185 testes da API, 100 do contador, 24 do portal e 18 verificações PostgreSQL aprovados. Evidências em `test-evidence/cnpj-2026-10-13T23-38-37-614Z` e `.local/cnpj-postgres-1791934775364`. A seleção de homologação do portal é menor que a regressão anterior. O novo teste da composição real confirma ausência de reservas pagas nas três finalidades mesmo com parâmetros tentando habilitar pagamento. Homologação externa, implantação e cofre de ambiente continuam pendentes.

- `consultaCnpjRuntime.js` compõe o serviço persistente e mantém `habilitarPago: false` fixo. Nenhum payload, variável de ambiente ou alteração isolada no orçamento habilita o SERPRO nesta entrega.
- BrasilAPI continua primeiro e Minha Receita vem depois. A alternativa gratuita agora também cobre 404, resposta inválida e cadastro insuficiente. Dados parciais são preservados quando a fonte seguinte falha. Caracteres alfabéticos não são removidos para consultar outro documento numérico.
- Adaptadores Básica e Empresa com modalidade fixa no servidor, credenciais injetadas, token reutilizável, prazo total de quatro segundos e nenhuma retentativa paga automática. Nenhuma credencial real foi configurada. QSA isolada continua fora dos fluxos implementados.
- Migration `20261013210000_consulta_cnpj_cache_orcamento`: cache cifrado, trava por documento/modalidade/escopo e reservas financeiras persistentes. O cache é segregado por empresa autorizada, conta do escritório ou hash do link público. Cada acesso HTTP verifica a autorização antes de ler o cache.
- Cache básico completo por 30 dias e Empresa completa por sete dias; resultados parciais, negativos ou cadastro efetivo ainda sem resposta Empresa têm intervalo de 60 segundos. Expiração impede reutilização, sem apagar o registro automaticamente. Uma concessão de execução de 30 segundos impede chamadas simultâneas; o token da concessão impede gravação tardia por execução antiga.
- O orçamento central da instalação usa o identificador interno `ALTAN`, sem receber esse identificador do navegador. A linha financeira fica travada dentro da transação antes da reserva, com preço vigente por modalidade, teto mensal e chave única de tentativa. Contabiliza valores em micros de real (1 real = 1.000.000 micros), sem ponto flutuante. Mês financeiro em America/Sao_Paulo. Não há entidade de escritório multi-tenant no modelo atual: um futuro produto com vários escritórios precisará vincular explicitamente cada instalação/orçamento à organização.
- Reservas concluídas, reservadas e incertas consomem o teto. Mesmo documento/modalidade/escopo tem intervalo mínimo de um minuto; estado reservado/incerto impede nova cobrança até conferência operacional. A liberação automática de custo incerto não foi implementada. A migration nasce desabilitada, com limite e preços zero.
- Emissor do contador, portal do cliente, lote e assistente consultam o backend. Cadastro inicial e formulário público ficam sempre gratuitos. Cadastro efetivo e conversão têm rota separada para Empresa, também precedida pelas fontes gratuitas e sujeita ao bloqueio pago atual. Campos editados durante a consulta e respostas tardias são preservados/descartados nos formulários.
- Cadastro efetivo pode pré-preencher sócios de retorno Empresa quando a lista estiver vazia, sem inventar participação nem substituir sócios revisados. Documentos mascarados não viram CPF. O formulário de conversão, que só tem campo CPF, deixa o documento de sócio pessoa jurídica para conferência manual; o formulário geral aceita CPF/CNPJ.
- O serviço persistente valida DV antes de banco/rede. Informações societárias são excluídas dos retornos do emissor e do formulário público. Código municipal RFB é convertido pela tabela oficial TOM/IBGE versionada, com confirmação de nome e UF na lista IBGE carregada. Código desconhecido ou divergente mantém endereço parcial. A base de 2023 tem 5.569 relações completas; 5.563 conferem com a lista local de agosto/2026, e seis divergências continuam para conferência manual. Fonte, hash, exclusões e reprodução estão em `apps/api/src/application/tomador/dados/municipios-tom.fonte.md`. Falha de banco/migration ou leitura do cache permite somente a consulta gratuita. Falha ao cifrar/gravar preserva o resultado obtido sem repetir a chamada nem liberar sua reserva; a disponibilidade do cofre deve ser validada antes da futura ativação paga.
- Consumo agregado disponível em `GET /firm/cadastro/consumo-cnpj`, exclusivo do administrador, informando o bloqueio pago no runtime. Não foi criada uma tela de configuração nem um endpoint que habilite cobrança.

Testes desta entrega usam respostas sintéticas, incluindo autenticação. Nenhuma chamada externa faturável ou emissão real integra a validação.

Validação desta entrega: 182 testes de consulta/rotas públicas (reexecutados após conversão municipal), 100 do app do contador e 72 do portal passaram. Ferramentas do assistente e emissão guiada também passaram na execução complementar. Schema Prisma validado, auditoria de migrations aprovada e builds dos dois portais concluídos, com avisos de tamanho de bundle. O PostgreSQL temporário passou 18 verificações reais de concorrência, teto, preços vencidos, virada de mês, isolamento, cifragem, expiração e gravação tardia. Evidência: `.local/cnpj-postgres-1791932994186`. Nenhuma migration foi aplicada em produção ou no banco compartilhado de desenvolvimento.

Registro de regressão anterior: as nove falhas de `emissaoComDadosDoPortal.test.js` foram reproduzidas com a consulta anterior na primeira entrega. A validação desta etapa não representa uma suíte global integralmente verde.

### Rotas integradas

- `POST /client/companies/:companyId/consulta-cnpj` e `POST /firm/companies/:companyId/consulta-cnpj`: emissor, corpo `{ cnpj }`, empresa autorizada na rota, sem seleção de modalidade no corpo.
- `POST /firm/cadastro/consulta-cnpj`: cadastro inicial gratuito, escopo da conta autenticada.
- `POST /firm/cadastro/consulta-cnpj-completa`: cadastro efetivo, política Empresa preparada e bloqueada no runtime.
- `POST /public/onboarding/consulta-cnpj`: valida link ativo antes do cache, token apenas no Authorization, sempre gratuito.

As rotas não emitem notas, não gravam cadastro confirmado e não substituem conferência de dados. O front mantém preenchimento manual quando a consulta está indisponível. A integração do cadastro usa a camada HTTP existente para autenticação; as injeções explícitas `fetchImpl` dos testes legados continuam lendo fixtures no formato do fornecedor.

### Antes de habilitar pagamento

Publicação segue fora desta entrega. Aplicar a migration no ambiente escolhido antes do código com cache; confirmar cofre e permissões, tarifa e condições de retenção, configurar o orçamento e homologar o mapeamento municipal. Uma futura ativação requer substituir a composição explicitamente gratuita do runtime e injetar as credenciais do produto. Alterar só a linha de orçamento não ativa cobrança. Reconciliar reservas incertas com o faturamento antes de qualquer liberação; não apagar reservas para provocar nova consulta.

A ALTAN terá um serviço central de consulta cadastral. No emissor, a consulta gratuita será prioritária e a consulta Básica do SERPRO será a alternativa automática quando as fontes gratuitas não resolverem. No cadastro efetivo de um cliente do escritório, será usada a modalidade Empresa para obter os dados cadastrais e societários necessários. A emissão permanece gratuita para o cliente.

## Decisões de produto

- Emissor: reutilizar cadastro confirmado e resultados recentes; quando houver necessidade de consulta, tentar BrasilAPI, depois Minha Receita e, se ambas não resolverem, SERPRO Básica.
- Executar a busca em segundo plano durante o preenchimento do CNPJ válido, sem exigir que o cliente escolha um fornecedor ou confirme o custo a cada uso.
- Falha da consulta não bloqueia o preenchimento manual. As validações fiscais e os campos obrigatórios da emissão continuam valendo.
- Não consultar por nota, prévia, transmissão, polling, abertura de tela ou renderização. Consultar por necessidade cadastral, após estabilizar o documento digitado.
- Cadastro efetivo de cliente: consulta Empresa uma vez por evento de cadastro, reaproveitando resultado válido existente. Não acionar automaticamente em cada contato comercial ou visita a um formulário público.
- QSA disponível para necessidades específicas de quadro societário/Simples/MEI, sem consulta adicional quando Empresa recente já atender. Emissor nunca faz escalada automática para QSA ou Empresa.
- CPF de sócio retornado pela consulta Empresa serve ao cadastro; não comprova identidade de quem conversa nem concede autorização de acesso.

## Base existente e pontos de integração

O módulo `apps/api/src/application/tomador/consultaCnpj.js` já consulta BrasilAPI e Minha Receita no servidor, com prazo total e resposta de falha controlada. Não tem cache nesse módulo e atualmente restringe os motivos que permitem tentar outra fonte. A implementação deve revisar essa classificação, não apenas acrescentar uma chamada paga ao final do código atual.

Reutilizar os pontos de integração de `prepararTomadorDoCliente.js`, `routes/firm/perfisEmissao.js`, das ferramentas do assistente e dos serviços de onboarding/comercial. Auditar também as consultas diretas no navegador em ambos os portais para que todas passem pela mesma política no backend.

Há um adaptador SERPRO Básica em `altan-suporte-gpt/apps/api/src/application/nfse/rfbCnpjClient.js`. Conferir a versão integrada na branch de implementação antes de reaproveitar. Ele retorna um subconjunto cadastral para finalidade fiscal; precisa de contrato e mapeamento próprios para preencher tomadores e suportar outras modalidades. Não presumir que esteja publicado.

## Política de tentativa

| Resultado | Comportamento |
|---|---|
| Cadastro confirmado suficiente ou cache válido | Reutilizar sem chamada externa |
| Gratuita retorna dados válidos e suficientes | Encerrar; zero chamadas pagas |
| Gratuita indisponível, timeout, limite, erro de rede ou resposta inválida | Tentar próxima gratuita; depois Básica |
| Gratuita não encontra CNPJ válido | Tentar próxima gratuita; depois Básica, pois ausência nessa base não comprova inexistência |
| Resposta gratuita sem campos cadastrais necessários | Preservar campos válidos; tentar próxima fonte para completar |
| CNPJ inválido ou incompleto, ou CPF | Não consultar fornecedores |
| Formato alfanumérico sem suporte homologado no fornecedor | Não remover letras; pular fornecedor incompatível e manter preenchimento manual se necessário |
| SERPRO desabilitado, sem credenciais, sem preço configurado ou sem orçamento | Não executar chamada paga; manter cadastro/manual |
| SERPRO falha ou expira após envio | Registrar resultado incerto quando aplicável; não repetir automaticamente a chamada paga |

Definir suficiência por finalidade: razão social e endereço quando exigido pelo fluxo. Número, complemento, e-mail ou campo que dependa de confirmação do cliente não justificam consultas pagas sucessivas. Divergências entre fontes ou com informação confirmada são apresentadas para revisão, sem sobrescrita silenciosa.

## Arquitetura e persistência

1. Criar um orquestrador cadastral no backend com finalidade explícita: tomador do emissor, cadastro de cliente ou consulta QSA. O servidor decide a modalidade permitida, sem confiar na modalidade enviada pelo navegador.
2. Padronizar retorno: documento, campos normalizados, fonte, modalidade, data da consulta, completude, campos ausentes e motivo de falha. Converter município RFB usando a referência oficial; não presumir que seu código seja IBGE.
3. Persistir cache por escritório, CNPJ e modalidade, com versão do mapeamento e validade. Proposta inicial: dados básicos por 30 dias; societários por 7 dias, ambos configuráveis. Dados expirados podem ser mostrados com data, sem serem apresentados como conferência atual.
4. Reutilizar os campos básicos de consulta Empresa/QSA válida sem expor sócios ao emissor. Não compartilhar payloads privados entre escritórios.
5. Deduplicar chamadas concorrentes com trava/reserva persistente e prazo de execução; cache isolado em memória não é suficiente para múltiplas instâncias. Adotar intervalo mínimo de retentativa por documento/finalidade, inclusive para resultados negativos.
6. Separar cache da consulta, cadastro confirmado e fotografia dos dados usados na nota. Atualização cadastral não altera notas anteriores nem comprova endereço ou regime em competência histórica.
7. Proteger credenciais do produto Consulta CNPJ no servidor, separadas do Integra Contador. Restringir dados societários às permissões do cadastro; não registrar CPF, segredos ou resposta integral em logs.

## Custo e proteção contra repetição

- Configurar preço por modalidade/faixa, vigência do preço, teto mensal do escritório e limites de frequência por usuário/empresa. Confirmar tabela e condições contratuais de armazenamento antes da ativação paga.
- Reservar orçamento atomicamente antes da chamada para impedir ultrapassagem por concorrência. Registrar tentativa, modalidade, finalidade, fonte, custo estimado e resultado, distinguindo cache de acesso externo.
- Preservar reserva conservadora para chamadas com resultado incerto até reconciliação; não considerar todo erro gratuito nem toda tentativa faturada sem conferir a regra contratual.
- Usar limites por usuário e documento e suspensão temporária do fornecedor com falhas persistentes. Indisponibilidade geral das gratuitas não pode consumir todo o orçamento em poucos minutos.
- Painel interno: consultas gratuitas/pagas, percentual resolvido em cache, falhas, gasto estimado por emissor/cadastro e saldo do teto. Reconciliar estimativas com faturamento do SERPRO.
- Modelo de dimensionamento: básicas efetivamente chamadas × tarifa básica + QSA × tarifa QSA + Empresa × tarifa Empresa, aplicando as faixas e condições contratadas. Não multiplicar diretamente pelo número de notas.

## Experiência no emissor

Ao informar CNPJ válido, iniciar consulta assíncrona com debounce e identificador da solicitação. Mostrar apenas estado discreto de busca. Preencher campos vazios e preservar campos editados ou confirmados pelo usuário. Ao trocar documento, empresa ou fechar o formulário, descartar resultados tardios; cancelamento da interface não garante cancelamento de uma chamada já faturável.

Se todas as fontes falharem, mostrar mensagem breve permitindo preenchimento manual. A emissão não precisa esperar a consulta quando os dados obrigatórios já estiverem completos e válidos. Nenhum retorno altera uma DPS cuja preparação/transmissão já começou.

O acionamento pago ocorre em segundo plano como parte da consulta solicitada no cadastro, sem criar agenda periódica, varredura da carteira ou atualização paga ao iniciar o servidor.

## Etapas de entrega

1. **Contrato e inventário:** confirmar três modalidades, campos, formatos aceitos, preços, cobrança de erros e condições de retenção; mapear todos os chamadores e definir limites configuráveis. Aceite: matriz de campos e motivos de fallback revisada.
2. **Serviço central:** implementar adaptadores, normalização, cache persistente, isolamento, deduplicação, reserva de custo e registro de consumo. Aceite: consulta paga só ocorre sob a política e orçamento definidos.
3. **Emissor:** integrar portal do cliente, contador e assistente à mesma política gratuita → gratuita alternativa → Básica, com preservação de edições. Aceite: gratuidade válida impede chamada paga e falha total permite preenchimento manual.
4. **Cadastro:** integrar Empresa ao evento de cadastro efetivo, revisão dos dados e reaproveitamento. Manter QSA para ação específica. Aceite: cadastro duplicado/retomado não gera nova cobrança indevida e dados societários não aparecem no emissor.
5. **Piloto e ativação:** iniciar com testes simulados e feature flags separadas por finalidade; depois ativar em escopo restrito com credenciais, preços e orçamento configurados. Observar consumo, latência e taxa de fallback antes de ampliar. Desativar SERPRO deve preservar fontes gratuitas e cadastros salvos.

Dependências da ativação: contratação/credenciais válidas do produto, tarifa vigente e teto financeiro definido. A implementação local pode avançar com fornecedores simulados. Este plano não autoriza contratação, consulta paga de teste, emissão real ou publicação.

## Validação e critérios de aceite

- Gratuita suficiente: nenhuma chamada SERPRO. Falhas e 404 das gratuitas: uma única tentativa Básica elegível.
- Cache válido, consulta Empresa recente e pedidos concorrentes: não duplicar custo; deduplicação exercitada com banco e múltiplos solicitantes.
- Teto esgotado, preço ausente, credencial ausente ou finalidade sem permissão: zero chamadas pagas.
- Timeout pago após envio: marcar incerteza e não repetir no polling, retry de transporte ou reabertura imediata.
- Resposta de outro CNPJ, corpo inválido, município incompatível, CNPJ alfanumérico e zeros iniciais: validar sem corromper o documento ou preencher empresa errada.
- Troca de documento/empresa, resposta tardia e edição durante busca: preservar o formulário correto.
- Falha de todas as fontes: cadastro manual e validação normal da emissão continuam disponíveis.
- Regressão no portal do cliente, contador e WhatsApp; isolamento entre escritórios, permissões de sócios e sanitização de logs.
- Testes automatizados com respostas sintéticas, sem credenciais reais, chamadas faturáveis ou emissão de notas.

## Referências

- [Descrição oficial das modalidades e cobrança](https://www.gov.br/pt-br/servicos/obter-solucao-de-consulta-de-dados-do-cadastro-nacional-de-pessoas-juridicas-cnpj), conferida em 13/10/2026.
- [Documentação técnica SERPRO Consulta CNPJ](https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cnpj/pt/).
- [Plano do emissor](plano-nfse-2026-10-05.md).
