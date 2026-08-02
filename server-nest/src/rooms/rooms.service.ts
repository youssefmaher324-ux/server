import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  list(activeOnly = false) {
    return this.prisma.room.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { number: 'asc' },
    });
  }

  async get(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  async create(data: { number: string; capacity: number; type?: string; notes?: string }) {
    if (data.capacity < 1) throw new BadRequestException('Room capacity must be at least 1 bed');
    const existing = await this.prisma.room.findUnique({ where: { number: data.number } });
    if (existing) throw new BadRequestException(`Room ${data.number} already exists`);
    return this.prisma.room.create({ data });
  }

  async update(id: string, data: { number?: string; capacity?: number; type?: string; notes?: string; isActive?: boolean }) {
    await this.get(id);
    if (data.capacity !== undefined && data.capacity < 1) throw new BadRequestException('Room capacity must be at least 1 bed');
    return this.prisma.room.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.get(id);
    const activeBookings = await this.prisma.bookingRoom.count({
      where: { roomId: id, booking: { status: { in: ['pending', 'approved', 'checked_in'] } } },
    });
    if (activeBookings > 0) {
      throw new BadRequestException('Cannot delete a room with active or pending bookings — deactivate it instead');
    }
    return this.prisma.room.delete({ where: { id } });
  }

  /**
   * Beds already committed in `roomId` for any date range that overlaps
   * [arrivalDate, departureDate). Two ranges overlap unless one ends
   * before the other starts.
   */
  async bedsCommitted(roomId: string, arrivalDate: Date, departureDate: Date, excludeBookingId?: string): Promise<number> {
    const rows = await this.prisma.bookingRoom.findMany({
      where: {
        roomId,
        booking: {
          status: { in: ['pending', 'approved', 'checked_in'] },
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
          arrivalDate: { lt: departureDate },
          departureDate: { gt: arrivalDate },
        },
      },
      select: { bedsAllocated: true },
    });
    return rows.reduce((sum, r) => sum + r.bedsAllocated, 0);
  }
}
