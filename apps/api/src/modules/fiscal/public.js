export { interpretarRespostaDas } from "./application/interpretarRespostaDas.js";
export { exigirDespachoPgdasFs12Permitido } from './domain/guardaPgdasFs12.js';
export { persistirDocumentoDas } from "./application/persistirDocumentoDas.js";
// Compatibilidade dos consumidores legados e scripts de diagnóstico.
export { extractDocumentNumber, parsePossibleDate } from "./domain/interpretacaoDas.js";
