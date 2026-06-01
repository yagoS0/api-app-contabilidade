import { prisma } from "./prisma.js";

// Q8.A.5: select canônico que omite `passwordHash`. SEMPRE usar este (ou equivalente)
// quando o resultado for retornado ao cliente HTTP. `findByEmail`/`findById` abaixo
// retornam o User INTEIRO porque a verificação de senha exige `passwordHash` — esses
// resultados NUNCA devem ser serializados direto no response.
export const safeUserSelect = Object.freeze({
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  accountType: true,
  createdAt: true,
  updatedAt: true,
});

const defaultSelect = safeUserSelect;

export class UserRepository {
  /**
   * Retorna o User com `passwordHash` — usar APENAS para verificação de senha em AuthService.
   * NUNCA passar o resultado direto pra res.json(). Sempre passar por `serializeUser` antes.
   */
  static async findByEmail(email) {
    if (!email) return null;
    return prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  /**
   * Retorna o User com `passwordHash`. Mesma regra: nunca serializar raw para o cliente.
   */
  static async findById(id) {
    if (!id) return null;
    return prisma.user.findUnique({
      where: { id },
    });
  }

  static async createPending({ name, email, passwordHash }) {
    return prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
        status: "pending",
        role: "user",
      },
      select: defaultSelect,
    });
  }

  static async listByStatus(status) {
    const where = status ? { status } : {};
    return prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: defaultSelect,
    });
  }

  static async updateUser(id, data) {
    return prisma.user.update({
      where: { id },
      data,
      select: defaultSelect,
    });
  }

  static async deleteUser(id) {
    return prisma.user.delete({
      where: { id },
      select: defaultSelect,
    });
  }
}

