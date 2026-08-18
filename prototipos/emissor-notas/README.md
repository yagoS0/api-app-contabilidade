# Protótipo — Emissor de Notas

⚠ **ISTO NÃO É O APP.** É um protótipo navegável de UX, em HTML/CSS/JS puro, **sem build e sem
backend**. Abra `index.html` no navegador; não há `npm install`, não há servidor.

## Por que fora de `apps/web`

`apps/web` é React 19 + Vite. Este protótipo é `<script>` solto por decisão do plano ("sem
framework, sem build"). Misturá-los faria o Vite tentar processar estes arquivos e o Jest tentar
testá-los. Aqui ele não toca em nada do app real.

## ⚠ NADA AQUI EMITE COISA ALGUMA

`emitirNota()` é uma `Promise` com `setTimeout` que sorteia sucesso (90%) ou rejeição (10%) de um
dicionário fixo de erros. **Nenhuma chamada a prefeitura, SEFAZ, ADN, SERPRO ou à nossa própria
API.** Os CNPJs dos mocks são fabricados.

## Divergências conhecidas contra o portal (decisão do dono)

| | protótipo | portal hoje |
|---|---|---|
| paleta | CLARA (`--bg: #f6f7f9`), como o plano manda | ESCURA (`--bg-page: #1A1B26`) |
| `rascunho` | existe no vocabulário | o dono já disse *"não existe rascunho"* (era sobre lançamento) |
| recorrências | mock completo | **não existem** no projeto — sem model, sem scheduler |

## Estado das fases

- [x] Fase 0 — esqueleto, tokens, roteador, mocks
- [x] Fase 1 — notas avulsas
- [ ] Fase 2 — clientes e serviços
- [ ] Fase 3 — recorrências
- [ ] Fase 4 — lotes
- [ ] Fase 5 — painel e polimento
