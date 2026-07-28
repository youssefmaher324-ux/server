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

  @Throttle({ default: { limit: 20, ttl: 3600_000 } }) // spam control on order creation
  @Post()
  create(@Body() body: any, @Req() req: any) {
    return this.orders.create({ ...body, userId: req.user?.userId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.findOne(id);
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
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.orders.cancel(id, req.user?.userId);
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
