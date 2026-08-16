# CLAUDE.md — Portal Contábil

Instruções e contexto para o Claude Code neste projeto.

## Visão Geral

Portal contábil full-stack multi-tenant para gestão de documentos fiscais brasileiros (NFe, NFS-e, guias).

**Dois perfis de uso:**
- **Escritório:** gerencia carteira de empresas clientes
- **Cliente:** gerencia seus próprios documentos fiscais

## Monorepo — Estrutura

```
apps/api/         - Backend Node.js/Express (porta 3000)
apps/web/         - Frontend React/Vite
apps/pdf-reader/  - Serviço Python/FastAPI de parsing de PDF (porta 8000)
packages/shared/  - Contratos e tipos compartilhados
```

Cada app tem seu próprio `CLAUDE.md` com regras específicas.

## Tech Stack

| Camada     | Tecnologia                              |
|------------|-----------------------------------------|
| Backend    | Node.js 20, Express.js, Prisma, PostgreSQL |
| Frontend   | React 19, Vite, CSS custom properties (`styles/tokens.css`) + estilo inline. **Sem Tailwind** |
| Parser     | Python 3.12, FastAPI, pdfplumber        |
| Auth       | JWT + RBAC                              |
| Email      | Gmail API (delegação) / Nodemailer SMTP |
| Deploy     | Railway / DigitalOcean + Docker + GitHub Actions |

## RBAC

- **FIRM:** `ADMIN`, `ACCOUNTANT`, `STAFF`
- **CLIENT (por empresa, `CompanyClientUser.role`):** `OWNER`, `CLIENT_ADMIN`, `FINANCEIRO`
  (`CLIENT_USER` = legado, não ofertado no app do cliente). Pesos: FINANCEIRO=1 < CLIENT_ADMIN=2 < OWNER=3.
  - **Gestão de usuários** (convidar/editar/remover membros) = **OWNER apenas**; OWNER é protegido.
  - **Pró-labore / certificado A1 / sócios** = `CLIENT_ADMIN`+; **notas/guias/alíquota/fluxo** = qualquer membro ativo.

Rotas protegidas pelo middleware `requireRole` (escritório) e `requireClientCompanyAccess(minRole)`
(cliente, em `apps/api/src/middlewares/`). Nunca bypassar sem motivo explícito.

## Progresso e Histórico de Mudanças

### Em andamento (branch `dev`)

- [x] Módulo de lançamentos contábeis — base completa (plano de contas, OFX,
  export CSV, baixa de provisões, circular anual, históricos persistentes,
  funções de lançamento, parcelamentos)
- [x] **Módulo de Notas Fiscais (Q12)** — captura NF-e (SEFAZ DFe) + NFS-e (ADN
  Nacional gov.br) com cert A1 por empresa; manifestação destinatário; workers
  automáticos com rate limit; alertas de cursor desatualizado.
- [x] **Apuração Simples Nacional — refundação (Q14)** — cadastro = autoridade,
  classificação como sinal, motor de cálculo local, Fator-R mensal, filas de
  pendência. Models: CadastroFiscal, ProdutoServico, RegraClassificacao,
  CnaeAnexo, AliquotaSimplesNacional, ApuracaoSnapshot, etc.
- [~] **Apuração — fluxo de fechamento + SERPRO (Q15)** — tabela global com
  seleção múltipla; FechamentoModal (atividades, folha 12m, disparidade);
  **simulação oficial PGDAS-D (TRANSDECLARACAO11) validada em produção real**;
  fila de transmissão em lote (consulta-antes-de-transmitir).
  - Pendente: validar os demais `idAtividade` (só o 11 exercido); transmissão
    real (`indicadorTransmissao:true`) ainda não testada; ligar worker da fila.
  - Detalhes técnicos do PGDAS-D: ver `apps/api/CLAUDE.md`.
- [x] **Parcelamento real (Q16)** — 1 provisão (abertura) + linhas leves de parcela +
  baixa por pagamento; contas D/C em branco com memória por linha (igual Simples);
  envio em lote com 3 estados; selo de e-mail no dashboard.
- [~] **Fluxo mensal do contador (Q17)** — cron busca **extrato** (gera lançamentos) além
  das guias; guia **"Vazio"** (ausência confirmada → amarelo); **circular com trimestre/anual**
  por linha; **fechamento contábil do mês** (bloqueia se houver lançamento em branco/D≠C);
  dashboard filtra por competência (mês anterior) + pendências; card muda de cor quando
  fechada; aba **Lançamentos** vira a primeira. Cada bloco de arquitetura tem seu `CLAUDE.md`.
  - Pendente: aplicar a migração `add_fechamento_contabil` (requer o banco no ar).
