# Mapa do sistema — o que faz, o que falta

Documento para o dono validar. Organizado pelo **fluxo real do mês do contador**, não pela
arquitetura do código.

Legenda: **✅ funciona** (validado em produção) · **🟡 parcial** (funciona, com buraco conhecido)
· **⬜ não existe** · **⚠️ risco** (funciona, mas pode errar em silêncio)

---

## O caminho, em uma frase

> Cadastrar a empresa → capturar as notas → conferir se as notas estão completas → apurar e
> declarar → gerar as guias → mandar pro cliente → dar baixa quando pagar → fechar o mês.

Tudo abaixo é detalhe desses oito passos.

---

## 1. Cadastro da empresa

| | O quê | Obs |
|---|---|---|
| ✅ | Cadastro por CNPJ, preenchendo sozinho pela consulta | BrasilAPI |
| ✅ | Todos os CNAEs (principal + secundários), com descrição | corrigido 28/07 |
| ✅ | Sócios, endereço, inscrições, capital, natureza jurídica | |
| ✅ | Certificado A1 por empresa | |
| ✅ | Documentos (contrato social, cartão CNPJ, inscrições) — baixar/enviar | novo |
| ✅ | Anotações por empresa (importância, fixada) | novo |
| 🟡 | `CadastroFiscal` só nasce quando alguém salva a aba fiscal | 15 de 19 empresas não têm; o sistema cai no cadastro da empresa, então **não quebra** — mas os campos fiscais próprios (sublimite, forçar CNAE) ficam no default |

## 2. Captura de notas

| | O quê | Obs |
|---|---|---|
| ✅ | NFS-e pelo ADN Nacional (por certificado) | |
| ✅ | NF-e pela SEFAZ (DFe) | exige inscrição estadual |
| ✅ | Import de XML avulso | |
| ✅ | Cancelamento vindo do nacional sai do faturamento | validado: 25 notas / R$ 7.700 na SINTROPIA |
| ✅ | Ver as canceladas na tela | novo |
| ⚠️ | **NF-e não tem conferência contra a SEFAZ** | se um evento de cancelamento se perder na captura, a nota fica "autorizada" para sempre e soma no faturamento |
| 🟡 | Ledger append-only por NSU (robustez) | codado, **não ligado** à captura — ver `docs/robustez-nfse-adn.md` |

## 3. Conferir se as notas estão completas ⬅️ **o elo mais novo**

| | O quê | Obs |
|---|---|---|
| ✅ | Conferência contra o ADN: compara chave a chave | detecta nota que falta ("28 vs 27") e nota cancelada no nacional |
| ✅ | Divergência **trava** o fechamento | |
| ✅ | Roda sozinha no dia 1 do mês seguinte | novo |
| ⬜ | **Empresas marcadas na rotina "Conferência ADN"** | **sem isso o worker roda e não faz nada** |
| ⬜ | Botão para conferir sob demanda na tela | a rota existe, falta o botão |

## 4. Apuração e declaração (Simples Nacional)

| | O quê | Obs |
|---|---|---|
| ✅ | Perfil fiscal por CNAE (anexo sugerido, Fator R) | 42/42 CNAEs classificados |
| ✅ | Classificação das notas (regra empresa → global → capítulo) | item sem regra vira pendência, nunca chuta |
| ✅ | Simulação oficial PGDAS-D | validado em produção |
| ✅ | Fechamento com escolha de atividades + folha 12m | |
| ✅ | Transmissão gera extrato + guia no mesmo retorno | |
| ⚠️ | **Só 1 dos 43 `idAtividade` foi exercido contra a API real** | os outros vêm da especificação, com `verificadoTrial:false`. Empresa que precise de outra atividade é território não testado |
| ✅ | Cada DAS na sua coluna: `dasCalculadoLocal` (nosso motor) · `dasSimuladoSerpro` (simulação da RFB) · `dasRetornadoSerpro` (transmissão) | até 08/2026 a simulação era gravada em `dasCalculadoLocal`, a coluna do motor — que também escreve nela. A coluna ora guardava um, ora o outro. Comparar simulado × transmitido mostra se o valor mudou entre a prévia e a declaração |
| 🟡 | Snapshots ANTIGOS podem ficar com procedência **ambígua** | `dasCalculadoLocalProcedencia = 'AMBIGUO'` nas linhas em que nem `receitaPorTipo` nem `simulacaoSerpro` provam quem escreveu. Não se inventa dono; a tela mostra "procedência ambígua". Medir: `apps/api/scripts/diag-procedencia-das.mjs` |

## 5. Lucro Presumido

| | O quê | Obs |
|---|---|---|
| ✅ | Guias (DARF consolidada, PIS/COFINS/IRPJ/CSLL) via DCTFweb | |
| ⬜ | **Apuração** | a aba é escondida de propósito — não apuramos LP |
| ⬜ | Receita do LP | investigado e adiado: DCTFweb traz só tributo, não receita. Viria de ECF/ECD (anual) ou das notas |

