import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notifications/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

const ACTIVE_STATUSES = ['pending', 'approved', 'checked_in'];
const MAX_SUGGESTION_SCAN_DAYS = 60;

interface RoomPick {
  roomId: string;
  beds: number;
}

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private rooms: RoomsService,
    private audit: AuditService,
    private mail: MailService,
    private notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------
  // Allocation helpers
  // ---------------------------------------------------------------------

  /** Rooms that, for the given date range, contain no booking of the opposite gender. */
  private async genderCompatibleRoomIds(gender: string, arrivalDate: Date, departureDate: Date): Promise<Set<string>> {
    const conflicting = await this.prisma.bookingRoom.findMany({
      where: {
        booking: {
          status: { in: ACTIVE_STATUSES },
          gender: { not: gender },
          arrivalDate: { lt: departureDate },
          departureDate: { gt: arrivalDate },
        },
      },
      select: { roomId: true },
    });
    const blocked = new Set(conflicting.map((c) => c.roomId));
    const allRooms = await this.prisma.room.findMany({ where: { isActive: true }, select: { id: true } });
    return new Set(allRooms.map((r) => r.id).filter((id) => !blocked.has(id)));
  }

  /** Finds a single room, matching gender, with at least 1 free bed for the whole stay. */
  private async findIndividualRoom(gender: string, arrivalDate: Date, departureDate: Date): Promise<{ roomId: string; remaining: number } | null> {
    const compatible = await this.genderCompatibleRoomIds(gender, arrivalDate, departureDate);
    const rooms = await this.prisma.room.findMany({ where: { isActive: true, id: { in: [...compatible] } }, orderBy: { capacity: 'asc' } });
    for (const room of rooms) {
      const committed = await this.rooms.bedsCommitted(room.id, arrivalDate, departureDate);
      const remaining = room.capacity - committed;
      if (remaining >= 1) return { roomId: room.id, remaining: remaining - 1 };
    }
    return null;
  }

  /** Picks one or more ENTIRELY FREE rooms whose combined capacity covers familySize (a "full room" booking is exclusive — no strangers share it). */
  private async findFullRooms(familySize: number, arrivalDate: Date, departureDate: Date): Promise<RoomPick[] | null> {
    const allRooms = await this.prisma.room.findMany({ where: { isActive: true }, orderBy: { capacity: 'desc' } });
    const free: { id: string; capacity: number }[] = [];
    for (const room of allRooms) {
      const committed = await this.rooms.bedsCommitted(room.id, arrivalDate, departureDate);
      if (committed === 0) free.push({ id: room.id, capacity: room.capacity });
    }
    // Greedy: largest-free-room-first until capacity covers the family.
    const picks: RoomPick[] = [];
    let remaining = familySize;
    for (const room of free) {
      if (remaining <= 0) break;
      picks.push({ roomId: room.id, beds: room.capacity });
      remaining -= room.capacity;
    }
    if (remaining > 0) return null; // not enough free rooms
    return picks;
  }

  /** Picks rooms (gender-compatible, may already be partially used by the same gender) whose combined free capacity covers groupSize. */
  private async findRetreatRooms(gender: string, groupSize: number, arrivalDate: Date, departureDate: Date): Promise<RoomPick[] | null> {
    const compatible = await this.genderCompatibleRoomIds(gender, arrivalDate, departureDate);
    const rooms = await this.prisma.room.findMany({ where: { isActive: true, id: { in: [...compatible] } }, orderBy: { capacity: 'desc' } });
    const available: { id: string; free: number }[] = [];
    for (const room of rooms) {
      const committed = await this.rooms.bedsCommitted(room.id, arrivalDate, departureDate);
      const free = room.capacity - committed;
      if (free > 0) available.push({ id: room.id, free });
    }
    available.sort((a, b) => b.free - a.free);
    const picks: RoomPick[] = [];
    let remaining = groupSize;
    for (const room of available) {
      if (remaining <= 0) break;
      const use = Math.min(room.free, remaining);
      picks.push({ roomId: room.id, beds: use });
      remaining -= use;
    }
    if (remaining > 0) return null; // not enough total capacity
    return picks;
  }

  private nights(arrival: Date, departure: Date): number {
    return Math.max(1, Math.round((departure.getTime() - arrival.getTime()) / (24 * 60 * 60 * 1000)));
  }

  /** Scans forward day-by-day (same length of stay) to find the next date range that WOULD succeed, without booking it. Used only to build the "try these dates instead" suggestion. */
  private async suggestNextAvailable(
    kind: 'individual' | 'full_room' | 'retreat',
    params: { gender?: string; size?: number },
    arrivalDate: Date,
    departureDate: Date,
  ): Promise<{ arrivalDate: string; departureDate: string } | null> {
    const nights = this.nights(arrivalDate, departureDate);
    for (let offset = 1; offset <= MAX_SUGGESTION_SCAN_DAYS; offset++) {
      const tryArrival = new Date(arrivalDate.getTime() + offset * 24 * 60 * 60 * 1000);
      const tryDeparture = new Date(tryArrival.getTime() + nights * 24 * 60 * 60 * 1000);

      let ok = false;
      if (kind === 'individual') {
        ok = !!(await this.findIndividualRoom(params.gender!, tryArrival, tryDeparture));
      } else if (kind === 'full_room') {
        ok = !!(await this.findFullRooms(params.size!, tryArrival, tryDeparture));
      } else {
        ok = !!(await this.findRetreatRooms(params.gender!, params.size!, tryArrival, tryDeparture));
      }
      if (ok) return { arrivalDate: tryArrival.toISOString(), departureDate: tryDeparture.toISOString() };
    }
    return null;
  }

  private parseDates(arrivalDate: string, departureDate: string): { arrival: Date; departure: Date } {
    const arrival = new Date(arrivalDate);
    const departure = new Date(departureDate);
    if (Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime())) {
      throw new BadRequestException('Invalid dates');
    }
    if (departure <= arrival) throw new BadRequestException('Departure date must be after arrival date');
    return { arrival, departure };
  }

  // ---------------------------------------------------------------------
  // Creation (one method per booking type, per spec section 3)
  // ---------------------------------------------------------------------

  async createIndividual(userId: string | undefined, dto: {
    gender: string; arrivalDate: string; departureDate: string; churchName?: string; phone: string; address?: string; governorate?: string; notes?: string;
  }) {
    const { arrival, departure } = this.parseDates(dto.arrivalDate, dto.departureDate);
    const pick = await this.findIndividualRoom(dto.gender, arrival, departure);
    if (!pick) {
      const suggestion = await this.suggestNextAvailable('individual', { gender: dto.gender }, arrival, departure);
      throw new BadRequestException({ message: 'Selected dates are fully booked.', suggestion });
    }

    const booking = await this.prisma.booking.create({
      data: {
        type: 'individual',
        userId,
        gender: dto.gender,
        churchName: dto.churchName,
        phone: dto.phone,
        address: dto.address,
        governorate: dto.governorate,
        notes: dto.notes,
        arrivalDate: arrival,
        departureDate: departure,
        status: 'pending',
        bookingRooms: { create: [{ roomId: pick.roomId, bedsAllocated: 1 }] },
      },
      include: { bookingRooms: { include: { room: true } } },
    });

    await this.audit.log({ userId, action: 'booking.create', entityType: 'booking', entityId: booking.id, metadata: { type: 'individual' } });
    await this.notifyReceived(booking.id);
    return { ...booking, bedsRemainingInRoom: pick.remaining };
  }

  async createRoomBooking(userId: string | undefined, dto: {
    familySize: number; arrivalDate: string; departureDate: string; churchName?: string; phone: string; address?: string; governorate?: string; notes?: string;
  }) {
    const { arrival, departure } = this.parseDates(dto.arrivalDate, dto.departureDate);
    const picks = await this.findFullRooms(dto.familySize, arrival, departure);
    if (!picks) {
      const suggestion = await this.suggestNextAvailable('full_room', { size: dto.familySize }, arrival, departure);
      throw new BadRequestException({ message: 'No rooms available.', suggestion });
    }

    const booking = await this.prisma.booking.create({
      data: {
        type: 'full_room',
        userId,
        familySize: dto.familySize,
        churchName: dto.churchName,
        phone: dto.phone,
        address: dto.address,
        governorate: dto.governorate,
        notes: dto.notes,
        arrivalDate: arrival,
        departureDate: departure,
        status: 'pending',
        bookingRooms: { create: picks.map((p) => ({ roomId: p.roomId, bedsAllocated: p.beds })) },
      },
      include: { bookingRooms: { include: { room: true } } },
    });

    await this.audit.log({ userId, action: 'booking.create', entityType: 'booking', entityId: booking.id, metadata: { type: 'full_room', roomsUsed: picks.length } });
    await this.notifyReceived(booking.id);
    return booking;
  }

  async createRetreat(userId: string | undefined, dto: {
    churchName: string; contactName: string; phone: string; groupSize: number; gender: string; arrivalDate: string; departureDate: string; address?: string; governorate?: string; notes?: string;
  }) {
    const { arrival, departure } = this.parseDates(dto.arrivalDate, dto.departureDate);
    const picks = await this.findRetreatRooms(dto.gender, dto.groupSize, arrival, departure);
    if (!picks) {
      const suggestion = await this.suggestNextAvailable('retreat', { gender: dto.gender, size: dto.groupSize }, arrival, departure);
      throw new BadRequestException({ message: 'No rooms available.', suggestion });
    }

    const booking = await this.prisma.booking.create({
      data: {
        type: 'retreat',
        userId,
        gender: dto.gender,
        churchName: dto.churchName,
        contactName: dto.contactName,
        phone: dto.phone,
        address: dto.address,
        governorate: dto.governorate,
        notes: dto.notes,
        groupSize: dto.groupSize,
        roomsNeeded: picks.length,
        arrivalDate: arrival,
        departureDate: departure,
        status: 'pending',
        bookingRooms: { create: picks.map((p) => ({ roomId: p.roomId, bedsAllocated: p.beds })) },
      },
      include: { bookingRooms: { include: { room: true } } },
    });

    await this.audit.log({ userId, action: 'booking.create', entityType: 'booking', entityId: booking.id, metadata: { type: 'retreat', roomsUsed: picks.length } });
    await this.notifyReceived(booking.id);
    return booking;
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async get(id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { bookingRooms: { include: { room: true } }, user: { select: { id: true, name: true, email: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** Owner can view their own booking; booking_manager/super_admin can view any. */
  async getForViewer(id: string, userId: string, roleId?: string) {
    const booking = await this.get(id);
    if (booking.userId === userId) return booking;
    if (roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (role && ['super_admin', 'booking_manager'].includes(role.name)) return booking;
    }
    throw new ForbiddenException('Not your booking');
  }

  async getOwned(id: string, userId: string) {
    const booking = await this.get(id);
    if (booking.userId !== userId) throw new ForbiddenException('Not your booking');
    return booking;
  }

  list(filters: { status?: string; type?: string; page?: number; pageSize?: number }) {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 50;
    return this.prisma.booking.findMany({
      where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.type ? { type: filters.type } : {}) },
      include: { bookingRooms: { include: { room: true } }, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  // ---------------------------------------------------------------------
  // Booking Manager actions (spec section 6 / 8 / 9 / 12)
  // ---------------------------------------------------------------------

  private async nextBookingCode(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.booking.count({ where: { code: { startsWith: `MON-${year}-` } } });
    return `MON-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  async approve(bookingId: string, managerId: string) {
    const booking = await this.get(bookingId);
    if (booking.status !== 'pending') throw new BadRequestException(`Booking is ${booking.status}, not pending`);

    const code = await this.nextBookingCode();
    const qrPayload = JSON.stringify({ bookingId: booking.id, code });
    const qrCodeUrl = await QRCode.toDataURL(qrPayload);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'approved', code, qrCodeUrl, managedById: managerId, approvedAt: new Date() },
      include: { bookingRooms: { include: { room: true } } },
    });

    await this.audit.log({ userId: managerId, action: 'booking.approve', entityType: 'booking', entityId: bookingId });

    const email = await this.bookingEmail(booking.id);
    if (email) {
      await this.mail.sendBookingApprovedEmail(email, code, qrCodeUrl);
      if (booking.userId) await this.notifications.create({ userId: booking.userId, title: 'Booking approved', body: `Your booking ${code} was approved.`, channel: 'in_app' });
    }
    return updated;
  }

  async reject(bookingId: string, managerId: string, reason?: string) {
    const booking = await this.get(bookingId);
    if (booking.status !== 'pending') throw new BadRequestException(`Booking is ${booking.status}, not pending`);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'rejected', rejectionReason: reason, managedById: managerId },
    });

    await this.audit.log({ userId: managerId, action: 'booking.reject', entityType: 'booking', entityId: bookingId, metadata: { reason } });

    const email = await this.bookingEmail(booking.id);
    if (email) await this.mail.sendBookingRejectedEmail(email, booking.code || bookingId, reason);
    return updated;
  }

  async reassignRoom(bookingId: string, newRoomId: string, managerId: string) {
    const booking = await this.get(bookingId);
    if (!['pending', 'approved'].includes(booking.status)) throw new BadRequestException('Only pending or approved bookings can be reassigned');
    await this.rooms.get(newRoomId);

    const totalBeds = booking.bookingRooms.reduce((s, br) => s + br.bedsAllocated, 0);
    const committed = await this.rooms.bedsCommitted(newRoomId, booking.arrivalDate, booking.departureDate, booking.id);
    const room = await this.rooms.get(newRoomId);
    if (room.capacity - committed < totalBeds) throw new BadRequestException('Target room does not have enough free beds');

    await this.prisma.$transaction([
      this.prisma.bookingRoom.deleteMany({ where: { bookingId } }),
      this.prisma.bookingRoom.create({ data: { bookingId, roomId: newRoomId, bedsAllocated: totalBeds } }),
    ]);
    await this.audit.log({ userId: managerId, action: 'booking.reassign_room', entityType: 'booking', entityId: bookingId, metadata: { newRoomId } });
    return this.get(bookingId);
  }

  async sendMessage(bookingId: string, message: string, managerId: string) {
    const booking = await this.get(bookingId);
    if (booking.userId) {
      await this.notifications.create({ userId: booking.userId, title: `Message about booking ${booking.code || ''}`, body: message, channel: 'in_app' });
    }
    const email = await this.bookingEmail(booking.id);
    if (email) await this.notifications.create({ userId: booking.userId ?? undefined, title: 'Message from booking team', body: message, channel: 'email' });
    await this.audit.log({ userId: managerId, action: 'booking.message', entityType: 'booking', entityId: bookingId });
    return { success: true };
  }

  async checkIn(bookingId: string, managerId: string) {
    const booking = await this.get(bookingId);
    if (booking.status !== 'approved') throw new BadRequestException(`Booking is ${booking.status}, not approved`);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'checked_in', checkedInAt: new Date(), managedById: managerId },
    });
    await this.audit.log({ userId: managerId, action: 'booking.check_in', entityType: 'booking', entityId: bookingId });

    const email = await this.bookingEmail(booking.id);
    if (email) await this.mail.sendCheckInEmail(email, booking.code || bookingId);
    return updated;
  }

  /** Check-in by scanning the QR code — payload is `{bookingId, code}` as produced in approve(). */
  async checkInByQr(payload: string, managerId: string) {
    let parsed: { bookingId?: string; code?: string };
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new BadRequestException('Invalid QR payload');
    }
    if (!parsed.bookingId) throw new BadRequestException('Invalid QR payload');
    return this.checkIn(parsed.bookingId, managerId);
  }

  async checkOut(bookingId: string, managerId: string) {
    const booking = await this.get(bookingId);
    if (booking.status !== 'checked_in') throw new BadRequestException(`Booking is ${booking.status}, not checked in`);

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'completed', checkedOutAt: new Date(), managedById: managerId },
    });
    await this.audit.log({ userId: managerId, action: 'booking.check_out', entityType: 'booking', entityId: bookingId });

    const email = await this.bookingEmail(booking.id);
    if (email) await this.mail.sendStayCompletedEmail(email, booking.code || bookingId);
    return updated;
  }

  async cancel(bookingId: string, userId: string) {
    const booking = await this.getOwned(bookingId, userId);
    if (!['pending', 'approved'].includes(booking.status)) throw new BadRequestException('Only pending or approved bookings can be cancelled');
    const updated = await this.prisma.booking.update({ where: { id: bookingId }, data: { status: 'cancelled' } });
    await this.audit.log({ userId, action: 'booking.cancel', entityType: 'booking', entityId: bookingId });
    return updated;
  }

  // ---------------------------------------------------------------------
  // Notification helpers
  // ---------------------------------------------------------------------

  private async bookingEmail(bookingId: string): Promise<string | null> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { user: true } });
    return booking?.user?.email ?? null;
  }

  private async notifyReceived(bookingId: string) {
    const email = await this.bookingEmail(bookingId);
    if (email) await this.mail.sendBookingReceivedEmail(email, bookingId.slice(0, 8).toUpperCase());
  }
}