- [x] **UI do dashboard + aba Lançamentos (Q18)** — dashboard: botões reordenados
  (Nova empresa · Envio de e-mails · Apuração · Configurações-dropdown), "Atualizar" vira
  ícone, filtros compactos, cards menos coloridos (tags só com borda), CNPJ branco, card
  teal quando fechada. Lançamentos: **adicionar inline** (DraftEntryRow, auto-reabre até
  ESC/Sair), **filtros compactos**, **cadeado** de fechamento perto da tabela, colunas
  **Tipo/Status removidas**, títulos centralizados/brancos, e **carga automática** ao
  abrir a aba/mudar competência (effect em `useManageAccountingWorkspace`).
  **Mês fechado bloqueia** novo lançamento e upload/registro de guia manual + marcar Vazio
  (helper `isMonthClosed`; back retorna 409/`MES_FECHADO`; front desabilita os botões).
  Aba **Apuração V2 removida** do header da empresa.
- [x] **Guias — barra de ações única (Q57)** — ao selecionar 1 guia: **Recalcular** (um botão,
  detecta INSS→DCTFweb / DAS→PGDAS-D), **Confirmar pagamento**, **Liberar ao cliente** (envia SÓ a
  guia por e-mail; se já enviada, modal de reenvio), **Excluir** (hard-delete já revoga). Removidos
  Reenviar/Revogar/Parcelamento solto/Recalcular INSS. Liberar por-guia: `POST /firm/guides/:id/liberar-cliente`
  (o empacotamento DAS+INSS fica só no envio em lote da página principal).
- [x] **Notas Fiscais — aba enxuta (Q58)** — 2 janelas: **NFS-e** (ADN + import XML) e **NF-e**
  (SEFAZ), a de NF-e **só com inscrição estadual** (`selectedCompany.legacyCompany.inscricaoEstadual`).
  Sem stats/legendas/rodapé; captura compacta.
- [~] **Robustez NFS-e/ADN (Q59)** — captura deve virar *fluxo de eventos por NSU*, não *snapshot por data*.
  Roadmap em **`docs/robustez-nfse-adn.md`**. **Fase 1** (ledger append-only `documentos`/`eventos` +
  `nsu_watermark`/`nsu_gaps` + projeção recalculável) codada e **verificada offline** — ainda NÃO ligada
  à captura (`PortalInvoice` intacto). **Camada 2** (conferência de contagem por chave vs ADN) **trava o
  fechamento** no "28 vs 27" (`ConferenciaAdnService`; `POST .../fechamento/:comp/conferencia`;
  `scripts/conferir-adn.mjs` roda em prod). Fase 0 (forense) superada pela detecção automática.
- [x] **Apuração dentro da empresa (Q60)** — aba Fiscal "Cadastro" → **"Apuração"**: faturamento +
  prévia (reusa `FechamentoModal`) + **extrato do Simples** (`syncPgdasCircular`) + fechar/transmitir/retificar
  por dentro da empresa. Cadastro enxuto (só regime + atividades permitidas). Tela de lote global vira
  **select-only** (só seleciona fechadas + apura em lote; o filtro `estado="fechada"` já é server-side).
- [x] **Reorganização do dashboard + fluxo fiscal (Lote C)** — dashboard com **duas visões**
  (Cards ⇄ **Ano**: grade 12 meses × empresas, fechamento contábil + apuração por célula, clique
  abre a empresa naquela competência); **filtros recolhidos** (só busca + competência aparentes,
  com setas ‹ ›); **card redesenhado** (regime·SERPRO·A1 no mesmo design; tags de guia dão lugar a
  "Enviado" quando todas enviadas; ⚠ pendência fiscal; selo PARC); **selo de processos em segundo
  plano**. "Funções em lote" virou **Consultas** e absorveu **Pendências** (aba "Situação Fiscal").
  Abas fiscais da empresa reordenadas (Notas Fiscais → Apuração → Guias → Situação Fiscal), **LP
  sem aba Apuração** (ainda não apuramos Presumido), módulo fiscal centralizado, **resumo na aba
  Notas Fiscais**. Fiscal: guia do LP mostra os tributos (PIS/COFINS) em vez de "OUTRA";
  **transmitir já devolve extrato + guia**; SITFIS mostra o relatório salvo ao abrir e reconsulta
  só pelo botão, **1× a cada 4h**.
  - ⚠ **Exige Volume no Railway em `/app/storage`** — sem ele o filesystem é efêmero e **todo
    deploy apaga os PDFs** (guias e relatórios SITFIS). Ver `apps/api/CLAUDE.md`.
