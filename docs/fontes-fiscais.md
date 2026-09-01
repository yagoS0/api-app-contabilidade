# FONTES FISCAIS — PLANEJAMENTO TRIBUTÁRIO (Entrega 6)

> Documento de referência para implementação. Todos os valores foram verificados em 06/08/2026
> contra legislação e fontes oficiais, citadas seção a seção. Vigência: ano-calendário 2026.
>
> **ADENDO INCORPORADO EM 07/08/2026.** As seções §1.12 e §1.13 vieram de
> `docs/fontes-fiscais-inicio-atividade.md`, que foi apagado no mesmo commit. Os comentários
> `// FONTES_FISCAIS §x.y` do código de início de atividade apontam para 1.12/1.13.
>
> **REGRA DE OURO PARA O AGENTE:** nenhum valor de alíquota, faixa, limite ou percentual pode
> entrar no código se não estiver neste documento. O que não estiver aqui é PARÂMETRO DE ENTRADA
> (ver §9) ou está FORA DO ESCOPO desta entrega. Inferir valor fiscal é bug, não fallback.

---

## 1. SIMPLES NACIONAL — LC 123/2006

Fonte primária: LC 123/2006 (texto compilado no Planalto:
https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm). Tabelas dos anexos conforme
redação da LC 155/2016, vigente desde 01/01/2018, sem reajuste desde então
(PDF oficial da Câmara: https://www2.camara.leg.br/legin/fed/leicom/2016/leicomplementar-155-27-outubro-2016-783850-anexo-pl.pdf).

### 1.1 Limites de enquadramento

| Categoria | Limite de receita bruta anual | Base legal |
|---|---|---|
| ME | até R$ 360.000,00 | LC 123/2006, art. 3º, I |
| EPP | de R$ 360.000,01 até R$ 4.800.000,00 | LC 123/2006, art. 3º, II |
| Sublimite ICMS/ISS | R$ 3.600.000,00 | LC 123/2006, art. 13-A |

Acima do sublimite de R$ 3,6 milhões (RBT12), ICMS e ISS **saem do DAS** e passam a ser
recolhidos por fora, pelas regras gerais estaduais/municipais. A empresa permanece no Simples
para os tributos federais. É por isso que a 6ª faixa dos anexos não traz ICMS nem ISS na partilha.

- Cálculo proporcional no mês de estouro do sublimite: seguir a Resolução CGSN nº 140/2018
  (não transcrita aqui — implementar contra o texto da Resolução, não contra material de terceiros).

⚠ **Na comparação de regimes, o DAS menor da 6ª faixa NÃO é custo menor.** O que saiu do DAS
continua sendo pago — por fora. Ou ele volta à conta como valor (ISS, quando a alíquota do município
é informada — §9), ou vai como **ressalva com o mesmo peso do número** (ICMS, que depende de estado,
NCM e operação, e por isso não se estima). Onde isso vive no código: `simplesNacional.js` →
`tributosForaDoDasNaSextaFaixa()` e `custoAnualSimples({ aliquotaIss })`; `comparador.js` passa a
alíquota aos três regimes; `CardRegime.jsx` mostra `naoConsiderado` no corpo do card.

### 1.2 Fórmula da alíquota efetiva (art. 18, § 1º e § 1º-A)

```
Alíquota efetiva = [(RBT12 × ALIQ_nominal) − PD] / RBT12
```

- **RBT12** = receita bruta acumulada nos 12 meses anteriores ao período de apuração.
- **ALIQ_nominal** e **PD** (parcela a deduzir) = da faixa correspondente ao RBT12, no anexo da atividade.
- Valor devido no mês = alíquota efetiva × receita bruta do mês (base de cálculo do art. 18, § 3º).
- Empresa com menos de 13 meses: proporcionalização do RBT12 conforme art. 18, § 2º — **ver §1.12**.

### 1.3 Anexo I — Comércio

| Faixa | RBT12 (R$) | Alíquota nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 4,00% | — |
| 2ª | 180.000,01 a 360.000,00 | 7,30% | 5.940,00 |
| 3ª | 360.000,01 a 720.000,00 | 9,50% | 13.860,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 10,70% | 22.500,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 14,30% | 87.300,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 19,00% | 378.000,00 |

Partilha (percentual de repartição dos tributos):

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | ICMS |
|---|---|---|---|---|---|---|
| 1ª | 5,50% | 3,50% | 12,74% | 2,76% | 41,50% | 34,00% |
| 2ª | 5,50% | 3,50% | 12,74% | 2,76% | 41,50% | 34,00% |
| 3ª | 5,50% | 3,50% | 12,74% | 2,76% | 42,00% | 33,50% |
| 4ª | 5,50% | 3,50% | 12,74% | 2,76% | 42,00% | 33,50% |
| 5ª | 5,50% | 3,50% | 12,74% | 2,76% | 42,00% | 33,50% |
| 6ª | 13,50% | 10,00% | 28,27% | 6,13% | 42,10% | — |

### 1.4 Anexo II — Indústria

| Faixa | RBT12 (R$) | Alíquota nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 4,50% | — |
| 2ª | 180.000,01 a 360.000,00 | 7,80% | 5.940,00 |
| 3ª | 360.000,01 a 720.000,00 | 10,00% | 13.860,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 11,20% | 22.500,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 14,70% | 85.500,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 30,00% | 720.000,00 |

Partilha:

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | IPI | ICMS |
|---|---|---|---|---|---|---|---|
| 1ª a 5ª | 5,50% | 3,50% | 11,51% | 2,49% | 37,50% | 7,50% | 32,00% |
| 6ª | 8,50% | 7,50% | 20,96% | 4,54% | 23,50% | 35,00% | — |

### 1.5 Anexo III — Locação de bens móveis e serviços não relacionados nos §§ 5º-C e 5º-I

| Faixa | RBT12 (R$) | Alíquota nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 6,00% | — |
| 2ª | 180.000,01 a 360.000,00 | 11,20% | 9.360,00 |
| 3ª | 360.000,01 a 720.000,00 | 13,50% | 17.640,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 16,00% | 35.640,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 21,00% | 125.640,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 33,00% | 648.000,00 |

Partilha:

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | ISS |
|---|---|---|---|---|---|---|
| 1ª | 4,00% | 3,50% | 12,82% | 2,78% | 43,40% | 33,50% |
| 2ª | 4,00% | 3,50% | 14,05% | 3,05% | 43,40% | 32,00% |
| 3ª | 4,00% | 3,50% | 13,64% | 2,96% | 43,40% | 32,50% |
| 4ª | 4,00% | 3,50% | 13,64% | 2,96% | 43,40% | 32,50% |
| 5ª | 4,00% | 3,50% | 12,82% | 2,78% | 43,40% | 33,50% |
| 6ª | 35,00% | 15,00% | 16,03% | 3,47% | 30,50% | — |

**Teto do ISS (nota oficial do anexo):** o percentual efetivo de ISS limita-se a 5% da receita;
o excedente é redistribuído proporcionalmente aos tributos federais da faixa. Na 5ª faixa, quando
a alíquota efetiva superar **14,92537%**, a repartição passa a ser: ISS fixo em 5% e, sobre
(alíquota efetiva − 5%): IRPJ 6,02% · CSLL 5,26% · Cofins 19,28% · PIS/Pasep 4,18% · CPP 65,26%.

**Locação de bens móveis:** tributada pelo Anexo III **deduzida a parcela do ISS** (art. 18, § 5º-A) —
não incide ISS sobre locação pura.

### 1.6 Anexo IV — Serviços do § 5º-C (construção de imóveis/obras, vigilância, limpeza, advocacia)

| Faixa | RBT12 (R$) | Alíquota nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 4,50% | — |
| 2ª | 180.000,01 a 360.000,00 | 9,00% | 8.100,00 |
| 3ª | 360.000,01 a 720.000,00 | 10,20% | 12.420,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 14,00% | 39.780,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 22,00% | 183.780,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 33,00% | 828.000,00 |

Partilha (SEM CPP — ver alerta abaixo):

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | ISS |
|---|---|---|---|---|---|
| 1ª | 18,80% | 15,20% | 17,67% | 3,83% | 44,50% |
| 2ª | 19,80% | 15,20% | 20,55% | 4,45% | 40,00% |
| 3ª | 20,80% | 15,20% | 19,73% | 4,27% | 40,00% |
| 4ª | 17,80% | 19,20% | 18,90% | 4,10% | 40,00% |
| 5ª | 18,80% | 19,20% | 18,08% | 3,92% | 40,00% |
| 6ª | 53,50% | 21,50% | 20,55% | 4,45% | — |

**ALERTA DE COMPARAÇÃO — CPP fora do DAS:** no Anexo IV a contribuição patronal previdenciária
(CPP) **não está incluída** no DAS (art. 18, § 5º-C); a empresa recolhe INSS patronal por fora,
como as demais empresas (Lei 8.212/1991, art. 22). Qualquer simulação que compare Anexo IV com
outros anexos ou regimes DEVE somar a CPP por fora, senão o Anexo IV parece artificialmente barato.

Teto do ISS: mesmo mecanismo do Anexo III. Na 5ª faixa, quando a alíquota efetiva superar
**12,5%**: ISS fixo em 5% e, sobre (alíquota efetiva − 5%): IRPJ 31,33% · CSLL 32,00% ·
Cofins 30,13% · PIS/Pasep 6,54%.

### 1.7 Anexo V — Serviços do § 5º-I (tecnologia, engenharia, consultoria, auditoria etc.)

| Faixa | RBT12 (R$) | Alíquota nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 15,50% | — |
| 2ª | 180.000,01 a 360.000,00 | 18,00% | 4.500,00 |
| 3ª | 360.000,01 a 720.000,00 | 19,50% | 9.900,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 20,50% | 17.100,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 23,00% | 62.100,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 30,50% | 540.000,00 |

Partilha:

| Faixa | IRPJ | CSLL | Cofins | PIS/Pasep | CPP | ISS |
|---|---|---|---|---|---|---|
| 1ª | 25,00% | 15,00% | 14,10% | 3,05% | 28,85% | 14,00% |
| 2ª | 23,00% | 15,00% | 14,10% | 3,05% | 27,85% | 17,00% |
| 3ª | 24,00% | 15,00% | 14,92% | 3,23% | 23,85% | 19,00% |
| 4ª | 21,00% | 15,00% | 15,74% | 3,41% | 23,85% | 21,00% |
| 5ª | 23,00% | 12,50% | 14,10% | 3,05% | 23,85% | 23,50% |
| 6ª | 35,00% | 15,50% | 16,44% | 3,56% | 29,50% | — |

### 1.8 Fator R (art. 18, §§ 5º-J e 5º-M)

```
Fator R = Folha de salários (12 meses) / RBT12
```

- Folha inclui **pró-labore e encargos** (FGTS, contribuições), conforme art. 18, § 24 e Resolução CGSN 140/2018.
- **Fator R ≥ 28%** → atividades do § 5º-I (Anexo V) são tributadas pelo **Anexo III**.
- **Fator R < 28%** → atividades sujeitas ao fator (§ 5º-M) são tributadas pelo **Anexo V**.
- Apuração **mensal**, sempre sobre os 12 meses anteriores; o enquadramento pode alternar mês a mês.
- Este é um dos principais alavancadores de planejamento do módulo (pró-labore × anexo): a simulação
  deve mostrar o ponto de equilíbrio entre o custo previdenciário do pró-labore adicional e a
  economia de migrar do Anexo V para o III.

### 1.9 Tributos abrangidos pelo DAS (art. 13)

IRPJ, CSLL, PIS/Pasep, Cofins, IPI, CPP, ICMS e ISS — conforme a atividade/anexo.
Não abrangidos (recolhidos por fora, quando devidos): IOF, II, IE, ITR, IR sobre aplicações,
FGTS, INSS do trabalhador, ICMS-ST/DIFAL, ISS retido na fonte, entre outros (art. 13, § 1º).

### 1.10 Vedações de opção

Arts. 3º, § 4º, e 17 da LC 123/2006 (sócio PJ, sócio domiciliado no exterior, S/A,
instituições financeiras, débitos sem exigibilidade suspensa, atividades vedadas etc.).
**Implementação:** validar contra a lista dos artigos citados; não reproduzida aqui na íntegra —
o agente deve ler os dois artigos no texto compilado do Planalto e codificar a partir deles.

### 1.11 Distribuição de lucros no Simples (art. 14)

Isentos de IR os valores distribuídos ao titular/sócio, **exceto** pró-labore, aluguéis e serviços
prestados. **Sem escrituração contábil**, a isenção limita-se a: (percentuais do art. 15 da
Lei 9.249/1995 sobre a receita bruta) − (valor devido no Simples). Com escrituração contábil
regular, pode-se distribuir o lucro contábil integral.
Ver §7.4 sobre o conflito com a Lei 15.270/2025 (dividendos > R$ 50 mil/mês).

### 1.12 Proporcionalização do RBT12 no início de atividade

Empresa recém-aberta não tem 12 meses de histórico. A lei não manda esperar: manda proporcionalizar.

**Procedência das transcrições.** As da LC 123/2006 vêm do texto compilado do Planalto. As da
Resolução CGSN 140/2018 vêm de duas fontes independentes conferidas palavra a palavra — o portal
oficial da RFB (`normas.receita.fazenda.gov.br`) estava inacessível do ambiente de desenvolvimento
em 06/08/2026, e isso fica registrado aqui em vez de virar silêncio. **Vale reconferir na fonte
oficial na próxima revisão.** Verificado que os arts. 21 e 22 da Resolução não constam entre os
alterados pela Resolução CGSN 183/2025.

#### Base legal

**LC 123/2006, art. 18, § 2º** (redação da LC 155/2016):

> Em caso de início de atividade, os valores de receita bruta acumulada constantes dos Anexos I a V
> desta Lei Complementar devem ser proporcionalizados ao número de meses de atividade no período.

⚠ Repare no que o § 2º diz de fato: proporcionalizar **os valores das tabelas**. Quem transforma
isso em "média × 12" é a Resolução — a regra operacional não sai da leitura direta da lei.

**Resolução CGSN 140/2018, art. 22:**

> **§ 2º** No caso de início de atividade no próprio ano-calendário da opção pelo Simples Nacional,
> para efeito de determinação da alíquota no 1º (primeiro) mês de atividade, o sujeito passivo
> utilizará, como receita bruta total acumulada, a receita auferida no próprio mês de apuração
> multiplicada por 12 (doze).
>
> **§ 3º** Na hipótese prevista no § 2º, para efeito de determinação da alíquota nos 11 (onze) meses
> posteriores ao do início de atividade, o sujeito passivo utilizará a média aritmética da receita
> bruta total auferida nos meses anteriores ao do período de apuração, multiplicada por 12 (doze).
>
> **§ 4º** Na hipótese de início de atividade em ano-calendário imediatamente anterior ao da opção
> pelo Simples Nacional, o sujeito passivo utilizará:
> I - a regra prevista no § 3º até completar 12 (doze) meses de atividade; e
> II - a regra prevista no § 1º a partir do décimo terceiro mês de atividade.

**Resolução CGSN 140/2018, art. 21, parágrafo único:**

> Apenas para efeito de determinação das alíquotas efetivas, quando a RBT12 de que trata o inciso II
> do caput for igual a zero, considerar-se-á R$ 1,00 (um real).

#### A armadilha: "meses anteriores" ≠ "meses decorridos"

O § 3º manda usar a média dos meses **anteriores ao do período de apuração**. O mês corrente **não
entra**. No 2º mês, a média é a receita do 1º mês sozinha.

Boa parte do material de terceiros descreve a regra como "receita acumulada ÷ meses decorridos × 12",
que inclui o mês corrente e dá **outro número**. Exemplo do teste dourado, Anexo I, série
`[30.000, 90.000]` apurando o 2º mês:

| Leitura | RBT12 | Faixa | Alíquota efetiva |
|---|---|---|---|
| § 3º (correta) — meses anteriores | 360.000 | 2ª | **5,65%** |
| "meses decorridos" (errada) | 720.000 | 3ª | 7,575% |

#### Onde está no código

`simplesNacional.js` → `rbt12InicioAtividade()`, `INICIO_ATIVIDADE`.

O piso de R$ 1,00 do art. 21 é aplicado **só** em `rbt12ParaAliquota`, onde o zero é fato conhecido.
Não é aplicado em `aliquotaEfetiva`, porque ali RBT12 zero quase sempre significa "o usuário não
informou" — e o piso daria alíquota de 1ª faixa a uma empresa de R$ 3 mi.

### 1.13 Limite proporcional de enquadramento no ano de início

⚠ **NÃO CONFUNDIR COM §1.12.** A proporcionalização do §1.12 escolhe a **faixa**. Esta decide se a
empresa **pode continuar no Simples**. Uma sai de "média × 12"; a outra, de "valor fixo por mês ×
meses".

#### Base legal

**LC 123/2006, art. 3º, § 2º:**

> No caso de início de atividade no próprio ano-calendário, o limite a que se refere o caput deste
> artigo será proporcional ao número de meses em que a microempresa ou a empresa de pequeno porte
> houver exercido atividade, inclusive as frações de meses.

**LC 123/2006, art. 3º, § 10** (o efeito, e é o pior deste módulo):

> A empresa de pequeno porte que no decurso do ano-calendário de início de atividade ultrapassar o
> limite proporcional de receita bruta de que trata o § 2º estará excluída do tratamento jurídico
> diferenciado previsto nesta Lei Complementar, bem como do regime de que trata o art. 12 desta Lei
> Complementar, **com efeitos retroativos ao início de suas atividades**.

**LC 123/2006, art. 3º, § 12** (o degrau de 20%):

> A exclusão de que trata o § 10 não retroagirá ao início das atividades se o excesso verificado em
> relação à receita bruta não for superior a 20% (vinte por cento) do respectivo limite referido
> naquele parágrafo, hipótese em que os efeitos da exclusão dar-se-ão no ano-calendário subsequente.

**LC 123/2006, art. 3º, §§ 11 e 13** — regra gêmea para o sublimite de ICMS/ISS: receita acima de
1/12 do sublimite × meses de funcionamento impede o recolhimento de ICMS/ISS pelo Simples, com o
mesmo degrau de 20% definindo se retroage.

**Resolução CGSN 140/2018, art. 3º, caput** — a operacionalização, **com o valor por mês já dado**:

> No ano-calendário de início de atividade, cada um dos limites previstos no § 1º do art. 2º será de
> **R$ 400.000,00** (quatrocentos mil reais), multiplicados pelo número de meses compreendidos entre
> o início de atividade e o final do respectivo ano-calendário, **considerada a fração de mês como
> mês completo**.

**Resolução CGSN 140/2018, art. 3º, § 2º** — os efeitos, na forma operacional:

> I - serão retroativos ao início de atividade se o excesso verificado em relação à receita bruta
> acumulada for superior a 20% (vinte por cento) dos limites previstos no caput;
> II - ocorrerão a partir do ano-calendário subsequente se o excesso verificado em relação à receita
> bruta acumulada não for superior a 20% (vinte por cento) dos limites previstos no caput.

**Resolução CGSN 140/2018, art. 12, § 2º** — sublimite de ICMS/ISS no ano de início:

> No ano-calendário de início de atividade, cada um dos sublimites previstos no caput e § 1º do art.
> 9º será de R$ 150.000,00 (cento e cinquenta mil reais) ou R$ 300.000,00 (trezentos mil reais),
> conforme o caso, multiplicados pelo número de meses compreendidos entre o início de atividade e o
> final do respectivo ano-calendário, considerada a fração de mês como mês completo.

Qual dos dois vale sai do **art. 9º**: R$ 1,8 mi (→ R$ 150.000/mês) é opção do DF e dos Estados com
até 1% do PIB; R$ 3,6 mi (→ R$ 300.000/mês) vale para os demais. **Isso é PARÂMETRO DE ENTRADA
(§9)** — depende da UF e da opção dela para o ano, e o motor não escolhe por ninguém.

#### Valores

| Constante | Valor | Fonte |
|---|---|---|
| Limite por mês de atividade | R$ 400.000,00 | CGSN 140/2018, art. 3º, caput |
| Sublimite ICMS/ISS por mês | R$ 300.000,00 | CGSN 140/2018, art. 12, § 2º |
| Sublimite por mês (UF reduzida) | R$ 150.000,00 | CGSN 140/2018, arts. 9º, caput, e 12, § 2º |
| Tolerância sem retroatividade | 20% | LC 123/2006, art. 3º, §§ 12 e 13 |

#### Por que isto é guarda, e não refinamento

O cenário de falha: empresa aberta em setembro, o simulador diz "o Simples vence", ela opta, e a
receita dos meses de atividade estoura o limite proporcional que ninguém verificou. A consequência
não é pagar um pouco mais — é refazer **todos** os tributos do período pelas normas gerais.

Uma empresa aberta em outubro com R$ 1,5 mi de receita passa folgada no teto de R$ 4,8 mi e estoura
o limite proporcional de R$ 1,2 mi (3 × R$ 400.000) em 25% — acima da tolerância, portanto
retroativo.

#### Observação importante sobre a premissa de receita uniforme

Sob receita mensal uniforme, a receita do período é `(anual ÷ 12) × meses` e o limite é
`400.000 × meses`: os dois crescem juntos, então o limite proporcional **só estoura quando o anual
também estouraria**. Ou seja, com receita uniforme esta guarda não dispara sozinha.

Quem dá dentes a ela é o **detalhamento mês a mês** — a empresa em rampa, que fatura pouco no começo
e muito perto do fim do ano, é justamente a que estoura o proporcional sem parecer grande no total
anual. Por isso a tela sugere ativamente o detalhamento quando o início de atividade é marcado.

#### O que NÃO está coberto (regra 3 do projeto — marcar o não-verificado)

- **CGSN 140/2018, art. 3º, § 3º, I:** para quem abriu no ano-calendário *imediatamente anterior* ao
  da opção, o limite proporcional daquele ano vale para fins de **opção**. Exigiria a receita do ano
  anterior como entrada própria, que a tela não tem. O motor assume que os meses informados caem no
  ano simulado — o que erra para o lado **estrito** (limite menor, aviso a mais), nunca para o lado
  que deixaria passar um estouro.
- **Art. 3º, § 11 aplicado por UF:** o motor calcula o sublimite proporcional, mas não sabe em qual
  UF a empresa está nem qual sublimite ela adotou. É parâmetro.
- **Demais vedações do art. 17** (§1.10) continuam fora do escopo do módulo.

#### Onde está no código

`tabelasFiscais.js` → `LIMITE_PROPORCIONAL_INICIO`;
`simplesNacional.js` → `limiteProporcionalInicioAtividade()`, `podeOptarPorReceita()`;
`CardRegime.jsx` → `AvisoLimiteProporcional` (o gatilho de aviso em 80% do limite é **escolha de
produto**, não regra legal, e por isso mora na tela).

---

## 2. LUCRO PRESUMIDO

### 2.1 Elegibilidade

Receita bruta total no ano-calendário anterior ≤ **R$ 78.000.000,00** (ou R$ 6,5 milhões ×
meses de atividade, quando inferior a 12 meses) — Lei 9.718/1998, art. 13, com redação da
Lei 12.814/2013. Opção definitiva para todo o ano-calendário, manifestada no primeiro
recolhimento. Vedado às obrigadas ao Lucro Real (Lei 9.718/1998, art. 14: bancos, factoring,
lucros do exterior, benefícios fiscais específicos etc.).

### 2.2 Percentuais de presunção — IRPJ (Lei 9.249/1995, art. 15)

| Atividade | Presunção |
|---|---|
| Regra geral: venda de mercadorias, indústria, transporte de cargas, atividade imobiliária, construção por empreitada com emprego integral de materiais, serviços hospitalares/de saúde (com requisitos: sociedade empresária + normas Anvisa) | 8% |
| Revenda, para consumo, de combustível derivado de petróleo, álcool etílico carburante e gás natural | 1,6% |
| Transporte (exceto de cargas) | 16% |
| Serviços em geral com receita bruta anual ≤ R$ 120.000 (exceto profissões regulamentadas, serviços hospitalares e transporte) | 16% |
| Serviços em geral, intermediação de negócios, administração/locação/cessão de bens e direitos, factoring, profissões regulamentadas | 32% |

- Trava dos 16%: se a receita ultrapassar R$ 120.000 no ano, a empresa passa retroativamente a 32%
  e recolhe a diferença (regulamentação: IN RFB 1.700/2017).
- Ganhos de capital, receitas financeiras e demais receitas não operacionais: entram na base
  **integralmente** (100%, sem presunção).

### 2.3 Percentuais de presunção — CSLL (Lei 9.249/1995, art. 20, redação da LC 167/2019)

> ⚠ **REDAÇÃO CORRIGIDA EM 15/08/2026.** A versão anterior desta tabela descrevia a linha de 12%
> como *"Regra geral (comércio, indústria, **transporte de cargas**, hospitalares etc.)"*. Citar só o
> transporte **de cargas** convida a supor que o de **passageiros** seria 32% — e foi exatamente esse
> o defeito que chegou ao motor (`lucroPresumido.js`, `transportePassageiros` com a presunção de
> serviços). **Todo transporte é 12% na CSLL**; o que separa passageiros de cargas é só o IRPJ.
> Conferido no texto compilado oficial da Câmara dos Deputados em **15/08/2026**:
> https://www2.camara.leg.br/legin/fed/lei/1995/lei-9249-26-dezembro-1995-349062-normaatualizada-pl.pdf

⚠ **O art. 20 não traz uma lista de atividades.** Ele faz **duas remissões** ao § 1º do art. 15 e
manda todo o resto para 12%. Ler a tabela como se fosse uma lista de atividades é o que produz o
erro: a pergunta certa nunca é "esta atividade parece um serviço?", é "**em que inciso do § 1º do
art. 15 ela está?**".

| Receita bruta | Presunção | Base legal |
|---|---|---|
| Atividades do **inciso III do § 1º do art. 15**: serviços em geral (exceto hospitalares), intermediação de negócios, administração/locação/cessão de bens imóveis, móveis e direitos, factoring, construção vinculada a contrato de concessão de serviço público | 32% | art. 20, **I** |
| Empresa Simples de Crédito — ESC (**inciso IV do § 1º do art. 15**) | 38,4% | art. 20, **II** |
| **Demais receitas brutas** — comércio, indústria, revenda de combustíveis, serviços hospitalares e **TODO TRANSPORTE, de cargas E de passageiros** (estes no **inciso II do § 1º do art. 15**, que o art. 20 não cita) | **12%** | art. 20, **III** |

Transcrição literal do **art. 20** (redação da LC 167/2019), conferida em 15/08/2026 na fonte acima:

> A base de cálculo da Contribuição Social sobre o Lucro Líquido (CSLL) (…) corresponderá aos
> seguintes percentuais (…): I - 32% (…) para a receita bruta decorrente das atividades previstas
> **no inciso III do § 1º do art. 15** desta Lei; II - 38,4% (…) inciso IV (…); III - **12% (doze por
> cento) para as demais receitas brutas**.

E o **art. 15, § 1º**, que é para onde o art. 20 aponta:

> Nas seguintes atividades, o percentual de que trata este artigo será de: (…) **II - dezesseis por
> cento:** a) para a atividade de prestação de serviços de transporte, **exceto o de carga**, para o
> qual se aplicará o percentual previsto no caput deste artigo; (…) **III - trinta e dois por cento,
> para as atividades de:** a) prestação de serviços em geral, exceto a de serviços hospitalares (…);
> b) intermediação de negócios; c) administração, locação ou cessão de bens imóveis, móveis e
> direitos (…); d) (…) 'factoring'; e) prestação de serviços de construção (…) vinculados a contrato
> de concessão de serviço público

