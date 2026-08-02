import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { RoomsService } from './rooms.service';

@ApiTags('rooms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rooms')
export class RoomsController {
  constructor(
    private rooms: RoomsService,
    private audit: AuditService,
  ) {}

  // Super Admin and Booking Manager can both view the room list (the
  // manager needs it to reassign bookings); only Super Admin can write.
  @Roles('super_admin', 'booking_manager')
  @Get()
  list(@Query('activeOnly') activeOnly?: string) {
    return this.rooms.list(activeOnly === 'true');
  }

  @Roles('super_admin', 'booking_manager')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.rooms.get(id);
  }

  @Roles('super_admin')
  @Post()
  async create(@Body() body: { number: string; capacity: number; type?: string; notes?: string }) {
    const room = await this.rooms.create(body);
    await this.audit.log({ action: 'room.create', entityType: 'room', entityId: room.id });
    return room;
  }

  @Roles('super_admin')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { number?: string; capacity?: number; type?: string; notes?: string; isActive?: boolean },
  ) {
    const room = await this.rooms.update(id, body);
    await this.audit.log({ action: 'room.update', entityType: 'room', entityId: id });
    return room;
  }

  @Roles('super_admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.rooms.remove(id);
    await this.audit.log({ action: 'room.delete', entityType: 'room', entityId: id });
    return { success: true };
  }
}