- [~] **PLANO MESTRE — entregas 1 a 8** (Bloco 8/chat é de outro agente; **Entrega 7,
  Departamento Pessoal, deixada de lado a pedido do dono**).
  - **Competência global da empresa** (`lib/competencia.js` + `CompetenciaSwitcher` no header):
    Lançamentos, Circular, Cadastro Fiscal, Guias e Notas Fiscais passaram a ler a MESMA
    competência. Antes eram duas, com defaults diferentes, discordando em silêncio.
  - **Regras de tela viraram lib com teste próprio:** `circular/lib/estadoGuia.js` (12),
    `obrigacoes/lib/cicloObrigacao.js` (15), `relatorios/lib/periodoRelatorio.js` (18),
    `notas/lib/cicloNotaTela.js` (14).
    - ⚠ **O detalhe da nota agora conta a SUBSTITUIÇÃO** (caso relatado pelo dono: *"cancelamos
      essa nota, emitimos outra e depois a substituímos"*; 22 notas com `chaveSubstituida` na
      base). O `NotaDetailModal` não lia `ciclo`/`eventos`/`chaveSubstituida`: a lista dizia
      "substituída" em âmbar e o detalhe da MESMA nota dizia "cancelada" em vermelho. A leitura
      agora é **uma só** (`notas/lib/cicloNotaTela.js`), consumida pelas duas telas; a REGRA
      continua no backend (`application/notas/cicloNota.js`, intocado). O bloco mostra os dois
      lados do vínculo (`chaveSubstituida` × `PortalInvoiceEvent.chaveSubstituta`), com motivo,
      data, eventos e **navegação** para a nota do outro lado — e, quando ela não está na base,
      diz isso em vez de sumir com o vínculo. O mapa de cor `statusEfetivo === "substituida"` do
      modal era **morto** (esse campo só vale `autorizada`/`cancelada`) e hoje é alimentado por
      `ciclo.situacao`.
  - **Espelho da DEFIS** (`obrigacoes/defis/`) — a especificação de campos como DADO
    (`defisSpec.js`, `DEFIS_FONTE.verificadoNoPortal: false`). **Não transmite**: a DEFIS é
    transmitida no portal, e `marcarDefisTransmitida` só registra o recibo do nosso lado.
    ⚠ `PERGUNTAS_MUNICIPIO` está **deliberadamente vazio** — o manual não traz lista fechada.
    - ⚠ **Quem NÃO é optante pelo Simples Nacional não entrega DEFIS.** A tela não perguntava o
      regime — oferecia o espelho a toda empresa, inclusive às do Lucro Presumido (defeito relatado
      pelo dono). A regra vive em `defis/lib/obrigatoriedadeDefis.js` (24 testes) e tem **três**
      respostas: `obrigada`, `dispensada` e **`indefinida`** — sem regime cadastrado não se afirma
      nem uma coisa nem outra. Mesma forma da `obrigatoriedadeEfd.js`, com o **sinal invertido**.
      - ⚠ **QUEM NÃO DEVE A DEFIS NÃO VÊ NADA SOBRE DEFIS — decisão do dono, 15/08/2026**, com a
        tela na frente dele: *"empresas do Presumido que não têm DEFIS estão aparecendo uma legenda
        explicando que elas não têm, isso é horrível, é apenas tirar isso de lá"*.
        **Isto REVERTE o desenho anterior**, que era o oposto e está registrado aqui porque o
        argumento continua valendo para a EFD (abaixo): a dispensa **aparecia com o motivo e a
        norma** (`DefisNaoDevida.jsx`) no lugar do fluxo, para que não sumisse da tela quem não deve
        nada — senão ninguém sabe se foi dispensa ou esquecimento. O que virou: no Lucro Presumido a
        dispensa é a **regra**, não a exceção, e um parágrafo fixo repetido em toda empresa
        não-optante é ruído, não informação.
        ⚠ **A REGRA NÃO SAIU** — `obrigatoriedadeDefis.js` (e seus 24 testes) segue intacta e segue
        decidindo. O ramo `dispensada`/`indefinida` continua **não oferecendo o fluxo**; só ficou
        **silencioso**. Trocar o `&&` de `defisDevida` em `renderCompanyDetailPage.jsx` por um
        render incondicional devolveria o espelho da DEFIS ao Presumido, que é o defeito fiscal que
        a regra existe para impedir.
        ⚠ Efeito colateral: `DefisNaoDevida.jsx` (e seu teste) ficou **sem consumidor**. Não foi
        apagado — apagar componente é decisão à parte.
    - ⚠ **A resposta é sobre o ANO-CALENDÁRIO, não sobre "hoje".** Empresa excluída do Simples
      continua devendo a DEFIS do ano em que foi optante ("em relação ao ano-calendário de exclusão
      (…) a DEFIS abrangerá o período em que esteve na condição de optante" — manual, item 9.2.2), e
      o sistema guarda só o regime atual. Por isso as hipóteses que derrubam a dispensa viajam
      NOMEADAS junto dela, em `obrigatoriedadesNaoAvaliadas`.
      - ⚠ **A SAÍDA "abrir o espelho mesmo assim" SAIU DA TELA junto com a legenda (15/08/2026).**
        Ela morava dentro de `DefisNaoDevida`, colada às hipóteses que a justificavam; tirado o
        painel, não há mais como abrir o espelho de uma empresa não-optante pela interface. As
        hipóteses continuam sendo devolvidas pela regra — o que não existe é consumidor delas.
        Se o caso do ano de exclusão aparecer de verdade, é assunto a levar ao dono, não a
        reintroduzir por conta própria: foi ele quem pediu o silêncio.
    - **Fonte conferida no documento oficial** (não copiada de terceiros): Manual do PGDAS-D e DEFIS
      (RFB), seção 9 — "deve ser prestada por contribuinte optante do Simples Nacional por pelo menos
      um período nela abrangido" (LC 123/2006, art. 25, caput); prazo e situação especial no item
      9.1.2, citando a **Res. CGSN 140/2018, art. 72, §§ 1º e 2º** — ou seja, o art. 72 É o
      dispositivo da DEFIS. Medido em produção (12/08/2026): 33 empresas (22 Simples, 11 Presumido) e
      **zero** espelhos gravados — o conserto é preventivo, não houve dado a preservar nem a apagar.
      Script de leitura: `apps/api/scripts/diag-defis-por-regime.mjs`.
  - **Relatórios** (sub-aba de Contabilidade) — intervalo PRÓPRIO, a única exceção à competência
    global. ⚠ **Balanço e balancete não aparecem nem desabilitados**: exigem saldo por conta com
    classificação patrimonial, e entregar isso a partir de lançamentos seria um demonstrativo com
    NOME DE PEÇA CONTÁBIL. Período anterior tem o **mesmo tamanho**; base zero **não vira
    percentual**; mês sem lançamento entra na série **com zero**, visualmente distinto.
  - **Planejamento tributário** (`features/planejamento/`) — motor local com as tabelas em
    `tabelasFiscais.js`, cada valor citando a lei; 95 testes, dos quais 24 são **casos dourados
    calculados à mão**. ⚠ A **recusa de calcular tem o mesmo peso visual do resultado**
    (`CardRegime.jsx`): número ausente diagramado em cinza vira ausência de dúvida. O PDF sai com
    a **data de vigência das tabelas e os avisos de escopo impressos**, porque circula sozinho.
    Início de atividade coberto — RBT12 proporcionalizado e **guarda do limite proporcional** de
    enquadramento (estouro pode excluir a empresa retroativamente): `docs/fontes-fiscais.md`
    §1.12 e §1.13.
    - **MODO CARTEIRA LIGADO (16/08/2026).** O efeito de pré-preenchimento já existia na página e
      **ninguém nunca passava a empresa** — o `App.jsx` renderizava `<PlanejamentoPage />` sem prop.
      Hoje há **seletor de empresa dentro da página** (a simulação livre continua sendo o estado
      inicial, de propósito) alimentado por `companiesState.companies` (`GET /firm/companies`, já
      escopado pela carteira); o backend reconfere o id com `requireFirmCompanyAccess`. Fonte dos
      campos: `application/planejamento/DadosPlanejamentoService.js` +
      `GET /firm/companies/:id/planejamento` — **só leitura, não grava nem cache** (por isso NÃO usa
      `RbtExtratoService.getRbt12`, que faz `upsertCache` no fallback).
    - ⚠⚠ **FOLHA AUSENTE NÃO É ZERO, e isso virou regra do motor.** `fatorR(null, rbt)` devolve
      `null` (era `0`, porque `Number(null) || 0`), `anexoPorFatorR` deixa de responder **"V"**, e
      `compararRegimes` devolve o Simples **`indisponivel`** quando a atividade é de Fator R e a
      folha não foi informada. Antes o caminho era silencioso e caro: Fator R 0% → Anexo V (a
      alíquota maior) → um vencedor eleito sobre um número que ninguém digitou, num PDF que vai ao
      cliente. Folha **zero informada** continua calculando — a distinção é `null` × `0`.
      Travado em `lib/__tests__/folhaAusenteNaoEZero.test.js` (11).
      - O zero não é hipotético: `CalculoFiscal.calcularApuracaoParaCompetencia` grava
        `fs12Manual: fs12` com `fs12 = … : 0`. Há **zeros fabricados no banco**, e por isso
        `campoComOrigem.valorMonetario` trata `0` como NÃO APURADO em toda base monetária.
      - Par disso: CPP que depende da folha (Anexo IV, Presumido, Real) **não vira zero por
        ausência** — sai da soma e vai declarada em `naoConsiderado`, no corpo do card.
    - **Cada campo mostra a ORIGEM, e ela sai IMPRESSA.** `lib/prefillDaEmpresa.js` traduz o payload
      em valores + procedência, com quatro estados (`da_empresa` · `digitado` (por cima, mostrando
      os dois) · `informado` · `ausente` com motivo). O PDF ganhou a tabela "Procedência dos dados
      usados nesta simulação" — dois PDFs da mesma empresa com números diferentes precisam se
      distinguir **no papel**.
    - ⚠ **A atividade do Lucro Presumido NÃO é derivada do CNAE, de propósito**: o projeto não tem
      de-para CNAE→presunção de IRPJ/CSLL (o `CnaeAnexo` mapeia para ANEXO DO SIMPLES, outra lei), e
      errar entre 8% e 32% inverteria a comparação. Sai ausente, com o motivo. **Pendente do dono.**
    - ⚠ **Regime atual sem default.** `apuracaoV2.mapRegime` e `PerfilFiscalService` terminam em
      `return "SIMPLES_NACIONAL"`; aqui texto irreconhecível devolve `null` e a tela diz que não
      sabe — o comparativo inteiro se lê a partir do "hoje você está no X".
    - **IBS/CBS: não construído, e a porta ficou aberta** — `tabelasFiscais.js` + um `custoAnual*`
      novo em `comparador.js` é tudo que o desenho pede. Ver o relatório da entrega; nada de
      alíquota/base/transição foi escrito (LC 214/2025 em transição).
  - **EFD-Contribuições / entrega por arquivo** (`obrigacoes/entregas/`, modelo genérico
    `EntregaObrigacaoArquivo`) — o **rastro** em três passos, com o "onde acontece" no rótulo de
    cada um. Serve também a ECD/ECF (`competencia` aceita "YYYY-MM" e "YYYY").
    - ⚠ **Optante do Simples Nacional NÃO entrega** (IN RFB 1.252/2012; Guia Prático v1.35, Cap. I,
      Seção 3). A regra vive em `entregas/lib/obrigatoriedadeEfd.js` (19 testes) e tem **três**
      respostas: `obrigada`, `dispensada` e **`indefinida`** — sem regime cadastrado não se afirma
      nem uma coisa nem outra. A tela mostra a dispensa **com a norma citada** no lugar do fluxo;
      isso não é o mesmo que sumir, e a distinção é o ponto: some da tela quem não deve nada, e aí
      ninguém sabe se foi dispensa ou esquecimento.
    - ⚠ Dispensas que dependem de dado que não temos (imunidade com contribuições ≤ R$ 10 mil, mês
      sem receita, inatividade) **não são aplicadas** — viajam nomeadas junto da obrigação.
      Dezembro traz aviso próprio: consolida no registro **0120** os meses dispensados do ano.
    - ⚠ **Ainda não gera o arquivo.** O leiaute oficial (Guia Prático v1.35) está versionado em
      `docs/leiaute-efd-contribuicoes/` com hash — mas faltam as **tabelas 4.3.x** (ficam atrás de
      postback ASP.NET, e são dados por vigência, não constantes) e o gate de aceite nº 1,
      **validar no PVA**, que não é executável neste ambiente. Ler o README de lá antes de retomar.
    - **Não transmite**, e o motivo é outro: validação/assinatura/transmissão são do PVA, sem API —
      esse limite não muda nem com o gerador pronto.
  - **Não construído, e por quê:** NFS-e recorrentes (sem model/scheduler); motivo de rejeição da
    NFS-e na lista (`ServiceInvoice` não tem o campo); chip anual da DEFIS na listagem principal
    (falta agregação no backend); Bloco 3 (Apuração do Lucro Presumido) segue travado no probe do
    `CONSDECCOMPLETA33`.
- [~] **WhatsApp — Entrega 1: envio de guias pelo canal** — **F1 a F5 escritas na `dev`, o canal
  DESLIGADO** (flag `INTEGRACAO_WHATSAPP` OFF; cadastro na Meta em verificação). Roadmap e estado
  completo em **`docs/whatsapp-entrega-1.md`**.
  - ⚠ **NADA SAI E NADA ENTRA HOJE, e isso é por construção, não por acaso:** com a flag OFF o
    cliente da Cloud API **recusa operar** e o webhook responde 503 nos dois verbos, mesmo com
    assinatura válida; e **nenhum template foi submetido à Meta** (`TemplateWhatsapp.statusAprovacao`
    nasce `DECLARADO`, nunca `APROVADO`), então o envio recusa por `TEMPLATE_NAO_APROVADO`. Ligar o
    canal é decisão do dono em **dado e variável de ambiente**, não em código.
  - **F1 e F2 prontas na `dev`** e seguras para subir junto de qualquer outra entrega: F1 é inerte
    (tabelas e rotas que ninguém chama ainda) e F2 preserva o comportamento (`foiEnviadaComLegado`).
  - ⚠ **O esqueleto que o dono trouxe (`whatsapp-module.zip`) foi CONFERIDO CONTRA O PROJETO, não
    copiado** — instrução dele: *"sempre verifique essas coisas, quem fez o plano não viu o
    projeto"*. Duas das seis tabelas dele já existiam aqui (`contato_whatsapp` = `contatos_whatsapp`;
    `evento_envio_guia` = `envios_guia`, e a `UNIQUE (guia_id, canal)` dele **brigaria com o
    retry**); ele mandava rodar `psql -f` num projeto gerido por **Prisma**; não tratava
    **ambiguidade** de número; e traduzia o erro `130472` com o texto documentado do `131050`.
    Cada decisão do código carrega a procedência: **fonte oficial** (URL + data) × **esqueleto** ×
    **código existente**.
  - **F2 é a mudança estrutural:** `Guide.emailStatus` deixou de ser o estado de envio. Quem
    responde "esta guia foi enviada?" agora é **`envios_guia`** (um registro por guia × canal) — um
    campo só não representa "enviada por WhatsApp e ainda não por e-mail". Enviada = terminal em
    QUALQUER canal.
  - ⚠ **NÃO RODE `scripts/backfill-envio-guia.mjs`. A F5 EXISTIR NÃO O LIBEROU — pelo contrário.**
    Esta linha já mandou o oposto duas vezes; seguir a instrução antiga quebra o dashboard de forma
    permanente. O que muda o estado do mundo não é a F5 ter sido escrita, é ela **gravar** — e hoje
    ela não grava (flag `INTEGRACAO_WHATSAPP` OFF, e `envios_guia` medida em produção: **0
    registros**, com o legado respondendo por todo mundo).
    - **O mecanismo:** `foiEnviadaComLegado` desliga a tolerância na **primeira linha que existir**
      (`if (envios && envios.length)`), **por guia**. O backfill converte **todos** os estados de
      uma vez (`PENDING`/`ERROR` viram `pendente`/`falhou`), então toda guia pendente naquele
      instante ficaria `enviada: false` **para sempre**: card eternamente aberto, "✓ Guias
      concluídas" que nunca condensa — com a aba Guias mostrando "✓ enviado" ao lado.
    - ⚠ **A F5 fecha essa porta pelo lado dela, e é por isso que ela não precisa do backfill:**
      antes de gravar a linha de WhatsApp, `materializarEnvioDeEmailLegado` cria a linha
      `EMAIL/enviado` da guia que o `emailStatus: SENT` já prova entregue. **Só `SENT` vira linha** —
      estado que não seja `SENT` não gera nada, porque a resposta do legado para ele já era "não
      enviada" e não há histórico a inventar. É exatamente a diferença para o backfill.
      Invariante travada em `guides/__tests__/complianceAposEnvioWhatsapp.test.js` sobre as 10
      combinações de (`emailStatus` × desfecho): **tocar uma guia nunca rebaixa o
      `guideCompliance`**. Desligando `linhaLegadoDoEmail`, 5 vermelhos.
    - O backfill só voltaria a fazer sentido para converter histórico em massa — e aí a conversão
      de `PENDING`/`ERROR` continua sendo o defeito. **Trate-o como script morto.**
  - **F1.5 — o VÍNCULO número → empresa (→ pessoa)**, feito **antes** da retomada porque é o pedaço
    que, deixado para depois, contamina todo o resto. Regra **pura** em
    `application/whatsapp/vinculoTelefone.js` (33 testes ao todo, com a ligação); a ligação com o banco em
    `ContatoWhatsappService.resolverVinculoPorTelefone`. **Reusou a tabela da F1** — a única coluna
    nova é `contatos_whatsapp.userId` (migration `20260814160000`, aditiva/nullable, ⚠ **NÃO
    APLICADA**). Quatro respostas com nome próprio: `TELEFONE_INVALIDO` · **`DESCONHECIDO`** (número
    não cadastrado **não vira empresa nenhuma** — nada de casar por CNPJ, nome, semelhança ou DDD) ·
    **`AMBIGUO`** (o sócio com três CNPJs; ambiguidade de `EMPRESA` **e** de `PESSOA`) ·
    `VINCULADO`.
    - ⚠ **Vínculo não é autorização.** O módulo devolve `papelRbac` (lido de
      `CompanyClientUser.role`) e para aí — sem peso, sem `podeEmitir`. Quem decide continua sendo
      `requireClientCompanyAccess(minRole)`. O campo `papel` do cadastro é **rótulo de tela** e sobe
      como `rotulo`.
    - ⚠ **O NÚMERO É O DO CADASTRO — decisão do dono, 14/08/2026:** *"os números são sempre com um
      nove na frente a partir de agora, mas você nunca deve pressupor o número, o número de
      comunicação com o cliente será o do cadastro"*. A comparação é **dígito a dígito** com
      `contatos_whatsapp`. `variantesE164` acrescenta o 9 a qualquer número de 8 dígitos, **inclusive
      a um fixo** (`552133334444` → `5521933334444`, que pode ser o celular de outra empresa) —
      casar por aí é pressupor o número, e a consequência é emitir no CNPJ de outro.
      - ⚠ **A tolerância NÃO é parâmetro** — `opcoes.tolerancia` foi **retirada da assinatura**.
        Enquanto existia, bastava um chamador futuro passar `NONO_DIGITO` para violar a regra em
        silêncio, sem saber que havia regra. A leitura tolerante continua **calculada**, mas só
        alimenta `divergemPeloNonoDigito` e `leituras[NONO_DIGITO]`; **não há caminho para ela virar
        a resposta**. Experimento (executado): trocando a resposta para a leitura tolerante, o
        contrato fica **5 vermelhos**; restaurado, 55 verdes.
      - ⚠ **O sinal mudou de significado**: `divergemPeloNonoDigito` não é mais "talvez devêssemos
        tolerar", é **"este cadastro está no formato antigo — conserte o CADASTRO"**. A query segue
        pescando as duas formas de propósito: fosse ela a estreitar, o aviso nunca poderia acender.
      - ⚠ **`acharContatoPorWaId` também era tolerante** e foi para o mesmo critério. Ela ainda era
        pior que a tolerância: um `findFirst` sem `orderBy` e sem escopo escolhia **um** contato
        entre os que casassem — possivelmente de outra empresa — como se não houvesse dúvida. Quem
        responde "de quem é esta mensagem?" é `resolverVinculoPorTelefone`.
      - Medido em produção (14/08/2026): **`contatos_whatsapp` tem 0 registros** — a F1 subiu sem
        tela e ninguém nunca cadastrou um número, então não há dado retroativo no formato antigo.
        `scripts/diag-vinculo-whatsapp.mjs` (só leitura) mede quando houver; hoje ele **para antes**,
        porque a migration `20260814160000` não foi aplicada.
    - ⚠ **Dois furos de multi-tenancy da F1 fechados de passagem**: `salvarContato({id})` e
      `removerContato` escolhiam o alvo **só pelo id** (contato de outra empresa caía dentro do
      acesso do chamador), e o `POST` fazia `{portalClientId: path, ...body}` — corpo sobrescrevendo
      o path. Hoje `portalClientId` viaja no `where` das duas e o spread vem antes.
      `removerContato` mudou de assinatura: `(portalClientId, id)`.
    - ⚠ **A F1 subiu sem tela nenhuma** — não há um chamador de `/contatos-whatsapp` em `apps/web`.
      Hoje o vínculo só é criável pela API. Detalhes em `docs/whatsapp-entrega-1.md`.
  - F3–F6 (Cloud API, webhook, envio em lote, recebimento) **não iniciadas**: dependem de
    credenciais reais. Escrevê-las sem poder exercê-las é o que a regra 1 proíbe — e o
    `CONSDECCOMPLETA33` do LP está OFF até hoje por exatamente isso.
