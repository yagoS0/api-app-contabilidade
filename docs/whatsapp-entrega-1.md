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
