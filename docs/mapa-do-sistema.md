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
| 🟡 | Motor de cálculo local é double-check | quem manda é o SERPRO; divergência = motor local desatualizado |

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
| ⬜ | `INTEGRACAO_SERPRO_PAGTOWEB` ligada em produção | validada, falta ligar |

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
2. **Ligar o `INTEGRACAO_SERPRO_PAGTOWEB`** — já validado; sem ligar, a busca de pagamento
   continua manual.
3. **Rodar `diag-apuracao.mjs`** e resolver o que aparecer: competência fechada e não
   transmitida, pendência humana travando, divergência local × SERPRO.
4. **Validar os `idAtividade`** que as empresas da carteira realmente usam. Hoje só um foi
   exercido contra a API real — é o maior risco silencioso da apuração.
5. **Botão de conferência sob demanda** na aba Apuração — a rota já existe.
6. **Conferência de NF-e contra a SEFAZ** — hoje NF-e depende do evento chegar pela captura.
   Menos urgente porque a carteira é quase toda de serviço.
7. **Recapturar as 87 guias sem `numeroDocumento`** — sob demanda, quando precisar conferir
   pagamento daquele mês. Não vale em lote (chamada paga por guia).
8. **Ligar o ledger por NSU** (`docs/robustez-nfse-adn.md`) — a captura vira fluxo de eventos
   em vez de foto por data. É a solução estrutural do que a conferência hoje remedia.
9. **Apuração do Lucro Presumido** — decisão de produto, não de código: hoje só duas empresas.

## O que eu NÃO faria agora

- **Cofre de certificados / KMS (Q13):** importante para LGPD, mas não muda nenhum número.
- **Reescrever o motor de cálculo local:** ele é double-check. Quem decide o DAS é a RFB.