## 6. Guias

| | O quê | Obs |
|---|---|---|
| ✅ | DAS (PGDAS-D), INSS (DCTFweb), DARF LP, parcelamento | |
| ✅ | Upload manual + parsing de PDF | |
| ✅ | Marcar "Vazio" (ausência confirmada) | |
| ✅ | Recalcular guia específica | manual de propósito: re-buscar todo dia sobrescrevia com juros/multa |
| ✅ | PDFs sobrevivem a deploy | exige o Volume em `/app/storage` |

## 7. Envio ao cliente

| | O quê | Obs |
|---|---|---|
| ✅ | Envio em lote por e-mail | |
| ✅ | Liberar guia individual | |
| ✅ | Selo "Enviado" no card, que volta se a guia for retificada | |
| ✅ | Enviar documentos cadastrais selecionados | novo |
| ✅ | App mobile do cliente | projeto separado |

## 8. Pagamento e baixa

| | O quê | Obs |
|---|---|---|
| ✅ | Buscar comprovante no SERPRO (PAGTOWEB) | validado 28/07, INSS e DAS |
| ✅ | Data e valores reais do comprovante | inclusive rateio principal/juros/multa |
| ✅ | Pagamento localizado ≠ baixa lançada | a guia ganha tag "paga"; o lançamento é ato do contador |
| ✅ | Juros e multa como lançamentos separados | contas 501 e 506 |
| 🟡 | 87 guias antigas sem `numeroDocumento` | sem ele não dá pra buscar comprovante; só recapturando (chamada paga) |
| ✅ | `INTEGRACAO_SERPRO_PAGTOWEB` ligada em produção | validada e em uso |

## 9. Contabilidade

| | O quê | Obs |
|---|---|---|
| ✅ | Lançamentos, plano de contas, OFX, export | |
| ✅ | Circular anual com trimestre/anual por linha | |
| ✅ | Fechamento contábil do mês (trava lançamento em branco / D≠C) | |
| ✅ | Parcelamentos | |
| ✅ | Situação fiscal (SITFIS) com PDF salvo, 1× a cada 4h | |

## 10. Visão do escritório

| | O quê | Obs |
|---|---|---|
| ✅ | Dashboard por competência, com filtros | |
| ✅ | Visão anual (12 meses × empresas) | |
| ✅ | Consultas em lote + situação fiscal | |
| ✅ | Rotinas por empresa (quem roda o quê, quando) | |
| ✅ | Selo de processos em segundo plano | |

---

## O que eu faria, nesta ordem

Ordenado por **risco de errar dinheiro**, não por esforço.

1. **Marcar as empresas na rotina "Conferência ADN"** — hoje o faturamento nunca foi
   confrontado com a autoridade nacional. É o único item que protege o número que vai ser
   declarado, e não custa código nenhum: é configuração.
2. **Rodar `diag-apuracao.mjs`** e resolver o que aparecer: competência fechada e não
   transmitida, pendência humana travando, DAS que mudou entre a prévia e a declaração.
3. **Validar os `idAtividade`** que as empresas da carteira realmente usam. Hoje só um foi
   exercido contra a API real — é o maior risco silencioso da apuração.
4. **Botão de conferência sob demanda** na aba Apuração — a rota já existe.
5. **Conferência de NF-e contra a SEFAZ** — hoje NF-e depende do evento chegar pela captura.
   Menos urgente porque a carteira é quase toda de serviço.
6. **Recapturar as 87 guias sem `numeroDocumento`** — sob demanda, quando precisar conferir
   pagamento daquele mês. Não vale em lote (chamada paga por guia).
7. **Ligar o ledger por NSU** (`docs/robustez-nfse-adn.md`) — a captura vira fluxo de eventos
   em vez de foto por data. É a solução estrutural do que a conferência hoje remedia.
8. **Apuração do Lucro Presumido** — decisão de produto, não de código: hoje só duas empresas.

---

# Varredura de UI/UX

Feita percorrendo as telas no navegador, não lendo o código. O critério é o que o dono definiu:
**o software não deve precisar de legenda nem explicação.** Onde há uma legenda explicando como
usar, a tela falhou antes.

## O sintoma mais claro: telas que ensinam a si mesmas

| Onde | O que está escrito | Por que é sintoma |
|---|---|---|
| Consultas | "1) marque as funções · 2) marque as empresas na tabela · 3) clique em Rodar" | Um manual numerado dentro da tela. Se a ordem precisa ser explicada, o layout não a comunica. O certo é a tela guiar sozinha — o passo 2 desabilitado até o 1 estar feito, o botão Rodar inerte até haver seleção. |
| Dashboard | "Busca, filtros e acesso rapido para a carteira do escritorio." | Subtítulo que descreve o óbvio (e com dois erros de acentuação). A tela já é a carteira. |
| Cadastro | "Separados por vírgula. Preenche sozinho pelo CNPJ." | Instrução de formato. O campo deveria aceitar e formatar sozinho. |
| Apuração | "RBT12" | Sigla sem tradução em nenhum lugar. Quem não sabe, não descobre pela tela. |

