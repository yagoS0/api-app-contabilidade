// Multer recusa o multipart antes do handler da rota. Responder JSON aqui evita
// transformar limites de upload em um 500 HTML sem orientação para o contador.
export function uploadNotas(upload, { maxFiles, maxBytes }) {
  return (req, res, next) => upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: "import_upload_files_limit", message: `Envie até ${maxFiles} arquivos por lote, no campo files. Para mais notas, divida os arquivos em lotes ou use ZIP na área de NF-e.` });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "import_upload_file_size", message: `Cada arquivo pode ter até ${Math.floor(maxBytes / 1024 / 1024)} MB. Divida o arquivo e tente novamente.` });
    }
    return next(err);
  });
}
