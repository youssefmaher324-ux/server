import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { DriversService } from '../drivers/drivers.service';
import { InvoicesService } from '../invoices/invoices.service';
import { AuditService } from '../audit/audit.service';

/**
 * Compatibility layer for employee/app.js and admin/app.js — keeps their
 * existing `api(action, payload)` call sites working against a single
 * dispatcher endpoint (some actions here, like getStats/deleteAllOrders,
 * have no individual REST equivalent yet) while the *authentication*
 * underneath has moved on twice:
 *
 *   v1: a single shared Apps Script secret, same key for every staff member
 *   v2: accessKey = "a staff member's password", brute-force bcrypt-compared
 *       against every staff user on every request (O(n), no session state)
 *   v3 (current): real JWT from POST /api/auth/login. The controller now
 *       requires JwtAuthGuard + RolesGuard before this service ever runs,
 *       so `dispatch()` receives an already-authenticated userId instead
 *       of a raw accessKey to check itself.
 *
 * IMPORTANT — legacy response shapes:
 * admin/app.js and employee/app.js were never updated to the new Prisma
 * field names/types (they still expect the old Google-Sheets-era flat
 * shape: `o.totalPrice`, `o.phone`, `p.category` as a plain string,
 * Title-Case status labels, etc). Every action below returns data already
 * translated into that legacy shape so the frontend doesn't need to change.
 */

