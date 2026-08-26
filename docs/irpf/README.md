# IRPF e teto do INSS — artefatos oficiais versionados

Mesma regra de `docs/lc116/`, `docs/lista-servico-nacional/` e `docs/leiaute-nfse/`: número de
imposto **não se transcreve de memória** — a página oficial entra no repositório com URL, data,
tamanho e SHA-256, e o código é **gerado** por um script que **aborta** na divergência.

## O que está aqui

| Arquivo | Origem | Baixado em |
|---|---|---|
| `rfb-tabelas-2026.html` | `https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026` | 2026-08-25 |
| `inss-tabela-contribuicao-2026.html` | `https://www.gov.br/inss/pt-br/direitos-e-deveres/inscricao-e-contribuicao/tabela-de-contribuicao-mensal` | 2026-08-25 |

- IRPF: 177.997 bytes, SHA-256 `473649f0edef1d370e29afc63ec2e372391272d2e3d53de0dc0a1274ada91985`
- INSS: 283.529 bytes, SHA-256 `59f669fe4edd969e532534cbcc17fc20bc6568f8abecc864ff3b05c14a70875d`

Gerador: `node apps/api/scripts/gerar-tabelas-pessoa-fisica.mjs` →
`apps/web/src/features/planejamento/lib/tabelasPessoaFisica.data.js`

## ⚠⚠ Por que estes números passaram a existir — e o que continua fora

`tabelasFiscais.js` dizia, e **continua dizendo para o resto**:

> "RAT/FAP, terceiros, tabela do IRPF e teto do RGPS são PARÂMETRO DE ENTRADA (§9) — variam por
> CNAE, por FAP da empresa e por portaria anual. Não têm valor aqui de propósito."

A recusa segue **certa para RAT/FAP e contribuições a terceiros**: eles variam por CNAE e pelo FAP
de **cada empresa** — são cadastro, não tabela anual, e não entram.

O que mudou é que **IRPF e teto do RGPS não variam por empresa** — variam por **ano**. E um valor
com **vigência datada, fonte oficial e hash** é o oposto de um número chutado. Eles existem para
uma pergunta só: *quanto custa ao sócio subir o pró-labore até o Fator R alcançar 28%* — a conta
que o dono nomeou como a mais valiosa do produto.

⚠ **A vigência vai à tela.** Tabela de pessoa física sem data impressa envelhece calada, e o número
velho é indistinguível do certo.

## ⚠⚠ A armadilha do PDF da portaria — e por que a fonte do INSS é a página, não ela

A **Portaria Interministerial MPS/MF nº 13, de 9/01/2026** é a norma que fixa o teto. O PDF dela
(`https://www.gov.br/previdencia/pt-br/assuntos/rpps/documentos/PortariaInterministerialMPSMF13de9dejaneirode2026.pdf`,
1.452.589 bytes, SHA-256 `94d3a9adda05c9463bde8bf89dba5756fe9885aba92858064062123f51bfd634`)
foi baixado e **é um documento DIGITALIZADO**: 4 páginas, **8 caracteres** de texto extraível.

Sem OCR não há como tirar valor dele por programa, e transcrever à mão o que um resumo de busca
disse seria exatamente o que a regra 1 proíbe. Por isso a fonte usada é a **página do próprio
INSS**, que é HTML, extraível e primária. ⚠ O PDF **não** foi versionado: um artefato do qual não se
extrai nada não é fonte, é anexo — e um hash ao lado de um arquivo ilegível dá aparência de prova.

## ⚠⚠ As duas provas do gate — e nenhuma delas é "os números parecem certos"

**1. A fórmula do redutor tem de fechar nos DOIS extremos.** A Receita publica a regra da
Lei 15.270/2025 em duas formas: uma faixa isenta ("até R$ 312,89 de redução, de modo que o imposto
devido seja zero") e uma fórmula linear para a faixa seguinte
(`R$ 978,62 − 0,133145 × rendimentos`). As duas têm de se encontrar:

| ponto | conta | resultado |
|---|---|---|
| fim da faixa isenta (R$ 5.000,00) | `978,62 − 0,133145 × 5.000` | **312,89** ✓ = a redução máxima anunciada |
| fim da faixa parcial (R$ 7.350,00) | `978,62 − 0,133145 × 7.350` | **0,0042** ✓ ≈ zero |

Uma constante ou um fator transcritos errados quebram um dos dois. Sem esta prova, a única checagem
possível seria olhar e achar que está certo.

**2. O teto e o piso do INSS conferem contra a faixa de 20% da própria página.** Ela anuncia a
contribuição de 20% "entre R$ 324,20 e R$ 1.695,11" — e `0,20 × 1.621,00 = 324,20` e
`0,20 × 8.475,55 = 1.695,11`. Quatro números que só fecham juntos se os quatro estiverem certos.

⚠ E as tabelas são achadas pelo **cabeçalho**, não pela posição: a página do IRPF tem **dez**
tabelas (mensal, anual, PLR, ganho de capital, JCP…), e "a primeira" quebraria na próxima
reorganização do portal — em silêncio. A mensal é distinguida da anual pelo **menor teto**, não pela
ordem.

## O que a simulação de pró-labore assume — e onde ela RECUSA

⚠⚠ **A premissa que decide o resultado:** nos anexos **I, II, III e V** do Simples a contribuição
patronal está **DENTRO do DAS** (LC 123/2006, art. 13, VI), e o DAS incide sobre a **receita**, não
sobre a folha. Logo, subir o pró-labore **não** custa 20% de CPP à empresa — o custo extra é só do
**sócio** (INSS retido + IRRF). É isso que torna a manobra atraente.

⚠ **No Anexo IV a conta não vale**, e a função **recusa** em vez de calcular errado: lá a CPP fica
**fora** do DAS (art. 18, § 5º-C), e cada real de pró-labore custa 20% à empresa por cima.

⚠ Fora da conta, sempre nomeado no resultado: RAT/FAP e terceiros, 13º pró-labore, dependentes e
outras deduções do sócio, e o **efeito previdenciário** (o benefício futuro do sócio sobe junto).
