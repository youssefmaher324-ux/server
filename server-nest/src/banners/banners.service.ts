import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class BannersService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  list() {
    return this.prisma.banner.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' } });
  }

  async create(file: Express.Multer.File, title?: string, subtitle?: string) {
    const path = `banners/${Date.now()}-${file.originalname}`;
    const imageUrl = await this.storage.upload(path, file.buffer, file.mimetype);
    return this.prisma.banner.create({ data: { title, subtitle, imageUrl } });
  }

  async remove(id: string) {
    return this.prisma.banner.update({ where: { id }, data: { active: false } });
  }
}
