import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  /** Called from OrdersService inside the same transaction that creates an order. */
  createPending(tx: Prisma.TransactionClient, orderId: string, amount: number, method: string) {
    return tx.payment.create({ data: { orderId, amount, method, status: 'pending' } });
  }

  async markPaid(orderId: string, transactionRef?: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundException('Payment not found for this order');
    return this.prisma.payment.update({
      where: { orderId },
      data: { status: 'paid', paidAt: new Date(), transactionRef },
    });
  }

  async markFailed(orderId: string) {
    return this.prisma.payment.update({ where: { orderId }, data: { status: 'failed' } });
  }

  findByOrder(orderId: string) {
    return this.prisma.payment.findUnique({ where: { orderId } });
  }
}
