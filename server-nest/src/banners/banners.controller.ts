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
    const banners = await this.banners.list();
    // customer/app.js expects {banners: [...]} with a snake_case image_url
    // field, not a raw array with camelCase imageUrl.
    return {
      banners: banners.map((b) => ({ ...b, image_url: b.imageUrl })),
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
