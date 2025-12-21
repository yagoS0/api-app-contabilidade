import { prisma } from "./prisma.js";

const defaultSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

export class UserRepository {
  static async findByEmail(email) {
    if (!email) return null;
    return prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

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

