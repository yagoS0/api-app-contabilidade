# WhatsApp — Entrega 1 (envio de guias pelo canal)

> **Estado: PAUSADO em 05/08/2026, aguardando número para o cadastro na Meta.**
> F1 e F2 estão prontas e commitadas na `dev`. F3 a F6 não foram iniciadas — elas dependem de
> credenciais reais, e escrever integração externa sem poder exercê-la é o que a regra 1 do projeto
> proíbe.

Documentos de origem: `MANUAL_CADASTRO_WHATSAPP_API.md` (cadastro na Meta) e
`PLANO_CONVERSAS_WHATSAPP.md` (plano do módulo). A Entrega 1 é só o **envio de guias**; a tela de
conversa é a Entrega 2.

---

## Por que parou aqui

O plano previa construir e **verificar** contra o número de teste da Meta (Etapa 2 do manual, que
não exige a verificação do CNPJ). Sem número disponível, F3–F6 seriam escritas contra a documentação
sem nenhuma forma de exercê-las — e o histórico deste projeto mostra o custo disso: o
`CONSDECCOMPLETA33` do Lucro Presumido está OFF até hoje exatamente por ser `verificadoTrial: false`.

Parar com F1/F2 fechadas é o corte limpo: as duas **não dependem da Meta** e são úteis sozinhas.

## O que está pronto (commitado na `dev`)

| Commit | O quê |
|---|---|
| `ed859bc3` | **F1** — `ContatoWhatsapp`, `PortalClient.canalPadraoEnvio`, normalização E.164, rotas de contato e a rota da importação assistida |
| `6708319b` | **F2** — `EnvioGuia` (guia × canal) vira a fonte da verdade do envio; chip e `guideCompliance` leem dela; backfill |
| `cce54572` | Tolerância do legado — elimina a janela entre o deploy e o backfill |

### ⚠ Deploy: é seguro, e não bloqueia outras entregas

`dev` → `main` é fast-forward, então **qualquer deploy futuro leva F1 e F2 junto**. Isso é seguro por
construção:

- **F1 é inerte**: tabelas novas, rotas que ninguém chama ainda, e uma coluna com default.
- **F2 preserva o comportamento**: o chip passa a ler `envios_guia`, mas `foiEnviadaComLegado` faz
  guia sem envio registrado continuar valendo por `emailStatus: SENT`. A tela não muda.

**Depois de subir, rodar o backfill** (deixa de ser corrida por causa da tolerância, mas continua
sendo o certo):

```bash
cd /app/apps/api && node scripts/backfill-envio-guia.mjs            # dry-run
cd /app/apps/api && node scripts/backfill-envio-guia.mjs --aplicar
```

## F1.5 — o VÍNCULO número → empresa (→ pessoa). Verificável sem a Meta

> Feito **antes** da retomada de propósito: é o pedaço que, deixado para depois, contamina todo o
> resto. Toda mensagem que chegar pelo canal precisa responder *"de quem é esta mensagem, e sobre
> qual empresa ela fala?"* — e essa resposta não pode ser adivinhada. Zero credencial, zero rede.

**Reusou a F1 inteira em vez de criar tabela nova:** `contatos_whatsapp` já é a tabela certa
(`portalClientId` + `telefoneE164` + `waId`, unique `(portalClientId, telefoneE164)` — que já
permitia o mesmo número em várias empresas) e `telefone.js` já tinha a normalização E.164. A única
coluna nova é o ponteiro para a PESSOA.

| arquivo | papel |
|---|---|
| `application/whatsapp/vinculoTelefone.js` | **a REGRA, pura** — sem prisma, mesma disciplina de `fechamentoBlockers.js` / `divergenciaDeFonte.js` |
| `application/whatsapp/ContatoWhatsappService.js` | a ligação com o banco (`resolverVinculoPorTelefone`, `SELECT_CONTATO_PARA_VINCULO`) |
| `prisma/migrations/20260814160000_add_contato_whatsapp_usuario/` | ⚠ **escrita, NÃO aplicada** — aditiva, nullable, sem backfill |
| `scripts/diag-vinculo-whatsapp.mjs` | só leitura, zero chamada externa. **Não foi rodado** (não há banco alcançável nesta máquina) |

