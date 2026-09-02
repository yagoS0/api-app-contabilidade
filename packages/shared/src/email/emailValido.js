// A VALIDAÇÃO DE E-MAIL — uma só, para as três camadas.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ O DEFEITO (relatado pelo dono, 30/08/2026: *"aviso de e-mail errado"*)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// O MESMO campo era julgado por TRÊS regras que discordam:
//
// | camada | `a@b.c` | `joão@empresa.com.br` | `a@b` |
// |---|---|---|---|
// | HTML5 `type="email"` (`renderCompanyForm.jsx`) | aceita | **RECUSA** | **aceita** |
// | Zod v4 `.email()` (`companySchemas.js`)        | **RECUSA** (TLD ≥ 2) | **RECUSA** | recusa |
// | regex do backend (`companyProfile.js`)         | aceita | **aceita** | recusa |
//
// Ou seja: um endereço com acento — normal no Brasil — passava numa camada e era recusado nas
// outras, e o contador via "e-mail inválido" num valor que o servidor aceitaria.
//
// **Decisão do dono, 30/08/2026: a do SERVIDOR vira a única** — a mais permissiva.
//
// ⚠ Isto NÃO afrouxa validação fiscal. E-mail não é campo fiscal: ele endereça uma mensagem, não
// declara nada ao fisco. E, sendo a mais permissiva das três, **nenhum cadastro que hoje salva
// passa a falhar** — o risco fica todo do outro lado, o de escolher a mais restritiva sem antes
// contar quantos endereços gravados ela reprovaria.
//
// ⚠ O que ela PROVA: que o texto é bem formado. Não prova que a caixa existe, nem que é da pessoa.

/**
 * A regra, literalmente a que `companyProfile.js` sempre aplicou:
 * algo, arroba, algo, ponto, algo — sem espaço em nenhum dos três.
 *
 * ⚠ Ela aceita acento porque **não restringe o alfabeto**. Foi por restringi-lo que o Zod v4
 * recusava `joão@…`, e o HTML5 idem.
 */
const FORMA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * O e-mail é bem formado?
 *
 * ⚠ VAZIO É `false`, e quem decide se vazio importa é o chamador. "Opcional" é decisão de campo
 * (`.or(z.literal(""))`, `omitIfEmpty`), não de formato — misturar as duas aqui faria um campo
 * obrigatório aceitar branco em silêncio.
 */
export function emailValido(valor) {
  return FORMA.test(String(valor ?? "").trim());
}

/**
 * A forma normalizada para gravar/comparar: sem espaço nas pontas, minúscula.
 *
 * ⚠ É a mesma normalização que `companyProfile.asString().toLowerCase()` já fazia. Ela existe
 * aqui para que os dois lados comparem a MESMA string — foi comparar formas diferentes que fez
 * `acharContatoPorWaId` escolher o contato errado, noutra parte deste projeto.
 */
export function normalizarEmail(valor) {
  return String(valor ?? "").trim().toLowerCase();
}
