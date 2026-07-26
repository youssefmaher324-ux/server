import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DriversService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.driver.findMany({ orderBy: { name: 'asc' } });
  }

  async create(data: { name: string; phone?: string; email?: string; password?: string; branchId?: string }) {
    const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
    return this.prisma.driver.create({
      data: { name: data.name, phone: data.phone, email: data.email, branchId: data.branchId, passwordHash },
    });
  }

  /** Looks up by phone or email — used for driver login (phone/email + password). */
  findByIdentifier(identifier: string) {
    const isEmail = identifier.includes('@');
    return this.prisma.driver.findFirst({ where: isEmail ? { email: identifier } : { phone: identifier } });
  }

  async updatePassword(driverId: string, password: string) {
    const passwordHash = await bcrypt.hash(password, 12);
    return this.prisma.driver.update({ where: { id: driverId }, data: { passwordHash } });
  }

  async updateLocation(driverId: string, lat: number, lng: number) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundException('Driver not found');

    await this.prisma.driverLocation.create({ data: { driverId, lat, lng } });
    return this.prisma.driver.update({
      where: { id: driverId },
      data: { currentLat: lat, currentLng: lng, lastLocationUpdate: new Date() },
    });
  }

  setAvailability(driverId: string, available: boolean) {
    return this.prisma.driver.update({ where: { id: driverId }, data: { available } });
  }
}