Testes: `whatsapp/__tests__/vinculoTelefone.test.js` (22) e `vinculoContatoService.test.js` (13).

### ⚠ Dois furos de multi-tenancy da F1, fechados de passagem

Os dois estavam nas rotas de contato e valiam para o mesmo alvo — o cadastro em que o vínculo se
apoia. Nenhum tinha teste.

| onde | o que era | hoje |
|---|---|---|
| `salvarContato({id})` e `removerContato(id)` | o alvo era escolhido **só pelo id**: um contato de OUTRA empresa era editado/apagado dentro do acesso do chamador | `portalClientId` viaja no `where` das duas (`removerContato` mudou de assinatura: `(portalClientId, id)`) |
| `POST /companies/:companyId/contatos-whatsapp` | `{ portalClientId: path, ...body }` — um `portalClientId` no **corpo** sobrescrevia o do path | o spread vem **antes**; o path é a última palavra |

### As quatro respostas, cada uma com nome próprio

`SITUACOES` = `TELEFONE_INVALIDO` · `DESCONHECIDO` · `AMBIGUO` · `VINCULADO`.

- ⚠ **`DESCONHECIDO` não vira empresa nenhuma.** Não se casa por CNPJ solto, por nome, por
  semelhança, nem por "só existe uma empresa com esse DDD". E ele **não** é o mesmo que
  `TELEFONE_INVALIDO`: ali o número existe e ninguém o cadastrou, aqui não há número — colapsá-los
  faria lixo digitado parecer cliente novo.
- ⚠ **`AMBIGUO` tem DUAS naturezas, e as duas viajam em `ambiguidades[]`.** `EMPRESA` (o sócio com
  três CNPJs; o escritório) e `PESSOA` (dentro da MESMA empresa, o número casou com mais de um
  contato — possível quando as duas formas do nono dígito estão cadastradas em nomes diferentes).
  A lista de empresas sobe junto, para o canal **perguntar** de qual se trata.
- **Nada some em silêncio:** contato inativo deixa de identificar e sai em `descartados[]` com o
  motivo. Contato **sem opt-in continua identificando** — opt-in é exigência para MANDAR template,
  não para RECONHECER quem mandou; filtrar por ele faria mensagem de contato conhecido virar
  "desconhecida" e cair em não-vinculados sem motivo aparente.

### ⚠ VÍNCULO NÃO É AUTORIZAÇÃO

Reconhecer o número diz QUEM é; não diz o que a pessoa pode fazer. O vínculo **devolve o papel e
para aí** (`papelRbac`, lido de `CompanyClientUser.role`): não há peso, não há comparação, não há
`podeEmitir`. Quem decide continua sendo `requireClientCompanyAccess(minRole)` —
FINANCEIRO=1 < CLIENT_ADMIN=2 < OWNER=3. Uma segunda cópia da permissão é sempre a que diverge.

- **`contatos_whatsapp.userId`** (nullable) é o único caminho até esse papel. ⚠ O campo `papel` que
  já existia é **rótulo de tela** (texto livre: "financeiro", "sócio") e sobe como `rotulo` —
  deixá-lo passar por papel do RBAC faria um rótulo digitado virar permissão.
- **Sem `userId` o vínculo identifica a EMPRESA e diz, nomeadamente, que não identifica pessoa**
  (`MOTIVOS_SEM_PAPEL.SEM_USUARIO`). Casar `nome` com o nome do usuário seria a adivinhação que o
  módulo existe para não fazer. Nulo é caso NORMAL: financeiro terceirizado, sócio sem login.
- `salvarContato` **recusa** `userId` de quem não é membro ativo da empresa
  (`USUARIO_SEM_VINCULO`, 400) — senão o cadastro de contato criaria um vínculo que o RBAC nunca
  concedeu.

### ⚠ O NÚMERO É O DO CADASTRO — decisão do dono, 14/08/2026

> *"os números são sempre com um nove na frente a partir de agora, mas você nunca deve pressupor o
> número, o número de comunicação com o cliente será o do cadastro"*

