import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { DriversService } from '../drivers/drivers.service';
import { InvoicesService } from '../invoices/invoices.service';
import { AuditService } from '../audit/audit.service';

// admin/app.js and employee/app.js render against the OLD flat Apps-Script
// era shape (o.totalPrice, i.qty, i.price, p.category as a plain string,
// capitalized status labels) — not our Prisma model's field names
// (o.total, i.quantity, i.unitPrice, a relational Category, lowercase
// snake_case status). Every response built in this file is translated to
// that old shape here, in one place, so admin/app.js and employee/app.js
// never need to change at all. Prisma's Decimal fields are also explicitly
// coerced with Number(...) — Decimal serializes to JSON as a string, which
// is why `.toFixed()` on a raw Prisma price/total blows up client-side.
const STATUS_TO_LEGACY: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Preparing', // no separate "confirmed" bucket in the old UI
  preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const STATUS_TO_INTERNAL: Record<string, string> = {
  Pending: 'pending',
  Preparing: 'preparing',
  'Out for Delivery': 'out_for_delivery',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
};

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `category-${Date.now()}`;
}

function splitDateTime(d: Date): { date: string; time: string } {
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

@Injectable()
export class LegacyActionsService {
  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
    private orders: OrdersService,
    private drivers: DriversService,
    private invoices: InvoicesService,
    private audit: AuditService,
  ) {}

  private toProductCreateInput(payload: Record<string, any>) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) throw new BadRequestException('Product name is required');

    const price = typeof payload.price === 'number' ? payload.price : Number(payload.price);
    if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Product price must be a valid non-negative number');

    return {
      name,
      price,
      description: typeof payload.description === 'string' ? payload.description : undefined,
      imageUrl: typeof payload.image === 'string' && payload.image ? payload.image : undefined,
      ...(typeof payload.available === 'boolean' ? { available: payload.available } : {}),
    };
  }

  /**
   * The old product form sends a flat `category` string (e.g. "Citrus"),
   * not a `categoryId` FK — our schema stores categories relationally.
   * Finds-or-creates a Category row by name so the old free-text UX keeps
   * working without the frontend knowing categories are now a real table.
   */
  private async resolveCategoryId(categoryName: unknown): Promise<string | undefined> {
    if (typeof categoryName !== 'string' || !categoryName.trim()) return undefined;
    const name = categoryName.trim();
    const existing = await this.prisma.category.findFirst({ where: { name } });
    if (existing) return existing.id;
    const created = await this.prisma.category.create({ data: { name, slug: slugify(name) } });
    return created.id;
  }

  private toDriverCreateInput(payload: Record<string, any>) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) throw new BadRequestException('Driver name is required');

    return {
      name,
      phone: typeof payload.phone === 'string' ? payload.phone : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      password: typeof payload.password === 'string' ? payload.password : undefined,
      branchId: typeof payload.branchId === 'string' ? payload.branchId : undefined,
    };
  }

  private mapProduct(p: any) {
    return {
      id: p.id,
      name: p.name,
      category: p.category?.name ?? '',
      price: Number(p.price),
      image: p.imageUrl ?? '',
      available: p.available,
    };
  }

  private mapOrderItem(i: any) {
    return { name: i.nameSnapshot, qty: i.quantity, price: Number(i.unitPrice) };
  }

  private mapOrder(o: any) {
    const { date, time } = splitDateTime(new Date(o.createdAt));
    return {
      id: o.id,
      customerName: o.customerName,
      phone: o.customerPhone,
      items: (o.items ?? []).map(this.mapOrderItem),
      totalPrice: Number(o.total),
      status: STATUS_TO_LEGACY[o.status] ?? o.status,
      assignedDriver: o.driverId ?? null,
      date,
      time,
    };
  }

  async dispatch(action: string, payload: Record<string, any>, authenticatedUserId: string, meta: { ip?: string; userAgent?: string }) {
    const staff = await this.prisma.user.findUnique({ where: { id: authenticatedUserId }, include: { role: true } });
    if (!staff || !staff.isActive) throw new UnauthorizedException('Account unavailable');
    if (!['admin', 'employee', 'super_admin'].includes(staff.role?.name ?? '')) {
      throw new ForbiddenException('Not a staff account');
    }

    const adminOnlyActions = new Set(['deleteAllOrders', 'deleteCompletedOrders', 'addDriver', 'editDriver', 'deleteDriver', 'getStats']);
    if (adminOnlyActions.has(action) && !['admin', 'super_admin'].includes(staff.role?.name ?? '')) {
      throw new ForbiddenException('Admins only');
    }

    const logAndReturn = async (data: unknown) => {
      await this.audit.log({ userId: staff.id, action: `legacy.${action}`, ip: meta.ip, userAgent: meta.userAgent });
      return { success: true, data };
    };

    switch (action) {
      case 'whoAmI':
        return logAndReturn({ id: staff.id, name: staff.name, role: staff.role?.name });

      case 'getProducts': {
        const { items } = await this.products.list({ pageSize: 200 });
        return logAndReturn(items.map((p) => this.mapProduct(p)));
      }
      case 'addProduct': {
        const categoryId = await this.resolveCategoryId(payload.category);
        const created = await this.products.create({ ...this.toProductCreateInput(payload), categoryId });
        const withCategory = await this.prisma.product.findUnique({ where: { id: created.id }, include: { category: true } });
        return logAndReturn(this.mapProduct(withCategory));
      }
      case 'editProduct': {
        const categoryId = await this.resolveCategoryId(payload.category);
        await this.products.update(payload.id, {
          ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
          ...(payload.price !== undefined ? { price: Number(payload.price) } : {}),
          ...(payload.description !== undefined ? { description: payload.description } : {}),
          ...(typeof payload.image === 'string' && payload.image ? { imageUrl: payload.image } : {}),
          ...(typeof payload.available === 'boolean' ? { available: payload.available } : {}),
          ...(categoryId ? { categoryId } : {}),
        });
        const withCategory = await this.prisma.product.findUnique({ where: { id: payload.id }, include: { category: true } });
        return logAndReturn(this.mapProduct(withCategory));
      }
      case 'deleteProduct':
        return logAndReturn(await this.products.remove(payload.id));

      case 'getOrders': {
        const internalStatus = payload.status ? STATUS_TO_INTERNAL[payload.status] : undefined;
        const { items } = await this.orders.list({ status: internalStatus, pageSize: 200 });
        // list() doesn't include items/driver — fetch each order's full
        // detail so mapOrder has what it needs. Fine at this scale (staff
        // dashboards, not a high-traffic customer endpoint); switch to a
        // single findMany with `include` if the order count grows large.
        const full = await Promise.all(items.map((o) => this.orders.findOne(o.id)));
        return logAndReturn(full.map((o) => this.mapOrder(o)));
      }
      case 'updateOrderStatus': {
        const internalStatus = STATUS_TO_INTERNAL[payload.status] ?? payload.status;
        const updated = await this.orders.updateStatus(payload.orderId, internalStatus, staff.id);
        return logAndReturn(this.mapOrder(await this.orders.findOne(updated.id)));
      }
      case 'assignDriver': {
        const updated = await this.orders.assignDriver(payload.orderId, payload.driverId, staff.id);
        return logAndReturn(this.mapOrder(await this.orders.findOne(updated.id)));
      }

      case 'getDrivers':
        return logAndReturn(await this.drivers.list());
      case 'addDriver':
        return logAndReturn(await this.drivers.create(this.toDriverCreateInput(payload)));
      case 'editDriver':
        return logAndReturn(await this.drivers.updatePassword(payload.id, payload.password));
      case 'deleteDriver':
        return logAndReturn(await this.drivers.setAvailability(payload.id, false));

      case 'getInvoiceData': {
        const o = await this.orders.findOne(payload.orderId);
        await this.invoices.findByOrder(payload.orderId).catch(() => this.invoices.generateForOrder(payload.orderId));
        const { date, time } = splitDateTime(new Date(o.createdAt));
        return logAndReturn({
          id: o.id,
          customerName: o.customerName,
          phone: o.customerPhone,
          date,
          time,
          driverName: (o as any).driver?.name ?? null,
          items: (o.items ?? []).map((i) => this.mapOrderItem(i)),
          totalPrice: Number(o.total),
        });
      }

      case 'getStats': {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [totalOrders, pendingOrders, dailyAgg, monthlyAgg, totalAgg] = await this.prisma.$transaction([
          this.prisma.order.count(),
          this.prisma.order.count({ where: { status: { in: ['pending', 'confirmed', 'preparing'] } } }),
          this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'delivered', createdAt: { gte: todayStart } } }),
          this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'delivered', createdAt: { gte: monthStart } } }),
          this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'delivered' } }),
        ]);

        return logAndReturn({
          totalOrders,
          pendingOrders,
          dailySales: Number(dailyAgg._sum.total ?? 0),
          monthlySales: Number(monthlyAgg._sum.total ?? 0),
          totalRevenue: Number(totalAgg._sum.total ?? 0),
        });
      }

      case 'deleteCompletedOrders':
        await this.prisma.order.deleteMany({ where: { status: 'delivered' } });
        return logAndReturn({ deleted: true });

      case 'deleteAllOrders':
        await this.prisma.order.deleteMany({});
        return logAndReturn({ deleted: true });

      default:
        throw new ForbiddenException(`Action not permitted: ${action}`);
    }
  }
}
