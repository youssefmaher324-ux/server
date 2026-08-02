import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';

/**
 * Runs hourly. Two responsibilities, both spec-required (sections 10 & 12):
 *  - send a reminder email ~24h and ~2h before an approved booking's arrival
 *  - auto-complete a checked_in booking once its departure date has passed,
 *    freeing the room (completed/cancelled/rejected bookings are excluded
 *    from the bed-availability count in RoomsService.bedsCommitted).
 */
@Injectable()
export class BookingsSchedulerService {
  private readonly logger = new Logger(BookingsSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendArrivalReminders() {
    const now = Date.now();
    await this.remindWindow(now + 24 * 3600_000, 'reminder24hSentAt', 24);
    await this.remindWindow(now + 2 * 3600_000, 'reminder2hSentAt', 2);
  }

  private async remindWindow(targetMs: number, field: 'reminder24hSentAt' | 'reminder2hSentAt', hoursBefore: number) {
    const windowStart = new Date(targetMs - 30 * 60_000);
    const windowEnd = new Date(targetMs + 30 * 60_000);

    const due = await this.prisma.booking.findMany({
      where: {
        status: 'approved',
        arrivalDate: { gte: windowStart, lte: windowEnd },
        [field]: null,
      },
      include: { user: true },
    });

    for (const booking of due) {
      try {
        if (booking.user?.email) {
          await this.mail.sendBookingReminderEmail(booking.user.email, booking.code || booking.id, hoursBefore);
        }
        await this.prisma.booking.update({ where: { id: booking.id }, data: { [field]: new Date() } });
      } catch (err) {
        this.logger.error(`Failed to send ${hoursBefore}h reminder for booking ${booking.id}: ${(err as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoCompletePastStays() {
    const overdue = await this.prisma.booking.findMany({
      where: { status: 'checked_in', departureDate: { lt: new Date() } },
      include: { user: true },
    });

    for (const booking of overdue) {
      try {
        await this.prisma.booking.update({ where: { id: booking.id }, data: { status: 'completed', checkedOutAt: new Date() } });
        if (booking.user?.email) await this.mail.sendStayCompletedEmail(booking.user.email, booking.code || booking.id);
      } catch (err) {
        this.logger.error(`Failed to auto-complete booking ${booking.id}: ${(err as Error).message}`);
      }
    }
  }
}
