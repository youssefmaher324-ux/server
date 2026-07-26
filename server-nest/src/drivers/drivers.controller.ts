import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

  @Roles('driver')
  @Patch(':id/location')
  updateLocation(@Param('id') id: string, @Body() body: { lat: number; lng: number }) {
    return this.drivers.updateLocation(id, body.lat, body.lng);
  }

  @Roles('driver', 'admin', 'employee')
  @Patch(':id/availability')
  setAvailability(@Param('id') id: string, @Body('available') available: boolean) {
    return this.drivers.setAvailability(id, available);
  }
}
