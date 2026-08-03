import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  // Public: guests need to see what categories exist (and their capacity)
  // to understand what they're requesting — this deliberately doesn't hide
  // capacity numbers, since "how many beds" is exactly what a guest needs
  // to gauge whether a group will fit.
  list(includeInactive = false) {
    return this.prisma.room.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ type: 'asc' }, { gender: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  // SUPERVISOR-only in the controller — this is deliberately the ONE place
  // bed capacity can be set, per the requirement that only a supervisor
  // configures how many beds a room has.
  create(data: { name: string; type: 'PRIVATE' | 'SHARED'; gender: 'MALE' | 'FEMALE' | 'ANY'; capacity: number; notes?: string }) {
    return this.prisma.room.create({ data });
  }

  async update(id: string, data: Partial<{ name: string; type: 'PRIVATE' | 'SHARED'; gender: 'MALE' | 'FEMALE' | 'ANY'; capacity: number; notes: string; isActive: boolean }>) {
    await this.findOne(id);
    return this.prisma.room.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    // Soft-delete (deactivate) rather than hard delete — existing booking
    // requests reference this room and must keep working/reporting correctly.
    return this.prisma.room.update({ where: { id }, data: { isActive: false } });
  }
}
