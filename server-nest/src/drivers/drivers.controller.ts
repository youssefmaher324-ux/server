import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DriversService } from './drivers.service';

@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('drivers')
export class DriversController {
  constructor(private drivers: DriversService) {}

  @Roles('admin', 'employee')
  @Get()
  list() {
    return this.drivers.list();
  }

  @Roles('admin')
  @Post()
  create(@Body() body: any) {
    return this.drivers.create(body);
  }

  // A driver token's `userId` claim carries the driver's own id (see
  // AuthService.driverLogin) — admin/employee can update any driver
  // (dispatch correcting a stuck GPS ping), but a driver can only ever
  // update their own, so one driver's token can't spoof another's location.
  private assertOwnDriverOrStaff(req: any, id: string) {
    if (req.user?.role === 'driver' && req.user.userId !== id) {
      throw new ForbiddenException("You can only update your own driver record");
    }
  }

  @Roles('driver', 'admin', 'employee')
  @Patch(':id/location')
  updateLocation(@Param('id') id: string, @Body() body: { lat: number; lng: number }, @Req() req: any) {
    this.assertOwnDriverOrStaff(req, id);
    return this.drivers.updateLocation(id, body.lat, body.lng);
  }

  @Roles('driver', 'admin', 'employee')
  @Patch(':id/availability')
  setAvailability(@Param('id') id: string, @Body('available') available: boolean, @Req() req: any) {
    this.assertOwnDriverOrStaff(req, id);
    return this.drivers.setAvailability(id, available);
  }
}

