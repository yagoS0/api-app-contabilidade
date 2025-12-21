import { Router } from "express";

export function createClientsRouter({ ensureAuthorized, validateClientPayload, ClientRepository, log }) {
  const router = Router();

  router.post("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res))) return;
    const validation = validateClientPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      const created = await ClientRepository.createClientWithCompany(validation.data);
      res.status(201).json(created);
    } catch (err) {
      log.error({ err }, "Falha ao cadastrar cliente");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res))) return;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    try {
      const result = await ClientRepository.listClients({ limit, offset });
      res.json(result);
    } catch (err) {
      log.error({ err }, "Falha ao listar clientes");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:id", async (req, res) => {
    if (!(await ensureAuthorized(req, res))) return;
    try {
      const client = await ClientRepository.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "not_found" });
      }
      res.json(client);
    } catch (err) {
      log.error({ err, id: req.params.id }, "Falha ao buscar cliente");
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

