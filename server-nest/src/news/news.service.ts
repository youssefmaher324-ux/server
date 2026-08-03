import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NewsService {
  constructor(private prisma: PrismaService) {}

  list(includeUnpublished = false) {
    return this.prisma.news.findMany({
      where: includeUnpublished ? {} : { isPublished: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const item = await this.prisma.news.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('News item not found');
    return item;
  }

  create(authorId: string, data: { title: string; body: string; imageUrl?: string; isPublished?: boolean }) {
    return this.prisma.news.create({ data: { ...data, authorId } });
  }

  async update(id: string, data: Partial<{ title: string; body: string; imageUrl: string; isPublished: boolean }>) {
    await this.findOne(id);
    return this.prisma.news.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.news.delete({ where: { id } });
  }
}
