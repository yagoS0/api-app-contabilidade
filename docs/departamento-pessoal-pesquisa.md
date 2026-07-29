# Departamento Pessoal — pesquisa (adiado)

O módulo saiu do Lote F por decisão do dono, para outro momento. Este documento guarda o que já foi
pesquisado e decidido, para o assunto não recomeçar do zero.

**Decisões do dono (28/07/2026):**
- **A Nasajon calcula a folha e transmite o eSocial.** Nós alimentaríamos. Não construir motor de
  folha — errar INSS/IRRF/FGTS é passivo trabalhista, e ele já tem quem calcule.
- **Ponto: os dois** — importar de quem já tem relógio/app, e marcação própria para quem não tem.

## Duas descobertas que travam etapas

**1. O layout de importação da Nasajon é definido por ela.** O sistema de origem precisa gerar
exatamente naquele formato; não dá para deduzir. A especificação precisa ser obtida antes de
escrever qualquer exportador. Sem ela, não se escreve um formato "provável" — arquivo de folha
aceito com layout errado vira dado trabalhista errado no sistema que calcula.

**2. Marcação de ponto própria cai na Portaria 671 (REP-P)** e as exigências são legais, não de
código. Detalhado abaixo.

---

## Portaria 671/2021 — REP-P

Fonte: *Perguntas e Respostas — Portaria nº 671/2021*, Ministério do Trabalho e Emprego
([gov.br](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/fiscalizacao-do-trabalho/Perguntas%20e%20Respostas%20REP)).

### Respostas diretas

| Pergunta | Resposta |
|---|---|
| O trabalhador pode bater ponto pelo **próprio celular**? | **Sim.** A portaria define o REP-P por software e "coletores de marcações" (art. 4º, III), sem restringir o aparelho. **Mas** obrigar o empregado a usar o celular dele transfere custo e invade privacidade — é fonte de litígio. O certo é oferecer, não impor. |
| Pode ler **QR code** e gravar a localização? | Sim, como *dado da marcação*. O QR é a interface; o que vale juridicamente é o registro gerado. |
| Pode usar **reconhecimento facial**? | Permitido, mas biometria é **dado pessoal sensível** na LGPD: exige base legal específica, aviso claro ao trabalhador e proteção bem mais pesada. É o caminho de maior risco e custo. |
| Pode **bloquear** a marcação fora do horário ou do local? | **Não.** A portaria exige marcações "fidedignas à realidade fática". Bloquear quem está fora do cerco é falsificar o registro. |

**A consequência de desenho está nessa última linha, e é contraintuitiva:** geolocalização, foto e
QR code são **prova anexada à marcação**, nunca **permissão para marcar**. Funcionário que bate
ponto a 3 km da empresa deve ser **registrado e sinalizado** — quem decide é o gestor, depois. Um
sistema que impede a marcação cria exatamente o passivo que deveria evitar.

### O que a lei exige

1. **Registro do software no INPI** (art. 91) — certificado de programa de computador. Não é
   homologação de hardware, mas é processo com prazo próprio.
2. **AFD (Arquivo Fonte de Dados)** — registro **bruto e imutável** de toda marcação, na ordem em
   que aconteceu. Só o REP gera o AFD para efeitos fiscais e legais.
3. **AEJ (Arquivo Eletrônico de Jornada)** — o arquivo tratado, que substituiu AFDT e ACJEF.
4. **Assinatura eletrônica padrão CAdES com certificado ICP-Brasil** no AFD e no comprovante.
5. **Comprovante ao trabalhador** — não precisa ser emitido na hora **se** ele tiver acesso
   eletrônico após cada marcação, sem precisar pedir, e puder extrair as marcações das **últimas
   48h** no mínimo.

### O que o projeto já tem a favor

- Item 4: já lidamos com **certificado ICP-Brasil** (`CertStorage`, cert A1 por empresa, mTLS no
  SERPRO). A infraestrutura de assinatura não parte do zero.
- Item 5: o **app do cliente** (`portal-cliente-app`) já existe e autentica o usuário final.
- Item 2: o **ledger append-only** de notas (`application/notas/ledger/`) foi construído com
  exatamente essa semântica — registro imutável, correção via novo registro, projeção recalculável.
  É o mesmo problema do AFD.

### Conclusão prática

**Enquanto o ponto vier do relógio certificado do cliente, nós não somos o REP** — só processamos o
dado, e nada disso se aplica. No dia em que a marcação for nossa, INPI e assinatura CAdES viram
pré-requisito, não detalhe.

---

## eSocial — prazos que importariam

Como a Nasajon transmitiria, nosso valor seria **avisar antes**:
- **S-2200 (admissão):** até **um dia antes** do início das atividades.
- **S-1200/S-1210 (remuneração/pagamentos):** até o **dia 15 do mês seguinte**.

Ambos caberiam como linhas no calendário fiscal do Lote F.

---

## Esboço que estava desenhado

- **`Funcionario`**: `portalClientId`, `nome`, `cpf`, `matricula`, `cargo`, `admissaoEm`,
  `desligamentoEm?`, `salarioBase`, `jornadaSemanal`, `dadosEsocial` (Json), `ativo`.
- **`PontoRegistro`**: `funcionarioId`, `data`, `marcacoes` (Json), `origem`
  (IMPORTADO|APP|MANUAL), `competencia`.
- **`PontoFechamento`**: por funcionário e competência — horas normais, extras, faltas, DSR.
- Importação de ponto com **mapeamento de colunas configurável**: cada relógio exporta diferente, e
  assumir um formato só garante que metade dos clientes não consegue usar. Molde:
  `renderImportExcelModal.jsx`.