const STATUS_TO_DISPLAY: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Pending',
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

  // ---------------------------------------------------------------------
  // Shape translators: Prisma model -> legacy flat shape the frontend reads
  // ---------------------------------------------------------------------

  private toNum(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private mapProduct(p: any) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      category: p.category?.name ?? 'Uncategorized',
      price: this.toNum(p.price),
      image: p.imageUrl ?? '',
      available: p.available,
    };
  }

  private mapOrder(o: any) {
    const created = o.createdAt ? new Date(o.createdAt) : new Date();
    return {
      id: o.id,
      customerName: o.customerName,
      phone: o.customerPhone,
      items: (o.items ?? []).map((i: any) => ({
        name: i.nameSnapshot,
        qty: i.quantity,
        price: this.toNum(i.unitPrice),
      })),
      totalPrice: this.toNum(o.total),
      status: STATUS_TO_DISPLAY[o.status] ?? o.status,
      assignedDriver: o.driverId ?? null,
      driverName: o.driver?.name ?? null,
      date: created.toISOString().slice(0, 10),
      time: created.toISOString().slice(11, 16),
    };
  }

  private mapDriver(d: any) {
    return {
      id: d.id,
      name: d.name,
      phone: d.phone ?? '',
      available: d.available,
    };
  }

  /**
   * The legacy `addProduct`/`editProduct` actions send a plain-text
   * `category` name (there was no categories table before), while the
   * current schema needs a `categoryId` foreign key. Find-or-create the
   * category by (case-insensitive) name so staff can keep typing free-text
   * category names exactly like before.
   */
  private async resolveCategoryId(categoryName: unknown): Promise<string | undefined> {
    if (typeof categoryName !== 'string' || !categoryName.trim()) return undefined;
    const name = categoryName.trim();

    const existing = await this.prisma.category.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (existing) return existing.id;

    const baseSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'category';
    let slug = baseSlug;
    let suffix = 1;
    // Slugs must be unique — extremely unlikely to collide, but guard anyway.
    while (await this.prisma.category.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    const created = await this.prisma.category.create({ data: { name, slug } });
    return created.id;
  }

  /**
   * The legacy `addProduct` action sends a loose, untyped payload (it used
   * to go straight into a Google Sheets row). ProductsService.create()
   * requires `name: string` and `price: number`; this validates both are
   * actually present and coerces types (price arrives as a string from some
   * older client builds) instead of passing the raw payload through and
   * letting either Prisma or TypeScript reject it. `category` (free-text
   * name) and `image` (legacy field name) are translated to the current
   * `categoryId`/`imageUrl` columns.
   */
  private async toProductCreateInput(payload: Record<string, any>) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) throw new BadRequestException('Product name is required');

    const price = typeof payload.price === 'number' ? payload.price : Number(payload.price);
    if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Product price must be a valid non-negative number');

    return {
      name,
      description: typeof payload.description === 'string' ? payload.description : undefined,
      price,
      categoryId: await this.resolveCategoryId(payload.category),
      imageUrl: typeof payload.image === 'string' ? payload.image : undefined,
    };
  }

  private async toProductUpdateInput(payload: Record<string, any>) {
    const data: Record<string, any> = {};
    if (typeof payload.name === 'string' && payload.name.trim()) data.name = payload.name.trim();
    if (typeof payload.description === 'string') data.description = payload.description;
    if (payload.price !== undefined) {
      const price = typeof payload.price === 'number' ? payload.price : Number(payload.price);
      if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Product price must be a valid non-negative number');
      data.price = price;
    }
    if (payload.category !== undefined) {
      const categoryId = await this.resolveCategoryId(payload.category);
      if (categoryId) data.categoryId = categoryId;
    }
    if (typeof payload.image === 'string') data.imageUrl = payload.image;
    if (typeof payload.available === 'boolean') data.available = payload.available;
    return data;
  }

  /**
   * Same reasoning as toProductCreateInput: DriversService.create() requires
   * `name: string`; the legacy `addDriver` action doesn't guarantee one was
   * sent, so validate it explicitly rather than passing payload through.
   */
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
        const { items } = await this.products.list({ pageSize: 200, includeUnavailable: true });
        return logAndReturn(items.map((p) => this.mapProduct(p)));
      }
      case 'addProduct':
        return logAndReturn(this.mapProduct(await this.products.create(await this.toProductCreateInput(payload))));
      case 'editProduct':
        return logAndReturn(this.mapProduct(await this.products.update(payload.id, await this.toProductUpdateInput(payload))));
      case 'deleteProduct':
        return logAndReturn(await this.products.remove(payload.id).then(() => ({ deleted: true })));

      case 'getOrders': {
        const { items } = await this.orders.list({ status: payload.status, pageSize: 200 });
        return logAndReturn(items.map((o) => this.mapOrder(o)));
      }
      case 'updateOrderStatus': {
        const internalStatus = STATUS_TO_INTERNAL[payload.status] ?? payload.status;
        return logAndReturn(this.mapOrder(await this.orders.updateStatus(payload.orderId, internalStatus, staff.id)));
      }
      case 'assignDriver':
        return logAndReturn(this.mapOrder(await this.orders.assignDriver(payload.orderId, payload.driverId, staff.id)));

      case 'getDrivers':
        return logAndReturn((await this.drivers.list()).map((d) => this.mapDriver(d)));
      case 'addDriver':
        return logAndReturn(this.mapDriver(await this.drivers.create(this.toDriverCreateInput(payload))));
      case 'editDriver':
        return logAndReturn(
          this.mapDriver(
            await this.drivers.updateDetails(payload.id, {
              name: typeof payload.name === 'string' ? payload.name.trim() : undefined,
              phone: typeof payload.phone === 'string' ? payload.phone : undefined,
              available: typeof payload.available === 'boolean' ? payload.available : undefined,
            }),
          ),
        );
      case 'deleteDriver':
        return logAndReturn(await this.drivers.setAvailability(payload.id, false).then(() => ({ deleted: true })));

      case 'getInvoiceData': {
        const order = await this.orders.findOne(payload.orderId);
        // Best-effort: keep an Invoice record for future PDF generation, but
        // never let that side effect block the dashboard from showing data.
        await this.invoices.generateForOrder(payload.orderId).catch(() => undefined);
        return logAndReturn(this.mapOrder(order));
      }

      case 'getStats': {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

        const [totalOrders, completedCount, cancelledCount, dailyAgg, monthlyAgg, totalAgg] = await this.prisma.$transaction([
          this.prisma.order.count(),
          this.prisma.order.count({ where: { status: 'delivered' } }),
          this.prisma.order.count({ where: { status: 'cancelled' } }),
          this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'delivered', createdAt: { gte: startOfDay } } }),
          this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'delivered', createdAt: { gte: startOfMonth } } }),
          this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'delivered' } }),
        ]);

        return logAndReturn({
          totalOrders,
          completedCount,
          cancelledCount,
          dailySales: this.toNum(dailyAgg._sum.total),
          monthlySales: this.toNum(monthlyAgg._sum.total),
          totalRevenue: this.toNum(totalAgg._sum.total),
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
