# CLAUDE.md — Onboarding (funil pré-cadastro)

O que acontece **antes** de a empresa existir na carteira.

## Por que existe

Hoje um cliente novo entra por um único ato: `POST /firm/companies` — **tudo-ou-nada**. Exige CNPJ
válido, razão social, regime, CNAE, endereço completo, e-mail e senha do dono numa só requisição, e
cria seis registros numa transação. Isso serve a quem já tem tudo em mãos e **não serve** ao que
vem antes: a empresa que ainda vai abrir (não tem CNPJ), a que está trocando de contador (a
papelada chega em partes), a que está parada (é preciso decidir se reativa ou dá baixa).

Essa fase vivia fora do sistema, em WhatsApp e planilha, e o que se perdia era o **rastro**: por que
o cliente veio, o que declarou, o que já foi conferido, o que falta.

## Fase 1 = só o lado do escritório

O contador preenche o wizard numa tela interna. **O link público com token de uso único é Fase 2** —
ver "Fora do escopo", abaixo, para o que ele exige e por que não é reuso do que já existe.

## As duas portas para o MESMO ato

`POST /firm/companies` (botão "Nova empresa") e `POST /firm/onboardings/:id/convert` chamam o mesmo
`application/companies/CompanyProvisioningService.js`. **Duas cópias divergiriam em silêncio** — a
segunda esqueceria o `CompanyFirmAccess`, ou o plano de contas global, ou a `Client` legada, e a
empresa nasceria pela metade.

A rede que garante isso é `routes/firm/__tests__/companyProvisioning.caracterizacao.test.js`,
escrito contra o comportamento ANTERIOR à extração e rodado sem edição depois dela. **Precisar
editá-lo é sinal de mudança de contrato, não de refator.**

## A spec é DADO, não JSX

`lib/onboardingSpec.js` — um **array plano** de descritores, não três árvores por origem: nome,
e-mail e telefone do responsável são as mesmas três perguntas nas três origens, e em três árvores é
exatamente onde elas divergem.

Os seletores moram no mesmo arquivo (`camposDoPasso`, `passosVisiveis`, `rascunhoVazio`,
`podarInvisiveis`, `problemasDoPasso`) — é o que impede a tela de reimplementar a regra. O wizard e
a ficha de leitura do escritório percorrem **a mesma spec**, e por isso não têm como discordar sobre
o que foi perguntado.

`lib/onboardingZod.js` **deriva** o schema da spec. `obrigatorio` está escrito uma vez, no
descritor.

### ⚠ Mora em `apps/web`, não em `packages/shared`

O `Dockerfile` da raiz **não copia `packages/`** e o `railway.toml` não observa `packages/**`. Um
import de `@contabilidade/shared` no backend passa em dev, passa nos testes e **morre no boot em
produção**. O arquivo é escrito sem nenhuma dependência além de `zod` (mesma versão nos dois
workspaces): migrar na Fase 2 custa um `git mv` mais o commit do Dockerfile.

## Armadilhas (todas custaram um ciclo em algum lugar do projeto)

1. **`podarInvisiveis` não é enfeite.** Escolher LTDA, preencher dois sócios, voltar e trocar para
   MEI deixa os sócios em `dados`; eles sobrevivem ao PATCH e a ficha do escritório mostra quadro
   societário de um MEI. Chamar **antes de todo salvamento e de toda validação**.
2. **Trocar de origem zera `dados` NO SERVIDOR**, ignorando o body. Se só a UI resetasse, um PATCH
   atrasado ou um retry regravaria campos da origem antiga.
3. **`dados` é SUBSTITUÍDO, nunca mesclado.** Merge raso não deixa limpar lista; merge profundo não
   deixa remover um sócio.
4. **`companyId` da criação é o `PortalClient.id`**, não o `Company.id` legado. Guardar como
   `portalClientId` e nunca chamar de `companyId` — o certificado A1 mora na legada, mas a ROTA é
   indexada pelo portal.
5. **`MEI` e `OUTRO` passam no Zod e morrem depois.** `companyCreateSchema` os aceita;
   `validateAndNormalizeCompanyProfile` só admite `SIMPLES|LUCRO_PRESUMIDO|LUCRO_REAL`. O
   `tipoEmpresa: "MEI"` do wizard é **tipo societário**, não regime — por isso o `ConversaoModal`
   força um dos três.
6. **A conversão exige endereço COMPLETO e `cnaePrincipal`**, e a ficha não coleta nenhum dos dois.
   O modal consulta a Receita de novo por isso, não por preciosismo.
7. **`requireFirmCompanyAccess` daria 400 em toda rota do funil** (`company_id_required`) — aqui
   não existe empresa. O gate extra é o helper local `somenteAdminOuContador`.
8. **`PortalClient.cnpj` é `@unique` NOT NULL** — não existe empresa provisória. Daí o pré-check e o
   `{ vincularPortalClientId }`, que fecha o buraco "empresa criada mas o update da ficha falhou".
9. **`pathToPageName` cai em `companies` em silêncio.** Faltando uma das quatro peças de
   roteamento, a página fica inalcançável sem erro nenhum. Coberto por
   `app/hooks/__tests__/rotasOnboarding.test.js`.
