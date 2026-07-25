import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InvoicesService } from './invoices.service';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'employee')
@Controller('invoices')
export class InvoicesController {
  constructor(private invoices: InvoicesService) {}

  @Post('orders/:orderId')
  generate(@Param('orderId') orderId: string) {
    return this.invoices.generateForOrder(orderId);
  }

  @Get('orders/:orderId')
  findByOrder(@Param('orderId') orderId: string) {
    return this.invoices.findByOrder(orderId);
  }
}
