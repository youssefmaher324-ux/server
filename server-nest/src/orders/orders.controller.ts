import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
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
  tracking(@Param('id') id: string) {
    return this.orders.getTracking(id);
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
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Req() req: any) {
    return this.orders.updateStatus(id, status, req.user?.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'employee')
  @Patch(':id/assign-driver')
  assignDriver(@Param('id') id: string, @Body('driverId') driverId: string, @Req() req: any) {
    return this.orders.assignDriver(id, driverId, req.user?.userId);
  }
}
