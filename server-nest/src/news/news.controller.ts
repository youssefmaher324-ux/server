import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { NewsService } from './news.service';

@ApiTags('news')
@Controller('news')
export class NewsController {
  constructor(private news: NewsService) {}

  @Get()
  list() {
    return this.news.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.news.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('coordinator', 'supervisor', 'super_admin')
  @Post()
  create(@Req() req: any, @Body() body: { title: string; body: string; imageUrl?: string; isPublished?: boolean }) {
    return this.news.create(req.user.userId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('coordinator', 'supervisor', 'super_admin')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.news.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles('coordinator', 'supervisor', 'super_admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.news.remove(id);
  }
}
