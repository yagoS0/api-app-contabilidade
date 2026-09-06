# Central de comunicação — retomada em 06/09/2026

## Entrega local

F1, F2 e F3 já estavam em dev/main no commit `7e24d504`. Esta retomada implementou F5 e F4, sem migrations, e incluiu revisão de três agentes e conferência no navegador em modo demonstração. F5 e F4 foram organizadas em commits separados. O estado dos workflows e do deploy deve ser verificado no GitHub; os testes locais abaixo não comprovam publicação em produção.

### F5 — resumo e atualização automática

`GET /firm/whatsapp/resumo` usa a carteira de `empresasVisiveis` e a fila sem empresa, com acesso admin/contador. A agregação parametrizada compara a data da mensagem recebida com a marca de leitura de cada conversa, sem o limite da listagem. A home mostra mensagens não lidas na gaveta e um ponto no botão fechado. Falha ou resposta inválida remove o selo e informa que não foi possível ler; nunca vira zero.

A caixa e o chat da empresa atualizam a cada 8 segundos com fio aberto e 30 segundos ociosos; a home consulta o resumo a cada 30 segundos. As consultas periódicas param com a aba oculta e retomam ao voltar. Respostas atrasadas não substituem outro contato, empresa ou filtro. A conversa selecionada permanece estável quando a lista muda de ordem, e o rascunho não passa para outro contato. Falhas ao abrir o fio permitem nova tentativa.

A marca de leitura é capturada antes da busca das mensagens e atualizada apenas se avançar: uma leitura lenta não faz a data retroceder nem consome mensagens recebidas depois do início da busca.

### F4 — interessado vira rascunho de onboarding

Na conversa sem empresa, o contador escolhe explicitamente Abertura, Transferência ou Empresa inativa. A criação exige evidência de mensagem recebida, inclusive quando ela ficou fora da página truncada. O rascunho recebe nome do perfil e telefone E.164 da conversa, usando os contratos POST/PATCH existentes. O fluxo abre a ficha para completar os campos; não converte a empresa automaticamente.

O cruzamento com onboardings existentes informa correspondência exata, possível diferença pelo nono dígito ou ambiguidade. O casamento aproximado mantém DDI e DDD e só considera celulares brasileiros. Falha ao consultar os cadastros bloqueia a criação, e uma nova leitura ocorre antes do POST.

Falha no preenchimento preserva o id criado. Antes de repetir o PATCH, o fluxo relê o rascunho e abre uma ficha já preenchida, evitando sobrescrever seus dados. Se a resposta do POST se perder, uma nova criação automática é bloqueada e o usuário recebe acesso à lista para conferir os rascunhos.

WhatsApp e onboarding não usam fallback de API real para mock: falhas reais continuam visíveis. No modo demonstração, os rascunhos persistem em sessionStorage para sobreviver à navegação até a ficha.

## Revisão multiagente concluída

- API: escopo da carteira, SQL parametrizado, tratamento de falhas e marca de leitura. Corrigida a regressão da marca por leituras concorrentes.
- Frontend: polling, respostas atrasadas, troca de empresa/filtro, StrictMode, seleção do contato e recuperação de falha. Corrigidas as trocas indevidas de fio e os resultados de contexto antigo.
- Onboarding: contrato POST/PATCH, normalização de telefone, rascunhos existentes, falhas parciais e histórico truncado. Corrigidos o preenchimento e os caminhos de repetição após falhas.

Os agentes fizeram revisão independente e testes locais; isso não equivale a validação em produção.

## Evidências de funcionamento

- Frontend completo: **219 suítes, 3.697 testes aprovados**.
- API, regressão WhatsApp e onboarding: **21 suítes, 428 testes aprovados**.
- Build web: **476 módulos**, concluído; avisos de tamanho de chunks e imports mistos permanecem.
- Navegador em mock: home com selo, home com falha sem selo, caixa global, abertura da empresa, notas e chat em duas colunas, largura de 900 px com chat abaixo das notas, mensagem levada ao campo da anotação, seleção de outro fio, documento desabilitado fora da janela e guia disponível.
- Navegador em mock: interessado criou rascunho ABERTURA, abriu a ficha após navegação completa e manteve nome Carlos e telefone +5511977776666 preenchidos. Nenhuma mensagem real foi enviada.

