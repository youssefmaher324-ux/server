import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { DriversService } from '../drivers/drivers.service';
import { InvoicesService } from '../invoices/invoices.service';
import { AuditService } from '../audit/audit.service';

/**
 * Compatibility layer for employee/app.js and admin/app.js.
 *
 * Those two files were talking directly to a Google Apps Script Web App
 * using a single `api(action, payload)` helper and a hard-coded WEB_APP_URL
 * (which — heads up — was a *live, working* Apps Script deployment link
 * committed straight into the client-side bundle; anyone who opened
 * dev tools had it). That URL and every action name below is preserved
 * here so the only change required in those two files is:
 *
 *   CONFIG.WEB_APP_URL -> your new API's /api/citrine/actions endpoint
 *
 * `accessKey` now means "a staff member's password", checked against
 * users.password_hash for a user whose role is employee/admin/super_admin
 * (instead of a single shared secret hardcoded into Apps Script's Script
 * Properties, which every one of your staff shared under this old design).
 * This is a per-request check (no session state) to match the original
 * behavior exactly — swap to a JWT session once the frontends can store one.
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

  private async authenticateStaff(accessKey: string, requireAdmin = false) {
    if (!accessKey) throw new UnauthorizedException('Access key required');

    // NOTE: matching "some staff user whose password matches" rather than a
    // single shared secret is O(n) over staff accounts; fine at this scale,
    // but if a `username` accompanies accessKey in a later frontend change,
    // switch this to a direct lookup instead of a scan.
    const candidates = await this.prisma.user.findMany({
      where: { role: { name: requireAdmin ? { in: ['admin', 'super_admin'] } : { in: ['employee', 'admin', 'super_admin'] } } },
      include: { role: true },
    });
    for (const candidate of candidates) {
      if (candidate.passwordHash && (await bcrypt.compare(accessKey, candidate.passwordHash))) {
        return candidate;
      }
    }
    throw new UnauthorizedException('Invalid access key');
  }

  async dispatch(action: string, payload: Record<string, any>, meta: { ip?: string; userAgent?: string }) {
    const adminOnlyActions = new Set(['deleteAllOrders', 'deleteCompletedOrders', 'addDriver', 'editDriver', 'deleteDriver', 'getStats']);
    const staff = await this.authenticateStaff(payload.accessKey, adminOnlyActions.has(action));

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
        return logAndReturn(await this.products.create(payload));
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
        return logAndReturn(await this.drivers.create(payload));
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
        if (staff.role?.name === 'employee') throw new ForbiddenException('Admins only');
        await this.prisma.order.deleteMany({ where: { status: 'delivered' } });
        return logAndReturn({ deleted: true });

      case 'deleteAllOrders':
        if (staff.role?.name === 'employee') throw new ForbiddenException('Admins only');
        await this.prisma.order.deleteMany({});
        return logAndReturn({ deleted: true });

      default:
        throw new ForbiddenException(`Action not permitted: ${action}`);
    }
  }
}
