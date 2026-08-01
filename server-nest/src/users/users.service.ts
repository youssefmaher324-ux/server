import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { addresses: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const { passwordHash, otpCode, otpExpires, ...safe } = user;
    return safe;
  }

  async updateProfile(userId: string, data: { name?: string; phone?: string }) {
    const user = await this.prisma.user.update({ where: { id: userId }, data });
    const { passwordHash, otpCode, otpExpires, ...safe } = user;
    return safe;
  }

  async getOrders(userId: string, page = 1, pageSize = 20) {
    return this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  // ---- Admin CRUD (GET/POST/PUT/DELETE /api/users) -------------------------

  async listAll(page = 1, pageSize = 50, roleName?: string) {
    const where = roleName ? { role: { name: roleName } } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { role: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map(({ passwordHash, otpCode, otpExpires, ...safe }) => safe),
      total,
      page,
      pageSize,
    };
  }

  /** Admin-created staff/customer account with an email+password login (not the OTP flow). */
  async createByAdmin(data: { name: string; email: string; phone?: string; password: string; roleName: string }) {
    const existing = await this.prisma.user.findFirst({ where: { OR: [{ email: data.email }, ...(data.phone ? [{ phone: data.phone }] : [])] } });
    if (existing) throw new BadRequestException('A user with this email or phone already exists');

    const role = await this.prisma.role.findUnique({ where: { name: data.roleName } });
    if (!role) throw new BadRequestException(`Unknown role: ${data.roleName}`);

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        passwordHash,
        roleId: role.id,
        isEmailVerified: true, // admin-created accounts skip the OTP verification step
      },
    });
    const { passwordHash: _omit, ...safe } = user;
    return safe;
  }

  async updateByAdmin(userId: string, data: { name?: string; email?: string; phone?: string; isActive?: boolean; roleName?: string }) {
    const { roleName, ...rest } = data;
    let roleId: string | undefined;
    if (roleName) {
      const role = await this.prisma.role.findUnique({ where: { name: roleName } });
      if (!role) throw new BadRequestException(`Unknown role: ${roleName}`);
      roleId = role.id;
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data: { ...rest, ...(roleId ? { roleId } : {}) } });
    const { passwordHash, otpCode, otpExpires, ...safe } = user;
    return safe;
  }

  /** Soft delete — deactivates rather than removing, so past orders keep their user reference. */
  async deactivate(userId: string) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    // Revoking every session/refresh token means a deactivated account is
    // actually locked out immediately, not just hidden from new logins.
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { success: true, id: user.id };
  }
}