⚠ **TRANSPORTE DE PASSAGEIROS = IRPJ de 16% + CSLL de 12%**, e a assimetria é a regra, não um
descuido de transcrição. A conclusão é mecânica: transporte está no **inciso II** do § 1º do art. 15;
o art. 20 só manda 32% para o **inciso III**; logo transporte cai em "demais receitas brutas" → 12%.
A **única** diferença entre passageiros e cargas está no IRPJ: 16% (inciso II, "a") contra 8%
(caput do art. 15). Ver §2.2.

Onde isso vive no código: `tabelasFiscais.js` → `PRESUNCAO_CSLL.demaisReceitas` (o nome antigo era
`comercioIndustria`, que descrevia uma lista fechada que a lei não tem); `lucroPresumido.js` →
`ATIVIDADES_PRESUMIDO`; caso dourado calculado à mão em `casosDourados.test.js`.

### 2.4 MAJORAÇÃO 2026 — LC 224/2025 (crítico; ausente de material anterior a dez/2025)

Sobre a **parcela da receita bruta anual que exceder R$ 5.000.000,00**, os percentuais de
presunção de IRPJ e CSLL são **majorados em 10% (multiplicativo)**. Exemplos: serviços
32% → 35,2% no excedente; comércio 8% → 8,8% no excedente. Regulamentação:
IN RFB 2.305/2025, alterada pela IN RFB 2.306/2026.

