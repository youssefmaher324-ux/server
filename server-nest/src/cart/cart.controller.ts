import { Body, Controller, Delete, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CartService } from './cart.service';

@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private cart: CartService) {}

  @Get()
  get(@Req() req: any) {
    return this.cart.get(req.user.userId);
  }

  @Put('items')
  upsert(@Req() req: any, @Body() body: { productId: string; quantity: number }) {
    return this.cart.upsertItem(req.user.userId, body.productId, body.quantity);
  }

  @Delete()
  clear(@Req() req: any) {
    return this.cart.clear(req.user.userId);
  }
}