- [~] **Onboarding de clientes — Fase 1 (lado do escritório)** — funil PRÉ-cadastro com tabela
  própria (`onboardings` + `onboarding_etapas`), que **aceita preenchimento parcial**, tem trilha de
  etapas por origem (`ABERTURA | TRANSFERENCIA | INATIVA`) e termina chamando o **mesmo**
  provisionamento do botão "Nova empresa". Detalhes e armadilhas em
  **`apps/web/src/features/onboarding/CLAUDE.md`**.
  - **Fase 0 (refator) veio primeiro e é o que sustenta o resto:** teste de caracterização de
    `POST /firm/companies` (a rota mais crítica do sistema **não tinha nenhum teste**), depois
    `getGlobalChartStatus` → `application/accounting/globalChartStatus.js`, depois a extração de
    `CompanyProvisioningService`. O teste roda **sem edição** contra o código extraído.
  - **Mudança de comportamento da rota antiga:** o pós-criação agora semeia as `CompanyRotina` da
    empresa nova. Antes elas só nasciam quando alguém abria a página Rotinas e o seed rodava.
  - **Fase 2 (link público com token de uso único) NÃO foi feita** — e não é reuso: o único token
    opaco do projeto não tem campo de consumo, então uso único exige modelo novo.
  - ⚠ **Migração `20260809120000_add_onboarding` escrita mas NUNCA APLICADA** — não há banco
    alcançável nesta máquina. Rodar `prisma:migrate:deploy` + `:status` antes de usar.