- **IRPJ:** vigência desde 01/01/2026.
- **CSLL:** vigência desde 01/04/2026 (noventena). Por isso, o limite aplicável à CSLL
  em 2026 é de **R$ 3.750.000,00** (¾ do limite anual, proporcional aos 3 trimestres de vigência).
- Empresas com múltiplas atividades: o excedente é rateado proporcionalmente entre as receitas
  de cada atividade antes de aplicar o percentual majorado respectivo.
- Até R$ 5 milhões/ano nada muda. Simples Nacional não é afetado por esta regra.
- Há judicialização em curso (liminares suspendendo a exigência em casos concretos;
  Solução de Consulta COSIT 6/2026 tangencia o tema). O motor de cálculo deve aplicar a regra
  vigente e o produto pode exibir nota sobre a controvérsia — nunca o contrário.

### 2.5 Alíquotas sobre a base presumida

| Tributo | Alíquota | Base legal |
|---|---|---|
| IRPJ | 15% | Lei 9.249/1995, art. 3º |
| Adicional de IRPJ | 10% sobre a parcela da base que exceder R$ 20.000/mês (R$ 60.000/trimestre; R$ 240.000/ano) | Lei 9.249/1995, art. 3º, § 1º |
| CSLL | 9% | Lei 7.689/1988 c/ alterações |

