import { Module } from '@nestjs/common';
import { LegacyActionsController } from './legacy-actions.controller';
import { LegacyActionsService } from './legacy-actions.service';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { DriversModule } from '../drivers/drivers.module';
import { InvoicesModule } from '../invoices/invoices.module';

@Module({
  imports: [ProductsModule, OrdersModule, DriversModule, InvoicesModule],
  controllers: [LegacyActionsController],
  providers: [LegacyActionsService],
})
export class LegacyCompatModule {}
