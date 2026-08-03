import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  getProfile(@Req() req: any) {
    return this.users.getProfile(req.user.userId);
  }

  @Patch()
  updateProfile(@Req() req: any, @Body() body: { name?: string; phone?: string }) {
    return this.users.updateProfile(req.user.userId, body);
  }

  @Get('orders')
  getOrders(@Req() req: any, @Query('page') page?: string) {
    return this.users.getOrders(req.user.userId, page ? Number(page) : 1);
  }
}
