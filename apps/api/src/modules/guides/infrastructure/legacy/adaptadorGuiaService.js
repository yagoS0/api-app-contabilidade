// Ligação restrita à composição: não reexportar por guides/public.js,
// pois GuideService já depende daquele ponto público.
export {
  createOrUpdateGuideFromProcessing,
  hashPdf,
} from "../../../../application/guides/GuideService.js";