Apuração **trimestral** (Lei 9.430/1996, arts. 1º e 25).

### 2.6 PIS/COFINS — regime cumulativo (obrigatório no Presumido)

| Tributo | Alíquota | Base legal |
|---|---|---|
| PIS/Pasep | 0,65% | Lei 9.715/1998 |
| Cofins | 3,00% | Lei 9.718/1998, art. 8º |

Sobre a receita bruta, **sem direito a créditos**. Total: 3,65%.

### 2.7 Tributos por fora

ISS (municipal) e/ou ICMS (estadual) pelas regras gerais — PARÂMETROS DE ENTRADA (§9).
INSS patronal sobre folha e pró-labore — ver §5.

---

## 3. LUCRO REAL (para fins de comparação no simulador)

| Tributo | Alíquota | Observação | Base legal |
|---|---|---|---|
| IRPJ | 15% + adicional 10% (> R$ 20.000/mês) | sobre o lucro real apurado | Lei 9.249/1995, art. 3º |
| CSLL | 9% | sobre a base ajustada | Lei 7.689/1988 |
| PIS/Pasep | 1,65% | não cumulativo, com créditos | Lei 10.637/2002 |
| Cofins | 7,6% | não cumulativo, com créditos | Lei 10.833/2003 |

**ALERTA DE ESCOPO:** a comparação com Lucro Real depende de dois dados que o sistema NÃO pode
presumir: a **margem real** (lucro contábil/fiscal efetivo) e o **volume de créditos** de
PIS/COFINS sobre insumos. Ambos são entradas do usuário (§9). O simulador pode oferecer análise
de sensibilidade (ex.: "o Real empata com o Presumido quando a margem cai abaixo de X%"), mas
nunca cravar um resultado sem esses inputs. Compensação de prejuízos fiscais limitada a 30% do
lucro (trava do art. 15 da Lei 9.065/1995) — se implementada, citar a fonte no código.

