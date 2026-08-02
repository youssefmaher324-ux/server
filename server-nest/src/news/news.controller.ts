import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { NewsService } from './news.service';

type AuthedRequest = Request & { user: { userId: string } };

@ApiTags('news')
@Controller('news')
export class NewsController {
  constructor(private news: NewsService) {}

  @Get()
  listPublic() {
    return this.news.listPublic();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Get('admin')
  listAll() {
    return this.news.listAll();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.news.get(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post()
  create(@Body() body: { title: string; body?: string; category?: string; isPinned?: boolean }, @Req() req: AuthedRequest) {
    return this.news.create(req.user.userId, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { title?: string; body?: string; category?: string; isPinned?: boolean; isHidden?: boolean }) {
    return this.news.update(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.news.remove(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post(':id/media/image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  addImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.news.addMedia(id, file, 'image');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Post(':id/media/file')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  addFile(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.news.addMedia(id, file, 'file');
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @Delete('media/:mediaId')
  removeMedia(@Param('mediaId') mediaId: string) {
    return this.news.removeMedia(mediaId);
  }
}