- [ ] **Cofre de certificados / hardening LGPD (Q13)** — planejado (AWS KMS
  envelope encryption); remover fallback JWT→CERT_SECRET_KEY. Não iniciado.

### Concluído (main)

- [x] Autenticação JWT com workflow de aprovação por admin
- [x] Sincronização NFe via XML (import + parsing)
- [x] Emissão e consulta de NFS-e com certificado A1
- [x] Integração ADN para sync de NFS-e
- [x] Upload e parsing automático de guias PDF
- [x] Envio em lote de guias por email (worker background)
- [x] Multi-tenant: `CompanyFirmAccess` vinculando empresas a escritórios
- [x] Rota `/firm` com gestão de clientes, guias, NFS-e
- [x] PDF reader Python integrado como serviço separado
- [x] Deploy Railway com Dockerfile e variáveis de ambiente

## Princípios de trabalho (INEGOCIÁVEIS)

> Definidos pelo dono do projeto. Valem pra qualquer tarefa, em qualquer arquivo.

1. **NÃO INVENTAR NADA.** Não chutar valores, IDs, nomes de campo, endpoints,
   regras fiscais, alíquotas, estruturas de payload de API, nem comportamento de
   integração. Se um dado é externo (SERPRO, SEFAZ, RFB, gov.br) e não está
   confirmado por documentação oficial ou pelo dono, **não preencher por suposição**.
