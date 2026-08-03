import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RoomsService } from './rooms.service';

@ApiTags('rooms')
@Controller('rooms')
export class RoomsController {
  constructor(private rooms: RoomsService) {}

  // Public — a guest browsing the site needs to see room categories and
  // capacities before they even sign in, to know what to ask for.
  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.rooms.list(includeInactive === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.rooms.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('supervisor', 'super_admin')
  @Post()
  create(@Body() body: { name: string; type: 'PRIVATE' | 'SHARED'; gender: 'MALE' | 'FEMALE' | 'ANY'; capacity: number; notes?: string }) {
    return this.rooms.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('supervisor', 'super_admin')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.rooms.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('supervisor', 'super_admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.rooms.remove(id);
  }
}
