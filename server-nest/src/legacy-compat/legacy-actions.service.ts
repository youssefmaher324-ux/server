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
 */
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

  /**
   * The legacy `addProduct` action sends a loose, untyped payload (it used
   * to go straight into a Google Sheets row). ProductsService.create()
   * requires `name: string` and `price: number`; this validates both are
   * actually present and coerces types (price arrives as a string from some
   * older client builds) instead of passing the raw payload through and
   * letting either Prisma or TypeScript reject it.
   */
  private toProductCreateInput(payload: Record<string, any>) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) throw new BadRequestException('Product name is required');

    const price = typeof payload.price === 'number' ? payload.price : Number(payload.price);
    if (!Number.isFinite(price) || price < 0) throw new BadRequestException('Product price must be a valid non-negative number');

    return {
      name,
      nameAr: typeof payload.nameAr === 'string' ? payload.nameAr : undefined,
      description: typeof payload.description === 'string' ? payload.description : undefined,
      price,
      categoryId: typeof payload.categoryId === 'string' ? payload.categoryId : undefined,
      imageUrl: typeof payload.imageUrl === 'string' ? payload.imageUrl : undefined,
    };
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

      case 'getProducts':
        return logAndReturn((await this.products.list({ pageSize: 200 })).items);
      case 'addProduct':
        return logAndReturn(await this.products.create(this.toProductCreateInput(payload)));
      case 'editProduct':
        return logAndReturn(await this.products.update(payload.id, payload));
      case 'deleteProduct':
        return logAndReturn(await this.products.remove(payload.id));

      case 'getOrders':
        return logAndReturn((await this.orders.list({ status: payload.status, pageSize: 200 })).items);
      case 'updateOrderStatus':
        return logAndReturn(await this.orders.updateStatus(payload.orderId, payload.status, staff.id));
      case 'assignDriver':
        return logAndReturn(await this.orders.assignDriver(payload.orderId, payload.driverId, staff.id));

      case 'getDrivers':
        return logAndReturn(await this.drivers.list());
      case 'addDriver':
        return logAndReturn(await this.drivers.create(this.toDriverCreateInput(payload)));
      case 'editDriver':
        return logAndReturn(await this.drivers.updatePassword(payload.id, payload.password));
      case 'deleteDriver':
        return logAndReturn(await this.drivers.setAvailability(payload.id, false));

      case 'getInvoiceData':
        return logAndReturn(await this.invoices.findByOrder(payload.orderId).catch(() => this.invoices.generateForOrder(payload.orderId)));

      case 'getStats': {
        const [totalOrders, pendingOrders, revenue] = await this.prisma.$transaction([
          this.prisma.order.count(),
          this.prisma.order.count({ where: { status: { in: ['pending', 'confirmed', 'preparing'] } } }),
          this.prisma.order.aggregate({ _sum: { total: true }, where: { status: 'delivered' } }),
        ]);
        return logAndReturn({ totalOrders, pendingOrders, revenue: revenue._sum.total ?? 0 });
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
