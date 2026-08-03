import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'ChangeMe123!';

const ROLES = ['super_admin', 'admin', 'employee', 'driver', 'customer', 'supervisor', 'coordinator'];

const PERMISSIONS = [
  'products.read', 'products.write',
  'categories.write',
  'orders.read', 'orders.write', 'orders.cancel', 'orders.assign_driver',
  'coupons.write',
  'invoices.read', 'invoices.write',
  'drivers.write', 'drivers.update_location',
  'users.manage',
  'audit_logs.read',
  'settings.write',
  'rooms.write',
  'booking_requests.review',
  'news.write',
];

// Which roles get which permissions. super_admin implicitly gets everything
// via the RolesGuard's role-name check, but is listed explicitly too so
// permission-based checks (@RequirePermissions) work the same way.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: PERMISSIONS,
  admin: PERMISSIONS,
  employee: ['products.read', 'orders.read', 'orders.write', 'orders.assign_driver', 'invoices.read', 'invoices.write'],
  driver: ['orders.read', 'drivers.update_location'],
  customer: ['orders.read'],
  // المشرف — configures rooms/bed capacity, and can do everything a
  // coordinator can (a supervisor is also allowed to review requests).
  supervisor: ['rooms.write', 'booking_requests.review', 'news.write'],
  // مسئول الحجز — reviews and approves/rejects booking requests; cannot
  // touch room/bed configuration.
  coordinator: ['booking_requests.review', 'news.write'],
};

async function main() {
  const roleRecords: Record<string, string> = {};
  for (const name of ROLES) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roleRecords[name] = role.id;
  }

  const permissionRecords: Record<string, string> = {};
  for (const key of PERMISSIONS) {
    const permission = await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    permissionRecords[key] = permission.id;
  }

  for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
    for (const key of keys) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roleRecords[roleName], permissionId: permissionRecords[key] } },
        update: {},
        create: { roleId: roleRecords[roleName], permissionId: permissionRecords[key] },
      });
    }
  }

  console.log('Seeded roles and permissions.');

  // ---- Demo login accounts --------------------------------------------------
  // ⚠️ CHANGE THESE PASSWORDS before going to production. They exist so the
  // system is immediately logged-into-able after a fresh `prisma db seed`,
  // not as real production credentials.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await prisma.user.upsert({
    where: { email: 'admin@citrine.com' },
    update: {},
    create: {
      name: 'Citrine Admin',
      email: 'admin@citrine.com',
      passwordHash,
      roleId: roleRecords['admin'],
      isEmailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'employee@citrine.com' },
    update: {},
    create: {
      name: 'Citrine Employee',
      email: 'employee@citrine.com',
      passwordHash,
      roleId: roleRecords['employee'],
      isEmailVerified: true,
    },
  });

  // Drivers are a separate table (not User) — see AuthService.driverLogin.
  await prisma.driver.upsert({
    where: { email: 'driver@citrine.com' },
    update: {},
    create: {
      name: 'Citrine Driver',
      email: 'driver@citrine.com',
      passwordHash,
    },
  });

  // ---- Monastery guest-house demo accounts + sample rooms -----------------
  await prisma.user.upsert({
    where: { email: 'supervisor@monastery.com' },
    update: {},
    create: {
      name: 'Monastery Supervisor',
      email: 'supervisor@monastery.com',
      passwordHash,
      roleId: roleRecords['supervisor'],
      isEmailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'coordinator@monastery.com' },
    update: {},
    create: {
      name: 'Booking Coordinator',
      email: 'coordinator@monastery.com',
      passwordHash,
      roleId: roleRecords['coordinator'],
      isEmailVerified: true,
    },
  });

  const sampleRooms: { name: string; type: 'PRIVATE' | 'SHARED'; gender: 'MALE' | 'FEMALE' | 'ANY'; capacity: number }[] = [
    { name: 'خلوة 1', type: 'PRIVATE', gender: 'ANY', capacity: 2 },
    { name: 'خلوة 2', type: 'PRIVATE', gender: 'ANY', capacity: 2 },
    { name: 'أوضة شباب 1', type: 'SHARED', gender: 'MALE', capacity: 6 },
    { name: 'أوضة شباب 2', type: 'SHARED', gender: 'MALE', capacity: 6 },
    { name: 'أوضة سيدات 1', type: 'SHARED', gender: 'FEMALE', capacity: 6 },
  ];
  for (const room of sampleRooms) {
    const existing = await prisma.room.findFirst({ where: { name: room.name } });
    if (!existing) await prisma.room.create({ data: room });
  }

  console.log('Seeded demo accounts:');
  console.log('  admin@citrine.com        / ChangeMe123!  (POST /api/auth/login)');
  console.log('  employee@citrine.com     / ChangeMe123!  (POST /api/auth/login)');
  console.log('  driver@citrine.com       / ChangeMe123!  (POST /api/auth/driver-login)');
  console.log('  supervisor@monastery.com / ChangeMe123!  (POST /api/auth/login)');
  console.log('  coordinator@monastery.com/ ChangeMe123!  (POST /api/auth/login)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
