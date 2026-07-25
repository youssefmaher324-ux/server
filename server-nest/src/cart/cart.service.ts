import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  get(userId: string) {
    return this.prisma.cartItem.findMany({ where: { userId }, include: { product: true } });
  }

  async upsertItem(userId: string, productId: string, quantity: number) {
    if (quantity <= 0) {
      await this.prisma.cartItem.deleteMany({ where: { userId, productId } });
      return this.get(userId);
    }
    await this.prisma.cartItem.upsert({
      where: { userId_productId: { userId, productId } },
      update: { quantity },
      create: { userId, productId, quantity },
    });
    return this.get(userId);
  }

  async clear(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return { success: true };
  }
}
