import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BookingsService } from './bookings.service';
import {
  CreateIndividualBookingDto,
  CreateRetreatBookingDto,
  CreateRoomBookingDto,
  ReassignRoomDto,
  RejectBookingDto,
  SendBookingMessageDto,
} from './dto/bookings.dto';

type AuthedRequest = Request & { user: { userId: string; roleId?: string } };

@ApiTags('bookings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  // ---- Creation (any logged-in user) --------------------------------------

  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @Post('individual')
  createIndividual(@Body() dto: CreateIndividualBookingDto, @Req() req: AuthedRequest) {
    return this.bookings.createIndividual(req.user.userId, dto);
  }

  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @Post('full-room')
  createRoomBooking(@Body() dto: CreateRoomBookingDto, @Req() req: AuthedRequest) {
    return this.bookings.createRoomBooking(req.user.userId, dto);
  }

  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @Post('retreat')
  createRetreat(@Body() dto: CreateRetreatBookingDto, @Req() req: AuthedRequest) {
    return this.bookings.createRetreat(req.user.userId, dto);
  }

  // ---- Reads ---------------------------------------------------------------

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Get()
  list(@Query('status') status?: string, @Query('type') type?: string, @Query('page') page?: string) {
    return this.bookings.list({ status, type, page: page ? Number(page) : undefined });
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.bookings.getForViewer(id, req.user.userId, req.user.roleId);
  }

  // ---- Owner actions ---------------------------------------------------------

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.bookings.cancel(id, req.user.userId);
  }

  // ---- Booking Manager actions (spec section 6) -----------------------------

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.bookings.approve(id, req.user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectBookingDto, @Req() req: AuthedRequest) {
    return this.bookings.reject(id, req.user.userId, dto.reason);
  }

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Patch(':id/reassign-room')
  reassignRoom(@Param('id') id: string, @Body() dto: ReassignRoomDto, @Req() req: AuthedRequest) {
    return this.bookings.reassignRoom(id, dto.roomId, req.user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Post(':id/message')
  sendMessage(@Param('id') id: string, @Body() dto: SendBookingMessageDto, @Req() req: AuthedRequest) {
    return this.bookings.sendMessage(id, dto.message, req.user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Post(':id/check-in')
  checkIn(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.bookings.checkIn(id, req.user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Post('check-in-by-qr')
  checkInByQr(@Body('payload') payload: string, @Req() req: AuthedRequest) {
    return this.bookings.checkInByQr(payload, req.user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles('super_admin', 'booking_manager')
  @Post(':id/check-out')
  checkOut(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.bookings.checkOut(id, req.user.userId);
  }
}