## Selos que não informam nada

No card da empresa, **"SERPRO" e "🔐 A1" aparecem em todas as empresas**. Um selo que nunca varia
é ruído: ocupa espaço e não distingue. O mesmo vale para "apurada".

**A regra que falta:** selo só existe para sinalizar **ausência ou exceção**. Certificado presente
é o esperado — quem precisa gritar é o que está faltando ou vencendo.

Além disso, no mesmo card convivem "PARC" e "Em parcelamento" — dois selos para o mesmo fato.
E "DAS" sozinho não diz se a guia está pendente, pronta ou enviada; só quem já conhece a
convenção sabe que tag de guia significa pendente.

## Vocabulário inconsistente

| Conceito | Aparece como | Onde |
|---|---|---|
| Regime | `Presumido` / `LUCRO_PRESUMIDO` | card do dashboard / tabela de Consultas |
| A mesma página | `Consultas` / `Buscas SERPRO` | botão do dashboard / título da própria página |
| Estado da apuração | `aberta`, `calculada`, `transmitida` | nomes técnicos do banco, expostos na tela |
| Dinheiro | dois `fmtMoney` com convenções opostas | um inclui "R$", o outro não — gerou o **"R$ R$ 0,00"** já corrigido |

`LUCRO_PRESUMIDO` com underline é nome de enum vazando para a interface. O contador não deveria
ver a forma como o banco guarda o dado.

## Navegação com o mesmo nome para coisas diferentes

A palavra **"Cadastro"** significa três coisas distintas, duas delas na mesma tela:

1. grupo de abas da empresa (ficha, documentos, anotações);
2. sub-aba **dentro** de Apuração (o cadastro fiscal);
3. "Editar cadastro", a tela de formulário.

Em Lançamentos há três menus suspensos lado a lado — **Configurações**, **Import / Export**,
**Funções** — e "Funções" não diz o que contém. "Configurações" ali é outra coisa que a
"Configurações" do dashboard.

## Defeitos visíveis encontrados

| | O que aparece | Situação |
|---|---|---|
| ✅ | `R$ R$ 0,00` em Fat. interno, Fat. externo, RBT12, DAS apurado | **corrigido** (`a708d282`) |
| ⬜ | Circular diz "Nenhuma provisão registrada para 2026" **e** mostra R$ 1.200,00 em Abril | mensagem de vazio aparecendo com a tabela preenchida |
| ⬜ | Ícone `⚲` no botão Filtro (Lançamentos) | não é uma lupa; é o símbolo de gênero neutro |
| ⬜ | Grupo de caixas "Folha/Pró-labore · Despesas · Receitas · Provisões · Pagamentos" sem título | não dá pra saber se é filtro ou checklist (é checklist de conferência) |
| ⬜ | Emoji em 3 dos 7 botões do topo (📊 🕒 🔎), nenhum nos outros | metade decorada, metade não |

## O que foi executado (28/07/2026)

- ✅ **Selo só para exceção.** SERPRO/A1/apurada só aparecem quando faltam, vencem ou estão
  pendentes. Some também a duplicata "Em parcelamento" + "PARC".
- ✅ **Vocabulário único** (`src/lib/vocabulario.js`): fim do `LUCRO_PRESUMIDO` na tela, estados
  da apuração com rótulo de trabalho ("Calculada — falta transmitir"), `RBT12` → "Receita 12 meses".
- ✅ **"Cadastro" triplo resolvido:** grupo virou **Empresa**, sub-aba fiscal virou **Perfil fiscal**.
- ✅ **`fmtMoney` desambiguado:** o que devolve só o número virou **`fmtValor`** (49 ocorrências).
  Nomes diferentes tornam impossível prefixar "R$" no que já o traz — a causa do `R$ R$ 0,00`.
- ✅ **Defeitos visíveis:** vazio da Circular, ícone do Filtro, checklist sem título, subtítulo
  redundante do dashboard, emojis em metade dos botões.

## O que ficou pendente

- ⬜ **Consultas guiar sozinha** em vez de numerar os passos ("1) 2) 3)"): seções desabilitadas
  até a anterior estar preenchida e botão Rodar inerte sem seleção. É o item de maior esforço e o
  único que exige mexer no fluxo, não só em rótulo.

Nada disso muda um número fiscal. É tudo sobre o contador olhar a tela e saber o que fazer sem
alguém do lado explicando.

## O que eu NÃO faria agora

- **Cofre de certificados / KMS (Q13):** importante para LGPD, mas não muda nenhum número.
- **Reescrever o motor de cálculo local:** ele é double-check. Quem decide o DAS é a RFB.
