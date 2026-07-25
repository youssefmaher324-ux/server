import { Injectable, NotFoundException } from '@nestjs/common';
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
    return this.prisma.user.update({ where: { id: userId }, data });
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
}
