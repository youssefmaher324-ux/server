import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  // Prisma's total/subtotal/discountTotal columns are Decimal, which
  // JSON-serializes as strings — customer/app.js reads order.total directly
  // for the checkout success screen and cancel flow, so convert here.
  private serialize(o: any) {
    return {
      ...o,
      subtotal: o.subtotal !== undefined ? Number(o.subtotal) : o.subtotal,
      discountTotal: o.discountTotal !== undefined ? Number(o.discountTotal) : o.discountTotal,
      total: o.total !== undefined ? Number(o.total) : o.total,
      items: Array.isArray(o.items) ? o.items.map((i: any) => ({ ...i, unitPrice: Number(i.unitPrice), lineTotal: Number(i.lineTotal) })) : o.items,
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 3600_000 } }) // spam control on order creation
  @Post()
  async create(@Body() body: any, @Req() req: any) {
    return this.serialize(await this.orders.create({ ...body, userId: req.user.userId }));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.serialize(await this.orders.findOne(id));
  }

  @Get(':id/tracking')
  async tracking(@Param('id') id: string) {
    // customer/app.js (legacy shape) expects
    // { success, tracking: { status, current_lat, current_lng, driver_name } }
    const order = await this.orders.getTracking(id);
    return {
      success: true,
      tracking: {
        status: order.status,
        current_lat: order.driver?.currentLat ?? null,
        current_lng: order.driver?.currentLng ?? null,
        driver_name: order.driver?.name ?? null,
      },
    };
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Req() req: any) {
    return this.serialize(await this.orders.cancel(id, req.user?.userId));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'employee')
  @Get()
  list(@Query('status') status?: string, @Query('page') page?: string) {
    return this.orders.list({ status, page: page ? Number(page) : undefined });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'employee')
  @Put(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Req() req: any) {
    return this.orders.updateStatus(id, status, req.user?.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'employee')
  @Put(':id/assign-driver')
  assignDriver(@Param('id') id: string, @Body('driverId') driverId: string, @Req() req: any) {
    return this.orders.assignDriver(id, driverId, req.user?.userId);
  }
}