10. **`setPage` precisa de ramo próprio** para rota com id — o mapa `PAGE_TO_PATH` só traduz caminho
    fixo (é por isso que `companyDetail` está `null` lá).
11. **SITFIS, A1 e documentos exigem `PortalClient`** — toda etapa com efeito colateral é
    pós-conversão. O botão fica desabilitado com o motivo no `title`.
12. **`título`/`descricao` da etapa são CÓPIA do template**, não leitura viva: editar o catálogo não
    pode reescrever a checklist de quem já está em trilha.
13. **`finalizar` duas vezes não pode duplicar a checklist** — unique `(onboardingId, chave)` +
    `skipDuplicates`. O **mock implementa isso de verdade**; sem ele o único caminho que exercita a
    regra ficaria offline.
14. **Não testar conversão em `real_with_mock_fallback`**: o Proxy de `api/client.js` cai no mock em
    qualquer throw, e um 409 legítimo (CNPJ já na carteira) vira sucesso falso.
15. **`aplicarRegrasAEmpresaNova` é best-effort e engole a exceção** — a tela mostra
    `regrasAplicadas` do retorno, não presume que rodou.

## UX — o que os tokens significam aqui

- **Acento de CATEGORIA por origem**, reusado no crachá do quadro: `ABERTURA → --accent-cyan` ·
  `TRANSFERENCIA → --accent-orange` · `INATIVA → --accent-purple`.
- ⚠ **Nada de `${cor}22`** para fundo: concatenar hex numa `var()` produz cor inválida que o browser
  descarta em silêncio. A seleção usa borda + régua de 3px + `--bg-subtle`.
- **Status** (`lib/onboardingStatus.js`, com teste): `RECEBIDO` é o único que grita
  (`--state-warn` — "alguém precisa pegar"); `EM_TRILHA` é neutro porque é o estado majoritário, e
  colorir o normal faz o RECEBIDO parar de se destacar; `DESISTIU` é `--state-closed`, **não**
  danger — desistência não é erro. **Ícone além da cor em todos.**
- **Nenhum estado usa `--state-danger`**: nada aqui bloqueia fechamento contábil.
- **Larguras:** wizard e detalhe em `--content-max` (leitura/formulário); lista/quadro em
  `--content-wide` (tela de dados).
- **Selo do dado declarado:** o texto muda com `origemPreenchimento`. "declarado pelo cliente" **só**
  quando `=== "CLIENTE"`; na Fase 1 lê "declarado no atendimento", senão o selo mentiria sobre um
  dado que o próprio contador digitou.
- **Cartão da BrasilAPI:** o caminho de falha é **requisito**, não polimento — a chamada sai do
  browser, sem proxy, e cai com rede corporativa, bloqueador ou offline. A escapatória manual existe
  **também no sucesso**, senão uma consulta bem-sucedida do CNPJ errado tranca o usuário em campos
  somente-leitura.
- **Botão primário nunca é verde.** Verde é concluído.

## Escopo multi-tenant

**Fase 1 não tem isolamento**: todo usuário FIRM vê todos os onboardings. Está escrito no cabeçalho
de `routes/firm/onboardings.js` e do `OnboardingService`. O motivo é estrutural — as demais rotas se
escopam por `empresasVisiveis(req)`, que lê `CompanyFirmAccess`, um vínculo que só existe depois de
a empresa ser criada.

## Fora do escopo da Fase 1 (explicitamente)

Link público · `inviteToken` de uso único · rate limit · `helmet` · `express.json({ limit })`.
Quando isso entrar: `express.json()` está sem limite (100kb default), `express-rate-limit` só está
aplicado em `/auth`, e o único token opaco do projeto (`ClientSession.refreshTokenHash`) usa
rotação-sobrescreve e **não tem campo de consumo** — uso único exige `consumidoEm`, ou seja **modelo
novo, não reuso**.

Também fora: e-mail/WhatsApp de notificação · auto-conclusão de etapa por fato observado · upload de
documento **antes** da conversão (impossível hoje: os três efeitos colaterais exigem `PortalClient`)
· edição depois de convertido · arrastar cards no quadro · migrar a spec para `packages/shared`.

## Arquivos

```
apps/api/src/application/companies/CompanyProvisioningService.js   provisionar + pós-criação (2 portas)
apps/api/src/application/accounting/globalChartStatus.js           guarda do plano global (2 chamadores)
apps/api/src/application/onboarding/etapasTemplate.js              trilha por origem — SÓ no servidor
apps/api/src/application/onboarding/OnboardingService.js           regras do funil
apps/api/src/application/validators/onboardingSchemas.js           envelope (fino de propósito)
apps/api/src/routes/firm/onboardings.js                            rotas, montadas na raiz de /firm

apps/web/src/features/onboarding/lib/onboardingSpec.js             a spec como DADO + seletores
apps/web/src/features/onboarding/lib/onboardingZod.js              schema derivado da spec
apps/web/src/features/onboarding/lib/onboardingStatus.js           status → token/ícone
apps/web/src/features/onboarding/lib/brasilApi.js                  consulta de CNPJ + 2 mapeamentos
```
