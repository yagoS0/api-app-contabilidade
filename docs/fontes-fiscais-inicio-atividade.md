# FONTES FISCAIS — adendo: início de atividade (§1.9 e §1.10)

> ⚠ **ISTO É UM ADENDO, NÃO UM SEGUNDO DOCUMENTO DE FONTES.** O documento FONTES FISCAIS é o do
> dono, e é ele que `tabelasFiscais.js` cita seção a seção. As duas seções abaixo nasceram aqui
> porque a regra de início de atividade **não está transcrita** naquele documento, e o contrato do
> projeto é que todo valor no código aponte para uma seção com citação. **Ao incorporar ao documento
> mestre, estas seções devem ser movidas para lá e este arquivo apagado** — enquanto os dois
> existirem, há duas fontes para a mesma coisa, que é exatamente o que o contrato evita.
>
> Numeração escolhida para encaixar: §1 é o Simples Nacional e vai até §1.8 (Fator R).
>
> **Conferido em 06/08/2026.** As transcrições da LC 123/2006 vêm do texto compilado do Planalto.
> As da Resolução CGSN 140/2018 vêm de duas fontes independentes conferidas palavra a palavra — o
> portal oficial da RFB (`normas.receita.fazenda.gov.br`) estava inacessível do ambiente de
> desenvolvimento, e isso fica registrado aqui em vez de virar silêncio. **Vale reconferir na fonte
> oficial na próxima revisão.** Verificado que os arts. 21 e 22 da Resolução não constam entre os
> alterados pela Resolução CGSN 183/2025.

---

## §1.9 — RBT12 proporcionalizado em início de atividade

Empresa recém-aberta não tem 12 meses de histórico. A lei não manda esperar: manda proporcionalizar.

### Base legal

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

### A armadilha: "meses anteriores" ≠ "meses decorridos"

O § 3º manda usar a média dos meses **anteriores ao do período de apuração**. O mês corrente **não
entra**. No 2º mês, a média é a receita do 1º mês sozinha.

Boa parte do material de terceiros descreve a regra como "receita acumulada ÷ meses decorridos × 12",
que inclui o mês corrente e dá **outro número**. Exemplo do teste dourado, Anexo I, série
`[30.000, 90.000]` apurando o 2º mês:

| Leitura | RBT12 | Faixa | Alíquota efetiva |
|---|---|---|---|
| § 3º (correta) — meses anteriores | 360.000 | 2ª | **5,65%** |
| "meses decorridos" (errada) | 720.000 | 3ª | 7,575% |

### Onde está no código

`simplesNacional.js` → `rbt12InicioAtividade()`, `INICIO_ATIVIDADE`.

O piso de R$ 1,00 do art. 21 é aplicado **só** em `rbt12ParaAliquota`, onde o zero é fato conhecido.
Não é aplicado em `aliquotaEfetiva`, porque ali RBT12 zero quase sempre significa "o usuário não
informou" — e o piso daria alíquota de 1ª faixa a uma empresa de R$ 3 mi.

---

## §1.10 — Limite proporcional de receita no ano-calendário de início

⚠ **NÃO CONFUNDIR COM §1.9.** A proporcionalização do §1.9 escolhe a **faixa**. Esta decide se a
empresa **pode continuar no Simples**. Uma sai de "média × 12"; a outra, de "valor fixo por mês ×
meses".

### Base legal

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

### Valores

| Constante | Valor | Fonte |
|---|---|---|
| Limite por mês de atividade | R$ 400.000,00 | CGSN 140/2018, art. 3º, caput |
| Sublimite ICMS/ISS por mês | R$ 300.000,00 | CGSN 140/2018, art. 12, § 2º |
| Sublimite por mês (UF reduzida) | R$ 150.000,00 | CGSN 140/2018, arts. 9º, caput, e 12, § 2º |
| Tolerância sem retroatividade | 20% | LC 123/2006, art. 3º, §§ 12 e 13 |

### Por que isto é guarda, e não refinamento

O cenário de falha: empresa aberta em setembro, o simulador diz "o Simples vence", ela opta, e a
receita dos meses de atividade estoura o limite proporcional que ninguém verificou. A consequência
não é pagar um pouco mais — é refazer **todos** os tributos do período pelas normas gerais.

Uma empresa aberta em outubro com R$ 1,5 mi de receita passa folgada no teto de R$ 4,8 mi e estoura
o limite proporcional de R$ 1,2 mi (3 × R$ 400.000) em 25% — acima da tolerância, portanto
retroativo.

### Observação importante sobre a premissa de receita uniforme

Sob receita mensal uniforme, a receita do período é `(anual ÷ 12) × meses` e o limite é
`400.000 × meses`: os dois crescem juntos, então o limite proporcional **só estoura quando o anual
também estouraria**. Ou seja, com receita uniforme esta guarda não dispara sozinha.

Quem dá dentes a ela é o **detalhamento mês a mês** — a empresa em rampa, que fatura pouco no começo
e muito perto do fim do ano, é justamente a que estoura o proporcional sem parecer grande no total
anual. Por isso a tela sugere ativamente o detalhamento quando o início de atividade é marcado.

### O que NÃO está coberto (rule 3 — marcar o não-verificado)

- **CGSN 140/2018, art. 3º, § 3º, I:** para quem abriu no ano-calendário *imediatamente anterior* ao
  da opção, o limite proporcional daquele ano vale para fins de **opção**. Exigiria a receita do ano
  anterior como entrada própria, que a tela não tem. O motor assume que os meses informados caem no
  ano simulado — o que erra para o lado **estrito** (limite menor, aviso a mais), nunca para o lado
  que deixaria passar um estouro.
- **Art. 3º, § 11 aplicado por UF:** o motor calcula o sublimite proporcional, mas não sabe em qual
  UF a empresa está nem qual sublimite ela adotou. É parâmetro.
- **Demais vedações do art. 17** (atividade, sócios, débitos) continuam fora do escopo do módulo.

### Onde está no código

`tabelasFiscais.js` → `LIMITE_PROPORCIONAL_INICIO`;
`simplesNacional.js` → `limiteProporcionalInicioAtividade()`, `podeOptarPorReceita()`;
`CardRegime.jsx` → `AvisoLimiteProporcional` (o gatilho de aviso em 80% do limite é **escolha de
produto**, não regra legal, e por isso mora na tela).
