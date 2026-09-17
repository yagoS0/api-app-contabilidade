import express from "express";
import request from "supertest";
import multer from "multer";
import { uploadNotas } from "../middlewares/uploadNotas.js";

jest.mock("../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { createPortalInvoicesRouter } from "../portalInvoices.js";

test.each([["nfe", 20], ["xml", 50]])("rota %s recusa excesso de arquivos com orientação, antes de gravar", async (rota, limite) => {
  const app = express();
  const ensureAuthorized = jest.fn();
  app.use("/clients/:clientId/invoices", createPortalInvoicesRouter({ ensureAuthorized, log: {} }));
  let envio = request(app).post(`/clients/teste/invoices/import/${rota}`);
  for (let i = 0; i <= limite; i++) envio = envio.attach("files", Buffer.from("<nota/>"), `${i}.xml`);
  const res = await envio;
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ error: "import_upload_files_limit", message: expect.stringContaining(`até ${limite} arquivos`) });
  expect(ensureAuthorized).not.toHaveBeenCalled();
});

test("arquivo grande recebe 413 legível e nenhum processamento", async () => {
  const app = express();
  const processar = jest.fn((req, res) => res.json({ ok: true }));
  app.post("/import", uploadNotas(multer({ limits: { fileSize: 8 } }).array("files", 20), { maxFiles: 20, maxBytes: 1024 * 1024 }), processar);
  const res = await request(app).post("/import").attach("files", Buffer.from("arquivo maior que oito bytes"), "nota.xml");
  expect(res.status).toBe(413);
  expect(res.body.message).toContain("até 1 MB");
  expect(processar).not.toHaveBeenCalled();
});