---

## 4. ISS E ICMS

- **ISS:** alíquota municipal entre **2% (piso, EC 37/2002 / LC 157/2016) e 5% (teto, LC 116/2003,
  art. 8º)**. O valor concreto por município/serviço é PARÂMETRO DE ENTRADA.
- **ICMS:** alíquotas internas e interestaduais variam por estado, NCM e operação (ST, DIFAL,
  benefícios). Fora do escopo de cálculo próprio nesta entrega: PARÂMETRO DE ENTRADA por empresa.

---

## 5. ENCARGOS SOBRE FOLHA E PRÓ-LABORE (mínimo necessário para o simulador)

| Item | Valor | Base legal |
|---|---|---|
| CPP — INSS patronal sobre folha e pró-labore | 20% | Lei 8.212/1991, art. 22, I e III |
| INSS do contribuinte individual (sócio, retido sobre o pró-labore) | 11% | Lei 8.212/1991, art. 21 c/ Lei 9.876/1999, observado o teto do RGPS |
| RAT/FAP e terceiros (Sistema S etc.) | variável | PARÂMETRO DE ENTRADA |
| IRRF sobre pró-labore | tabela progressiva mensal do IRPF | PARÂMETRO versionado (tabela muda; a partir de 2026, isenção efetiva até R$ 5.000/mês — Lei 15.270/2025, ver §7) |