A comparação é **dígito a dígito** com `contatos_whatsapp`. `LEITURAS.ESTRITA` deixou de ser um
padrão e virou **a regra**; `LEITURAS.NONO_DIGITO` continua sendo calculada, mas **só como
diagnóstico**.

| leitura | papel dela hoje |
|---|---|
| **ESTRITA** | **a resposta**, sempre. O custo aceito: mensagem vinda da outra forma cai em "não vinculado" — e aí o conserto é o CADASTRO, não a comparação |
| **NONO_DIGITO** | ⚠ nunca responde. `variantesE164` acrescenta o 9 a **qualquer** número de 8 dígitos, inclusive a um FIXO: `552133334444` gera `5521933334444`, que pode ser o celular de outra empresa — e a nota sairia no CNPJ errado |

⚠ **A TOLERÂNCIA NÃO É PARÂMETRO.** `opcoes.tolerancia` foi **retirada da assinatura** de
`resolverVinculoTelefone` e de `resolverVinculoPorTelefone`. Enquanto existia, bastava um chamador
futuro passar `NONO_DIGITO` para violar a regra em silêncio — e o violador nem saberia que havia
regra. Não é padrão: é que **não existe caminho** para a leitura tolerante virar a resposta.
Experimento executado: trocando a resposta para ela, o contrato fica **5 vermelhos**; restaurado,
**55 verdes**.

⚠ **`divergemPeloNonoDigito` MUDOU DE SIGNIFICADO.** Não é mais "talvez devêssemos tolerar"; é
**"este cadastro está no formato antigo — conserte o cadastro"**. Quem escrever o webhook lê o
sinal, avisa o contador, e **não casa**.

⚠ **`acharContatoPorWaId` seguia o critério antigo e foi corrigida junto.** Ela era pior que a
tolerância: um `findFirst` sem `orderBy` e sem escopo escolhia **um** contato entre os que
casassem — possivelmente de outra empresa — e devolvia como se não houvesse dúvida. Quem responde
"de quem é esta mensagem?" é **`resolverVinculoPorTelefone`**, que sabe dizer `AMBIGUO` e
`DESCONHECIDO`.

Medido em produção (14/08/2026): **`contatos_whatsapp` tem 0 registros** — a F1 subiu sem tela e
ninguém nunca cadastrou um número, então **não há cadastro retroativo no formato antigo**.
`scripts/diag-vinculo-whatsapp.mjs` (só leitura) mede quando houver; hoje ele **para antes**, porque
a migration `20260814160000` não foi aplicada.

### ⚠ A busca é SEM escopo de tenant — e isso é o oposto de furar a multi-tenancy

Não existe `portalClientId` para filtrar **antes**: a pergunta da função **é** "de qual tenant se
trata?". A resposta é o que **produz** o escopo, e todo consumidor tem de usá-la como escopo dali em
diante — nunca como permissão. A query lança a rede **larga** (as duas formas); quem estreita é a
regra, que casa dígito a dígito com o cadastro. Isso **não afrouxa** a decisão do dono — é o que a
torna verificável: fosse a query a estreitar, a leitura alternativa ficaria invisível e
`divergemPeloNonoDigito` nunca poderia acender para apontar o cadastro no formato antigo.

### O que NÃO foi feito, e por quê

- **Nada de Cloud API, webhook, envio, parser, LLM ou emissão** — F3–F6 seguem paradas por falta de
  credencial, e escrever o que não se pode exercer é o que a regra 1 proíbe.
- **Nenhuma rota nova.** O vínculo é exercido por teste e pelo script de diagnóstico; expor uma rota
  de resolução antes de existir consumidor seria mais superfície inerte.
- **Nenhuma tela.** ⚠ E isto é uma pendência conhecida: **a F1 subiu sem tela nenhuma** — não há um
  único chamador de `/contatos-whatsapp` em `apps/web`. Hoje o vínculo só é criável pela API.

## O que falta (F3 a F6)

Tudo abaixo precisa de credenciais reais para ser verificado:

- **F3 — Cloud API**: `WhatsappClient`, template `guia_disponivel` com header de documento (o PDF sai
  de `getGuidePdfBuffer`), tabela de tradução dos erros da Meta, flag `INTEGRACAO_WHATSAPP` OFF.
