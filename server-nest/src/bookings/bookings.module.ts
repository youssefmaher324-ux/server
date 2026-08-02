import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingsSchedulerService } from './bookings-scheduler.service';
import { RoomsModule } from '../rooms/rooms.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [RoomsModule, AuditModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsSchedulerService],
  exports: [BookingsService],
})
export class BookingsModule {}