Aplicabilidade: Presumido e Real pagam CPP por fora sempre; no Simples a CPP está dentro do DAS,
**exceto Anexo IV** (§1.6). O teto do RGPS (salário-de-contribuição máximo) é reajustado
anualmente por portaria — PARÂMETRO versionado, não constante de código.

Detalhamento completo de encargos pertence à Entrega 7 (DP); aqui entra só o necessário para
comparar regimes e simular Fator R.

---

## 6. REFORMA TRIBUTÁRIA DO CONSUMO — SITUAÇÃO EM 2026 (EC 132/2023, LC 214/2025)

Fase de teste em 2026:

- **CBS 0,9%** (LC 214/2025, art. 346) e **IBS 0,1%** (art. 343), com **destaque obrigatório
  nos documentos fiscais** (NF-e, NFC-e, NFS-e).
- **Dispensa de recolhimento** para quem cumprir as obrigações acessórias (art. 348, § 1º).
  Quem recolher compensa com PIS/Cofins do período; saldo compensável com outros tributos
  federais ou ressarcível em até 60 dias (art. 348).
- **Prazo operacional já vencido:** o Ato Conjunto RFB/CGIBS nº 1/2025 dava tolerância para a
  ausência dos campos IBS/CBS na nota até o 4º mês após os regulamentos (publicados em
  30/04/2026) — a janela terminou em **01/08/2026**. Desde então, nota sem destaque correto
  pode custar a dispensa e gerar cobrança do 1% da fase piloto. O produto deve tratar o
  destaque IBS/CBS como obrigação corrente, não futura.
