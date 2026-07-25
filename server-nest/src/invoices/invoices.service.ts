import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  async generateForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const number = `INV-${new Date().getFullYear()}-${orderId.slice(0, 8).toUpperCase()}`;
    // pdfUrl is populated by a background job that renders the PDF and
    // uploads it to Supabase Storage; left null until that job completes.
    return this.prisma.invoice.upsert({
      where: { orderId },
      update: {},
      create: { orderId, number },
    });
  }

  async findByOrder(orderId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { orderId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }
}
