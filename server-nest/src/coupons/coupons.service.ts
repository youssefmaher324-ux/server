import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CouponsService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async validate(code: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon || !coupon.isActive) throw new NotFoundException('Invalid coupon');
    return coupon;
  }

  create(data: { code: string; type: string; value: number; minOrderValue?: number; maxUses?: number; activeFrom?: string; activeUntil?: string }) {
    return this.prisma.coupon.create({
      data: {
        ...data,
        activeFrom: data.activeFrom ? new Date(data.activeFrom) : undefined,
        activeUntil: data.activeUntil ? new Date(data.activeUntil) : undefined,
      },
    });
  }

  update(id: string, data: any) {
    return this.prisma.coupon.update({ where: { id }, data });
  }

  remove(id: string) {
    return this.prisma.coupon.update({ where: { id }, data: { isActive: false } });
  }
}