- **F4 — Webhook**: router público em `/webhooks` (fora dos autenticados — `requireAuth` neste
  projeto é por router), `X-Hub-Signature-256`, 200 em <5s, idempotência por `wamid`.
- **F5 — Envio individual e em lote**: escolha de canal no chip, painel de revisão, fila com
  throttling no molde do `guideEmailWorker.js`.
- **F6 — Recebimento mínimo**: badge de respostas, lista por empresa, fila de não vinculados.

### Para retomar, o que é preciso

1. Número dedicado **não ativo em nenhum WhatsApp** (chip novo é o caminho limpo).
2. App na Meta com o produto WhatsApp → dá **número de teste gratuito + 5 destinatários**, sem
   custo e **sem exigir a verificação do CNPJ**.
3. Credenciais: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
4. **Submeter `guia_disponivel` com header de documento** — é o que permite anexar o PDF. Sem o
   header o template só manda texto, e a Entrega 1 perde o sentido. Categoria Utility, pt_BR.

---

## Decisões tomadas (para não serem re-discutidas na retomada)

**Canal na guia = tabela, não campo.** `Guide.emailStatus` era o estado de envio: dele saíam o chip,
o selo "Guias concluídas" e a barra de progresso. Um campo só não representa "enviada por WhatsApp e
ainda não por e-mail", e o plano oferece "Ambos". `envios_guia` tem um registro por canal, e a
unique `(guideId, canal)` é o que torna reexecutar o lote inofensivo.

**Enviada = terminal em QUALQUER canal.** E-mail falhou e WhatsApp entregou? A guia chegou — cobrar
o segundo canal transformaria uma escolha de conveniência em pendência.

**Opt-in é bloqueio, não aviso.** Sem `optInEm`, a empresa não recebe template. É política da Meta e
é o que protege o número de denúncia por spam — e número derrubado tira o canal de **todos** os
clientes de uma vez.

**Cloud API direta, sem BSP.** O backend teria que existir de qualquer forma; o BSP só somaria custo
e uma camada intermediária.

## Armadilhas já mapeadas (não redescobrir)

**O nono dígito.** `wa_id` da Meta nem sempre bate dígito a dígito com o cadastrado: contato salvo
como `5521999998888` pode chegar como `552199998888`. Comparar strings cruas faz a mensagem recebida
não achar o contato e cair em "não vinculados" sem motivo aparente. `variantesE164` busca as duas
formas — usar **sempre** ela no webhook.

**O `+` é o único desambiguador.** `14155552671` (EUA com DDI) tem 11 dígitos — o mesmo formato de
celular brasileiro sem DDI. Nenhuma regra de comprimento separa os dois.

**Destino vem do ENVIO, não do cadastro.** São coisas diferentes: o cadastro diz para onde
mandaríamos hoje, o envio diz para onde **foi**. A primeira versão mostrava "enviada por WhatsApp
para fulano@email.com", e o contador procuraria a mensagem no lugar errado.

**Status nunca rebaixa.** A Meta entrega eventos fora de ordem; um `delivered` atrasado chegando
depois do `read` apagaria o ✓✓ que o contador já viu. `aplicarStatusDoProvedor` compara por peso.

**O webhook será a única rota pública do sistema.** `requireAuth` é aplicado por router
(`firm/index.js`), então não há auth global para furar — a assinatura passa a ser a única defesa.

## Arquivos

| Arquivo | Papel |
|---|---|
| `apps/api/src/application/whatsapp/telefone.js` | E.164, variantes do nono dígito, formatação |
| `apps/api/src/application/whatsapp/ContatoWhatsappService.js` | contatos, opt-in, decisão de canal |
| `apps/api/src/application/guides/EnvioGuiaService.js` | estado de envio por canal (é o núcleo da F2) |
| `apps/api/scripts/backfill-envio-guia.mjs` | converte o histórico de e-mail; dry-run por padrão |
| `apps/api/src/application/guides/guideCompliance.js` | passou a ler `envios_guia` |
| `apps/web/src/features/companies/list/components/renderGuiaChip.jsx` | popover com canal, destino e ✓✓ |

Testes: `whatsapp/__tests__/` (telefone, destinatário) e `guides/__tests__/envioGuia.test.js`.
