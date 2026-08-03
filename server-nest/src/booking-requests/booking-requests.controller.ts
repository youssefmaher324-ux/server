import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BookingRequestsService } from './booking-requests.service';

@ApiTags('booking-requests')
@Controller('booking-requests')
export class BookingRequestsController {
  constructor(private bookings: BookingRequestsService) {}

  // Public — lets the site show "is X people for Y nights realistic?"
  // before the guest even signs in, matching how the room list is public.
  @Get('availability')
  checkAvailability(
    @Query('type') type: 'PRIVATE' | 'SHARED',
    @Query('gender') gender: 'MALE' | 'FEMALE' | 'ANY',
    @Query('headcount') headcount: string,
    @Query('checkInDate') checkInDate: string,
    @Query('nights') nights: string,
  ) {
    return this.bookings.checkAvailability(type, gender, Number(headcount), new Date(checkInDate), Number(nights));
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post()
  create(@Req() req: any, @Body() body: { type: 'PRIVATE' | 'SHARED'; gender: 'MALE' | 'FEMALE' | 'ANY'; headcount: number; checkInDate: string; nights: number; guestNotes?: string }) {
    return this.bookings.createRequest(req.user.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('mine')
  listMine(@Req() req: any) {
    return this.bookings.listMine(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('coordinator', 'supervisor', 'super_admin')
  @Get()
  listAll(@Query('status') status?: string) {
    return this.bookings.listAll(status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('coordinator', 'supervisor', 'super_admin')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.bookings.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('coordinator', 'supervisor', 'super_admin')
  @Put(':id/approve')
  approve(@Param('id') id: string, @Req() req: any, @Body() body: { roomId?: string }) {
    return this.bookings.approve(id, req.user.userId, body?.roomId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('coordinator', 'supervisor', 'super_admin')
  @Put(':id/reject')
  reject(@Param('id') id: string, @Req() req: any, @Body() body: { reviewNotes?: string }) {
    return this.bookings.reject(id, req.user.userId, body?.reviewNotes);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Put(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: any) {
    return this.bookings.cancel(id, req.user.userId);
  }
}
