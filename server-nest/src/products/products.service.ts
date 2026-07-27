import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async list(params: { categoryId?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 50, 100);
    const where = { available: true, ...(params.categoryId ? { categoryId: params.categoryId } : {}) };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: { category: true, inventory: true },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { category: true, inventory: true } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(data: { name: string; nameAr?: string; description?: string; price: number; categoryId?: string; imageUrl?: string; available?: boolean }) {
    return this.prisma.product.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; description: string; price: number; categoryId: string; imageUrl: string; available: boolean }>) {
    return this.prisma.product.update({ where: { id }, data });
  }

  async remove(id: string) {
    // Soft delete pattern: mark unavailable instead of hard delete so past
    // order_items referencing this product keep their history intact.
    return this.prisma.product.update({ where: { id }, data: { available: false } });
  }
}
