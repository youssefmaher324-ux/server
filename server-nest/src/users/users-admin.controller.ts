import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';

/**
 * Admin user management — GET/POST/PUT/DELETE /api/users.
 * Kept as a separate controller from UsersController (which owns
 * /api/users/me, the self-service profile routes a logged-in user hits for
 * their own account) so the two permission models — "manage my own
 * profile" vs "manage any account" — never share a route table by accident.
 */
@ApiTags('users-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@Controller('users')
export class UsersAdminController {
  constructor(private users: UsersService) {}

  @Get()
  list(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('role') role?: string) {
    return this.users.listAll(page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined, role);
  }

  @Post()
  create(@Body() body: { name: string; email: string; phone?: string; password: string; roleName: string }) {
    return this.users.createByAdmin(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; email?: string; phone?: string; isActive?: boolean; roleName?: string }) {
    return this.users.updateByAdmin(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.users.deactivate(id);
  }
}
