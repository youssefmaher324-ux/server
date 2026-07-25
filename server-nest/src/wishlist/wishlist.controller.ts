import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WishlistService } from './wishlist.service';

@ApiTags('wishlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wishlist')
export class WishlistController {
  constructor(private wishlist: WishlistService) {}

  @Get()
  list(@Req() req: any) {
    return this.wishlist.list(req.user.userId);
  }

  @Post(':productId')
  add(@Req() req: any, @Param('productId') productId: string) {
    return this.wishlist.add(req.user.userId, productId);
  }

  @Delete(':productId')
  remove(@Req() req: any, @Param('productId') productId: string) {
    return this.wishlist.remove(req.user.userId, productId);
  }
}