- PIS/Cofins seguem vigentes e devidos normalmente durante todo o ano de 2026.

Cronograma seguinte (para o roadmap, não para o motor de cálculo desta entrega):
2027 — CBS em alíquota plena e extinção de PIS/Cofins; IBS a 0,05% estadual + 0,05% municipal
(2027–2028, art. 344). 2029–2032 — transição gradual ICMS/ISS → IBS. 2033 — extinção de ICMS e ISS.

O regime do Simples Nacional foi preservado pela EC 132/2023; operacionalização 2026 do Simples
na transição: Resolução CGSN 183/2025 (e LC 227/2026 sobre o Comitê Gestor do IBS).

---

### ⚠⚠ 6.1 ADENDO DE 01/09/2026 — LIDO NO TEXTO OFICIAL, e ele CORRIGE o que está acima

> **Fonte versionada:** `docs/reforma-consumo/` — `lcp214.htm` e `lcp227.htm` do Planalto, baixados
> em 01/09/2026, com SHA-256 no README de lá. **Tudo abaixo é citação de dispositivo, não resumo.**

**⚠⚠ Para o OPTANTE DO SIMPLES, IBS e CBS em 2026 são ZERO.** O parágrafo acima descreve a fase de
teste (IBS 0,1%, art. 343; CBS 0,9%, art. 346) sem dizer a quem ela **não** se aplica:

> **LC 214/2025, art. 348, III, "c":** as alíquotas dos arts. 343 e 346 *"não serão aplicadas em
> relação às operações dos contribuintes optantes pelo Simples Nacional."*

Mostrar qualquer outro número de IBS/CBS para um optante em 2026 é **inventar**. Vale para a tela e
para o PDF do planejamento.

**⚠⚠ Os Anexos I a V da LC 123 com colunas de CBS e IBS existem — e só valem a partir de 2027.**

> **LC 214/2025, art. 519:** *"Os Anexos I a V da Lei Complementar nº 123 (…) passam a vigorar com a
> redação dos Anexos XVIII a XXII desta Lei Complementar."*
> **Art. 544, III** (redação da LC 227/2026): o art. 519 produz efeitos *"a partir de 1º de janeiro
> de 2027"*.

⚠ **Não foi a LC 227/2026 que reescreveu os Anexos** — ela não toca em Anexo nenhum da LC 123.
⚠ **Em 2026 valem os Anexos ANTIGOS**, sem CBS e sem IBS na partilha.
⚠ As **alíquotas nominais e as parcelas a deduzir NÃO mudaram** (Anexo I: 4,00% · 7,30% · 9,50% ·
10,70% · 14,30% · 18,90%). O que mudou foi a **repartição**: `COFINS` + `PIS` deram lugar a `CBS`, e
uma fatia pequena virou `IBS` (Anexo I, 1ª faixa: CBS 15,33% + IBS 0,17% = os 15,50% que eram
COFINS 12,74% + PIS 2,76%).
⚠ **As tabelas ainda NÃO estão no código** — ver a ressalva de extração em `docs/reforma-consumo/`.

**A conta do crédito "por dentro" — exata, sem estimar nada:**

> **LC 123/2006, art. 23, § 1º-A:** o adquirente não optante tem crédito de IBS/CBS *"em montante
> equivalente ao cobrado por meio desse regime único"*.
> **§ 2º:** a alíquota do crédito *"corresponderá aos percentuais de ICMS, IBS e CBS previstos nos
> Anexos I a V (…) para a faixa de receita bruta a que a (…) empresa estiver sujeita no mês de
> operação"*. **§ 3º:** no mês de início de atividade, a **menor** alíquota dos Anexos.

    crédito transferido = alíquota efetiva do Simples × (%CBS + %IBS do Anexo, na faixa)

**A opção "por fora" — e a data que a tela pode anunciar:**

> **LC 214/2025, art. 41, § 3º:** o optante *"poderá exercer a opção de apurar e recolher o IBS e a
> CBS pelo regime regular"*. **§ 5º:** vedado sair do regime regular *"caso tenha recebido
> ressarcimento de créditos desses tributos no ano-calendário corrente ou anterior"*.
> **LC 123/2006, art. 13, § 9º** (incluído pela LC 227/2026): as parcelas de IBS/CBS *"não serão
> cobradas pelo regime único"*. **§ 10** (redação da LC 227/2026): a opção vale para os semestres
> iniciados em **janeiro e julho**, é **irretratável**, e é exercida nos meses de **setembro e
> março** imediatamente anteriores, *"na forma regulamentada pelo CGSN"*.

⚠⚠ A redação **original** da LC 214 dizia *"setembro e **abril**"* e usava outros parágrafos (§ 10 e
§ 11). Quem ler a versão errada anuncia a data errada ao contador.
⚠⚠ **A opção depende de regulamentação do CGSN, e não há prova neste repositório de que ela exista.**
A tela pode dizer qual é a **janela legal**; não pode afirmar que o procedimento está **disponível**.

**A alíquota de referência — quem, quando, e o que sobra para o contador digitar:**

> **Art. 349, § 1º:** o **TCU** envia os cálculos ao **Senado** até **15 de setembro** do ano
> anterior; o **Senado** fixa até **31 de outubro** do ano anterior.
> **Art. 353, § 2º:** em 2026 esses dois prazos são *"prorrogados em 45 (quarenta e cinco) dias"*
> ⇒ TCU até **30/10/2026**, Senado até **15/12/2026**.
> **Art. 349, II:** a alíquota de referência do **IBS** só é fixada *"para os anos de 2029 a 2033"*.

⚠⚠ **Daí sai o que o simulador precisa perguntar, e é UM número, não dois:** para **2027–2028** o
IBS é **conhecido por lei** (0,05% estadual + 0,05% municipal, art. 344) e **só a CBS é
desconhecida**. Um cenário 2027 pede a estimativa da **CBS**, e o PDF imprime que ela não está em
lei.
⚠ Os números que circulam (27,91% / 18,7% / 26,5%) **não estão nesta lei** e não entram no código.