Comandos usados a partir de cada app, com o Node instalado no runtime local:

```text
# apps/web
node ../../node_modules/jest/bin/jest.js --maxWorkers=2
node --input-type=module -e 'import { build } from "vite"; import config from "./vite.config.js"; await build({ ...config, configFile: false });'

# apps/api
node ../../node_modules/jest/bin/jest.js --runInBand --testPathPatterns='whatsapp|onboarding'
```

Após a liberação do ambiente, `npm run build -w @contabilidade/web` também passou pelo CLI padrão. O comando alternativo acima foi usado na primeira sessão, quando havia restrições de acesso. A F5 isolada em worktree passou em 136 testes de WhatsApp e no build (474 módulos); a versão com F4 passou no build com 476 módulos.

### Experimentos de guarda, todos restaurados

- Remover o escopo da agregação: 2 testes falharam.
- Tratar resumo inválido como zero: 3 testes falharam.
- Trocar atualização monotônica de leitura por atualização incondicional: 1 teste de leitura concorrente falhou.
- Introduzir chamada direta de template em uma rota firm temporária: o scanner falhou; após remover o experimento, passou. A regra atual proíbe chamadas diretas aos métodos de template nessas rotas; a futura reabertura deve revisar essa guarda e provar a origem do destinatário. Ela não é uma análise completa de todos os possíveis caminhos indiretos de envio.

## Limites e próximos passos

1. A consulta real passou em **12 cenários com PostgreSQL 15.2 e Prisma**, em cluster descartável local: carteira vazia, outro tenant, fila, mensagens de saída, precisão de leitura, 255 conversas e parâmetros com sintaxe SQL. Script: `apps/api/scripts/verify-whatsapp-summary-postgres.js`. Foram usadas tabelas temporárias com nomes, tipos e índices equivalentes aos campos consultados; não foram aplicadas as migrações completas nem acessada produção. O cluster foi encerrado após o teste.
2. O contrato existente cria um rascunho vazio e depois preenche os dados. As guardas do frontend reduzem duplicação em tentativas sequenciais, mas **não garantem unicidade entre dois atendentes criando simultaneamente**. Garantia completa exige idempotência/controle de concorrência no backend.
3. O onboarding já não tem isolamento por escritório antes da conversão no modelo existente; esta fase reutiliza esse contrato e não modifica esse limite.
4. O bloqueio inicial de escrita no Git foi resolvido na continuação. F5 foi separada, validada em worktree e integrada localmente em main antes da preparação do commit F4.
5. **F6 permanece pendente**: o plano a coloca depois do uso do chat e exige decisão de retenção dos arquivos recebidos. Nenhum prazo foi presumido, nenhuma coluna de mídia foi criada.
6. A leitura das métricas de produção previstas no plano só cabe depois de um deploy. Não foi realizada nesta sessão. O agregado F5 cobre conversas e mensagens não lidas; a medição semanal de mídia não foi adicionada.

Para demonstrar falha do resumo no mock, abrir `/companies?mockWhatsappResumo=falha` ou definir `localStorage['mock:whatsapp:falhaResumo'] = '1'`. Rascunhos de demonstração usam a chave `mock:onboardings:v1` de sessionStorage.

## Desbloqueio de CI na integração

A revisão independente confirmou dois erros anteriores a F4/F5: Prisma validate falhava
por DATABASE_URL ausente, e o workflow de deploy usava secrets diretamente em `if`.
A validação estática recebe agora uma URL fictícia local somente naquele passo; ela não
conecta ao banco. O deploy testa um booleano em env e continua usando o secret real no
passo de migration status. Nenhuma credencial ou configuração remota foi criada.

A auditoria de migrations reconhece agora o caminho exato de
`20260902140000_drop_declarado_previsto_no_fluxo`, cuja remoção já tinha decisão do dono
registrada no SQL e no histórico. O arquivo SQL e as regras gerais da auditoria não
foram alterados. Experimento com DROP COLUMN em caminho não autorizado continuou
falhando. Prisma validate, auditoria e actionlint dos dois workflows passaram localmente.

O gate de migration status continua opcional quando DATABASE_URL não está configurado,
conforme o contrato anterior do workflow. Aprovação do CI não comprova a disponibilidade
de secrets DigitalOcean nem a conclusão do deploy; esses resultados são conferidos à parte.
