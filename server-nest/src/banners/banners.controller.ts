import { Body, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BannersService } from './banners.service';

@ApiTags('banners')
@Controller('banners')
export class BannersController {
  constructor(private banners: BannersService) {}

  @Get()
  async list() {
    // customer/app.js (legacy shape) expects { banners: [{ image_url, title, subtitle }] }
    const banners = await this.banners.list();
    return {
      banners: banners.map((b) => ({
        id: b.id,
        title: b.title,
        subtitle: b.subtitle,
        image_url: b.imageUrl,
      })),
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post()
  @UseInterceptors(FileInterceptor('bannerImage', { limits: { fileSize: 5 * 1024 * 1024 } }))
  create(@UploadedFile() file: Express.Multer.File, @Body('title') title?: string, @Body('subtitle') subtitle?: string) {
    return this.banners.create(file, title, subtitle);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.banners.remove(id);
  }
}
