import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private products: ProductsService) {}

  // Prisma's `price` column is Decimal, which JSON-serializes as a string —
  // customer/app.js does arithmetic and .toFixed() directly on this field,
  // so every response here converts it to a real number first.
  private serialize(p: any) {
    return { ...p, price: p.price !== undefined ? Number(p.price) : p.price };
  }

  @Get()
  async list(@Query('categoryId') categoryId?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const result = await this.products.list({ categoryId, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
    return { ...result, items: result.items.map((p) => this.serialize(p)) };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.serialize(await this.products.findOne(id));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'employee')
  @Post()
  create(@Body() body: any) {
    return this.products.create(body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'employee')
  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.products.update(id, body);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }
}
