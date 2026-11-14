import { interpretarRespostaDas } from "../modules/fiscal/public.js";
import { lerTextoPdfDas } from "../modules/fiscal/infrastructure/documentos/lerTextoPdfDas.js";

export function interpretarRespostaDasComPdf(input) {
  return interpretarRespostaDas(input, { lerTextoPdfDas });
}
