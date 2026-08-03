import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type RoomType = 'PRIVATE' | 'SHARED';
type RoomGender = 'MALE' | 'FEMALE' | 'ANY';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class BookingRequestsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Total bed capacity across active rooms matching (type, gender).
   * Deliberately an EXACT match, not pooled across genders — a MALE-only
   * request never draws from FEMALE or ANY room capacity, and vice versa.
   * This keeps "how many beds are actually free for this request" simple
   * and unambiguous for the coordinator reviewing it.
   */
  private async totalCapacity(type: RoomType, gender: RoomGender): Promise<number> {
    const rooms = await this.prisma.room.findMany({ where: { type, gender, isActive: true }, select: { capacity: true } });
    return rooms.reduce((sum, r) => sum + r.capacity, 0);
  }

  /**
   * Headcount already claimed (PENDING or APPROVED — a pending request
   * still holds a provisional claim on capacity so two guests can't both
   * be told "yes" for beds that only exist once) for each day in a window,
   * for the same (type, gender) pool.
   */
  private async bookedHeadcountByDay(type: RoomType, gender: RoomGender, windowStart: Date, windowEnd: Date): Promise<Map<string, number>> {
    const overlapping = await this.prisma.bookingRequest.findMany({
      where: {
        type,
        gender,
        status: { in: ['PENDING', 'APPROVED'] },
        checkInDate: { lt: windowEnd },
        checkOutDate: { gt: windowStart },
      },
      select: { checkInDate: true, checkOutDate: true, headcount: true },
    });

    const byDay = new Map<string, number>();
    for (const b of overlapping) {
      let d = toDateOnly(new Date(b.checkInDate));
      const end = toDateOnly(new Date(b.checkOutDate));
      while (d < end) {
        const key = dateKey(d);
        byDay.set(key, (byDay.get(key) || 0) + b.headcount);
        d = addDays(d, 1);
      }
    }
    return byDay;
  }

  /**
   * Checks whether `headcount` beds are free for every night from checkIn
   * up to but not including checkIn + nights. Returns the specific
   * unavailable dates, if any, AND up to 5 nearby alternative date ranges
   * that DO fit — so a rejected request comes with a useful answer, not
   * just "no".
   */
  async checkAvailability(type: RoomType, gender: RoomGender, headcount: number, checkInDate: Date, nights: number) {
    const capacity = await this.totalCapacity(type, gender);
    const checkOutDate = addDays(toDateOnly(checkInDate), nights);

    // Scan a wider window (60 days past checkIn) so we can suggest
    // alternatives even if the requested dates are fully booked.
    const scanStart = toDateOnly(checkInDate);
    const scanEnd = addDays(scanStart, 60);
    const bookedByDay = await this.bookedHeadcountByDay(type, gender, scanStart, scanEnd);

    const remaining = (day: Date) => capacity - (bookedByDay.get(dateKey(day)) || 0);

    const unavailableDates: string[] = [];
    for (let d = toDateOnly(checkInDate); d < checkOutDate; d = addDays(d, 1)) {
      if (remaining(d) < headcount) unavailableDates.push(dateKey(d));
    }

    let suggestions: { checkInDate: string; checkOutDate: string }[] = [];
    if (unavailableDates.length > 0) {
      // Slide a `nights`-long window across the scan range, collect every
      // run where every single day has enough remaining capacity.
      for (let start = scanStart; addDays(start, nights) <= scanEnd && suggestions.length < 5; start = addDays(start, 1)) {
        let fits = true;
        for (let d = start; d < addDays(start, nights); d = addDays(d, 1)) {
          if (remaining(d) < headcount) { fits = false; break; }
        }
        if (fits) suggestions.push({ checkInDate: dateKey(start), checkOutDate: dateKey(addDays(start, nights)) });
      }
    }

    return { capacity, available: unavailableDates.length === 0, unavailableDates, suggestions, checkOutDate };
  }

  async createRequest(guestId: string, input: { type: RoomType; gender: RoomGender; headcount: number; checkInDate: string; nights: number; guestNotes?: string }) {
    if (input.headcount < 1) throw new BadRequestException('Headcount must be at least 1');
    if (input.nights < 1) throw new BadRequestException('Nights must be at least 1');

    const checkInDate = toDateOnly(new Date(input.checkInDate));
    if (Number.isNaN(checkInDate.getTime())) throw new BadRequestException('Invalid check-in date');

    const availability = await this.checkAvailability(input.type, input.gender, input.headcount, checkInDate, input.nights);
    if (!availability.available) {
      throw new BadRequestException({
        message: 'الأيام دي مش متاحة للعدد المطلوب',
        unavailableDates: availability.unavailableDates,
        suggestions: availability.suggestions,
      });
    }

    return this.prisma.bookingRequest.create({
      data: {
        guestId,
        type: input.type,
        gender: input.gender,
        headcount: input.headcount,
        checkInDate,
        nights: input.nights,
        checkOutDate: availability.checkOutDate,
        guestNotes: input.guestNotes,
        status: 'PENDING',
      },
    });
  }

  listMine(guestId: string) {
    return this.prisma.bookingRequest.findMany({ where: { guestId }, orderBy: { createdAt: 'desc' }, include: { room: true } });
  }

  listAll(status?: string) {
    return this.prisma.bookingRequest.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
      include: { guest: { select: { id: true, name: true, phone: true, email: true, churchName: true, age: true } }, room: true },
    });
  }

  async findOne(id: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id },
      include: { guest: { select: { id: true, name: true, phone: true, email: true, churchName: true, age: true } }, room: true },
    });
    if (!booking) throw new NotFoundException('Booking request not found');
    return booking;
  }

  async approve(id: string, reviewerId: string, roomId?: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'PENDING') throw new BadRequestException('Only pending requests can be approved');

    // Re-check availability at approval time too — capacity may have
    // shifted since the request was submitted (other approvals in between).
    const availability = await this.checkAvailability(booking.type, booking.gender, booking.headcount, new Date(booking.checkInDate), booking.nights);
    if (!availability.available) {
      throw new BadRequestException({ message: 'العدد بقى مش متاح دلوقتي للأيام دي', unavailableDates: availability.unavailableDates, suggestions: availability.suggestions });
    }

    return this.prisma.bookingRequest.update({
      where: { id },
      data: { status: 'APPROVED', roomId: roomId ?? booking.roomId, reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }

  async reject(id: string, reviewerId: string, reviewNotes?: string) {
    const booking = await this.findOne(id);
    if (booking.status !== 'PENDING') throw new BadRequestException('Only pending requests can be rejected');
    return this.prisma.bookingRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewNotes, reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }

  async cancel(id: string, guestId: string) {
    const booking = await this.findOne(id);
    if (booking.guestId !== guestId) throw new ForbiddenException('Not your booking request');
    if (!['PENDING', 'APPROVED'].includes(booking.status)) throw new BadRequestException('This request can no longer be cancelled');
    return this.prisma.bookingRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }
}
