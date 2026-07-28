import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';

const CANCELLATION_WINDOW_MINUTES = 5;

interface CreateOrderInput {
  userId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  items: { productId: string; quantity: number }[];
  couponCode?: string;
  notes?: string;
  branchId?: string;
  paymentMethod?: string; // cash | card | wallet — defaults to 'cash'
}

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private payments: PaymentsService,
  ) {}

  async create(input: CreateOrderInput) {
    if (!input.items?.length) throw new BadRequestException('Order must include at least one item');

    return this.prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) } } });
      const productMap = new Map(products.map((p) => [p.id, p]));

      let subtotal = 0;
      const orderItemsData = input.items.map((item) => {
        const product = productMap.get(item.productId);
        if (!product || !product.available) throw new BadRequestException(`Product unavailable: ${item.productId}`);
        const unitPrice = Number(product.price);
        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;
        return {
          productId: product.id,
          nameSnapshot: product.name,
          unitPrice,
          quantity: item.quantity,
          lineTotal,
        };
      });

      let discountTotal = 0;
      let couponId: string | undefined;
      if (input.couponCode) {
        const coupon = await tx.coupon.findUnique({ where: { code: input.couponCode } });
        if (!coupon || !coupon.isActive) throw new BadRequestException('Invalid coupon code');
        if (coupon.activeUntil && coupon.activeUntil < new Date()) throw new BadRequestException('Coupon has expired');
        if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) throw new BadRequestException('Coupon usage limit reached');
        if (coupon.minOrderValue && subtotal < Number(coupon.minOrderValue)) {
          throw new BadRequestException(`Order must be at least ${coupon.minOrderValue} to use this coupon`);
        }
        discountTotal = coupon.type === 'percentage' ? subtotal * (Number(coupon.value) / 100) : Number(coupon.value);
        discountTotal = Math.min(discountTotal, subtotal);
        couponId = coupon.id;
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
      }

      const total = subtotal - discountTotal;
      const verificationCode = crypto.randomInt(1000, 9999).toString();
      const now = new Date();

      const order = await tx.order.create({
        data: {
          userId: input.userId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
          branchId: input.branchId,
          subtotal,
          discountTotal,
          total,
          couponId,
          verificationCode,
          notes: input.notes,
          cancellationDeadline: new Date(now.getTime() + CANCELLATION_WINDOW_MINUTES * 60 * 1000),
          items: { create: orderItemsData },
        },
        include: { items: true },
      });

      // Decrement inventory where tracked.
      for (const item of input.items) {
        await tx.inventory.updateMany({
          where: { productId: item.productId },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      await this.payments.createPending(tx, order.id, total, input.paymentMethod || 'cash');

      await this.audit.log({ userId: input.userId, action: 'order.create', entityType: 'order', entityId: order.id });
      return order;
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true, driver: true, coupon: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getTracking(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, status: true, driver: { select: { name: true, phone: true, currentLat: true, currentLng: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** Customer-initiated cancellation — only allowed within the cancellation window and before dispatch. */
  async cancel(id: string, requesterUserId?: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    if (requesterUserId && order.userId && order.userId !== requesterUserId) {
      throw new ForbiddenException('You can only cancel your own orders');
    }
    if (order.status === 'cancelled') throw new BadRequestException('Order already cancelled');
    if (['out_for_delivery', 'delivered'].includes(order.status)) {
      throw new BadRequestException('Order can no longer be cancelled');
    }
    if (!order.cancellationDeadline || order.cancellationDeadline < new Date()) {
      throw new BadRequestException('Cancellation window has passed');
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await this.audit.log({ userId: requesterUserId, action: 'order.cancel', entityType: 'order', entityId: id });
    return updated;
  }

  /** Staff-only status transition (confirmed -> preparing -> out_for_delivery -> delivered). */
  async updateStatus(id: string, status: string, actorUserId?: string) {
    const order = await this.prisma.order.update({ where: { id }, data: { status } });
    await this.audit.log({ userId: actorUserId, action: 'order.status_update', entityType: 'order', entityId: id, metadata: { status } });
    return order;
  }

  async assignDriver(id: string, driverId: string, actorUserId?: string) {
    const order = await this.prisma.order.update({ where: { id }, data: { driverId } });
    await this.audit.log({ userId: actorUserId, action: 'order.assign_driver', entityType: 'order', entityId: id, metadata: { driverId } });
    return order;
  }

  async list(params: { status?: string; page?: number; pageSize?: number }) {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 20, 100);
    const where = params.status ? { status: params.status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: { items: true, driver: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