2. **O QUE NÃO SOUBER, PERGUNTAR.** Diante de incerteza sobre um requisito, um
   dado fiscal, um ID de atividade, um campo de API ou o efeito de uma ação —
   **perguntar ao dono antes de codar/executar**, não adivinhar.
3. **MARCAR O NÃO-VERIFICADO.** Quando algo só puder ser confirmado em ambiente
   externo (ex: `idAtividade` do PGDAS-D no trial), deixar explícito no código
   (ex: flag `verificadoTrial: false`) e avisar — nunca tratar como certo.
4. **FONTE OFICIAL VENCE.** Documentação oficial (apicenter SERPRO, manuais RFB,
   LC 123/06) tem prioridade sobre memória, exemplos de terceiros ou inferência.
5. **NUNCA transmitir/gravar ato fiscal por suposição.** Transmissão PGDAS-D,
   manifestação, emissão — só com dados confirmados e confirmação explícita.

## Regras Gerais

- Sempre considerar o contexto fiscal brasileiro (NFe, NFS-e, SEFAZ)
- Respeitar multi-tenancy: nunca vazar dados entre escritórios/clientes
- Não remover validações de CNPJ, certificado A1, ou regras fiscais
- Preferir editar arquivos existentes a criar novos
- Não adicionar abstrações desnecessárias — três linhas duplicadas são melhores que uma abstração prematura