**Fica FORA, com motivo:** as frações de redução de ICMS/ISS de **2029 a 2032** (arts. 501 e 508)
não foram transcritas — sem elas, 2029+ não é calculável, e não se estima.

---

## 7. REFORMA DO IR — LEI 15.270/2025 (sancionada 26/11/2025, efeitos desde 01/01/2026)

Impacta diretamente o núcleo do planejamento (pró-labore × dividendos):

### 7.1 Dividendos — IRRF de 10%

Distribuição de lucros/dividendos de uma mesma PJ a uma mesma PF residente **superior a
R$ 50.000,00 no mês** → retenção na fonte de **10% sobre o total distribuído no mês**
(não só sobre o excedente), sem deduções. Vários pagamentos no mês pela mesma fonte:
recalcula-se a retenção pelo acumulado mensal. O IRRF é antecipação, ajustável na declaração
anual (inclusive contra o IRPFM).

**Regra de transição (grandfathering):** lucros de resultados apurados até o ano-calendário 2025,
com distribuição **aprovada pelo órgão societário até 31/12/2025**, ficam fora da retenção,
com pagamento possível conforme o ato de aprovação (janela 2026–2028 no texto aprovado).
O sistema deve registrar a data de aprovação societária para aplicar (ou não) a retenção.

Remessas de dividendos ao exterior: IRRF de 10% independentemente do valor.

### 7.2 IRPF mínimo (IRPFM)

Rendimentos anuais totais acima de **R$ 600.000** → tributação mínima progressiva, chegando a
**10% para rendimentos ≥ R$ 1.200.000**, com base ampla (inclui isentos e exclusivos) e
mecanismo redutor vinculado à tributação da PJ para evitar sobreposição com IRPJ/CSLL.

### 7.3 Isenção do IRPF até R$ 5.000/mês

Desconto que zera o imposto para rendimentos tributáveis mensais até R$ 5.000 (com redução
parcial na faixa seguinte). Muda o ponto ótimo do pró-labore em muitas simulações.

### 7.4 JCP e conflito com o Simples

- Juros sobre capital próprio: IRRF elevado para **17,5%** (antes 15%).
- **Controvérsia jurídica ativa:** a RFB entende que a retenção de 10% sobre dividendos
  > R$ 50 mil/mês alcança também sócios de optantes do Simples; contribuintes sustentam que a
  isenção do art. 14 da LC 123/2006 (lei complementar) prevalece sobre lei ordinária, e há
  decisões judiciais nos dois sentidos. O motor aplica a regra da RFB por padrão e o produto
  exibe a nota de controvérsia; comportamento alternativo só por configuração explícita.

---

## 8. REGRAS DE IMPLEMENTAÇÃO PARA O AGENTE

1. Todo valor fiscal no código referencia a seção deste documento (comentário `// FONTES_FISCAIS §x.y`).
2. Valores fora deste documento não existem: viram parâmetro (§9) ou a funcionalidade fica fora do escopo.
3. Tabelas e alíquotas em dados versionados por vigência (ex.: `vigencia_inicio`/`vigencia_fim`),
   nunca hardcoded em lógica — 2026 provou que "constante fiscal" não existe (LC 224, Lei 15.270, CBS/IBS).
4. Testes de cálculo devem cobrir: fórmula da alíquota efetiva em cada faixa dos 5 anexos; teto de
   ISS 5% (Anexos III/IV/V, 5ª faixa); Fator R nos limites (27,99% × 28,00%); sublimite de R$ 3,6 mi;
   CPP por fora no Anexo IV; adicional de IRPJ trimestral; majoração LC 224 (limites diferentes
   IRPJ × CSLL em 2026); retenção de dividendos no acumulado mensal e no grandfathering;
   proporcionalização e limite proporcional de início de atividade (§1.12 e §1.13).
5. Toda tela de simulação exibe: data de vigência das tabelas usadas, a premissa de receita
   (uniforme ou série mensal informada) e aviso de que o resultado é simulação de apoio à
   decisão, não parecer tributário. O mesmo vale para o PDF, que circula sem a tela por perto.
6. Verificado em 06/08/2026. Antes de reutilizar este documento em ciclo futuro, reverificar:
   tabela IRPF vigente, teto RGPS, desdobramentos judiciais da LC 224/2025 e do conflito
   Lei 15.270 × Simples, e regulamentação CBS/IBS do ano corrente.

---

## 9. PARÂMETROS DE ENTRADA — NUNCA INFERIR

| Parâmetro | Origem |
|---|---|
| Alíquota de ISS por município/serviço | cadastro da empresa (validar faixa 2%–5%) |
| Alíquotas/regras de ICMS, ST, DIFAL, benefícios estaduais | cadastro da empresa |
| RAT/FAP e alíquota de terceiros | cadastro da empresa (dados do FAP/CNAE preponderante) |
| Mapeamento CNAE → anexo do Simples / sujeição ao Fator R / CNAEs impeditivos | Anexos VI e VII da Resolução CGSN 140/2018, baixados da fonte oficial pela rota `anexoOutros.action` de normas.receita.fazenda.gov.br (Anexo VI verificado em 06/08/2026: http://normas.receita.fazenda.gov.br/sijut2consulta/anexoOutros.action?idArquivoBinario=50966), carregados como dado com fonte, data e versão |
| Margem de lucro real e créditos de PIS/COFINS (comparação c/ Lucro Real) | input do usuário |
| Tabela progressiva IRPF e teto RGPS do ano | dado versionado por vigência |
| Data de aprovação societária de lucros até 2025 (grandfathering §7.1) | input do usuário |
| Sublimite de ICMS/ISS da UF (R$ 3,6 mi ou R$ 1,8 mi) e seu proporcional no ano de início (§1.13) | cadastro da empresa / opção da UF para o ano |
