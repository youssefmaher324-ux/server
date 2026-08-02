import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const CATEGORIES = ['news', 'mass_schedule', 'conference', 'meeting', 'event'];

@Injectable()
export class NewsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  /** Public feed — hidden posts excluded, pinned first, then newest first. */
  async listPublic() {
    return this.prisma.newsPost.findMany({
      where: { isHidden: false },
      include: { media: true },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Admin feed — includes hidden posts. */
  async listAll() {
    return this.prisma.newsPost.findMany({
      include: { media: true },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(id: string) {
    const post = await this.prisma.newsPost.findUnique({ where: { id }, include: { media: true } });
    if (!post) throw new NotFoundException('News post not found');
    return post;
  }

  async create(authorId: string, data: { title: string; body?: string; category?: string; isPinned?: boolean }) {
    const category = data.category && CATEGORIES.includes(data.category) ? data.category : 'news';
    return this.prisma.newsPost.create({
      data: { title: data.title, body: data.body, category, isPinned: !!data.isPinned, authorId },
    });
  }

  async update(id: string, data: { title?: string; body?: string; category?: string; isPinned?: boolean; isHidden?: boolean }) {
    await this.get(id);
    if (data.category && !CATEGORIES.includes(data.category)) delete data.category;
    return this.prisma.newsPost.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.get(id);
    return this.prisma.newsPost.delete({ where: { id } });
  }

  async addMedia(newsId: string, file: Express.Multer.File, type: 'image' | 'file') {
    await this.get(newsId);
    const path = `news/${newsId}/${Date.now()}-${file.originalname}`;
    const url = await this.storage.upload(path, file.buffer, file.mimetype);
    return this.prisma.newsMedia.create({
      data: { newsId, url, type, fileName: file.originalname },
    });
  }

  async removeMedia(mediaId: string) {
    const media = await this.prisma.newsMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('Media not found');
    return this.prisma.newsMedia.delete({ where: { id: mediaId } });
  }
}
